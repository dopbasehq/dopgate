//! A fresh instance per test, served in process. Every test gets its own
//! Postgres schema in the database at `DOPGATE_TEST_DATABASE_URL`, dropped
//! when the test ends.
//!
//! Start the database with:
//!
//! ```text
//! docker run -d --name dopgate-test-pg -e POSTGRES_PASSWORD=dopgate \
//!   -p 55432:5432 postgres:17-alpine -c max_connections=400
//! ```

pub mod smtp;

use std::time::Duration;

use app::{
  config::{EnvironmentOverrides, ServerConfig, ServerOverrides},
  server,
  services::db::DbClient,
  state::AppState,
};
use axum::{
  Router,
  body::{Body, to_bytes},
  http::{HeaderMap, Method, Request, StatusCode, header},
};
use serde_json::Value;
use tower::ServiceExt;

pub const DEFAULT_TEST_DATABASE_URL: &str = "postgres://postgres:dopgate@localhost:55432/postgres";

/// The database tests run against.
pub fn database_url() -> String {
  std::env::var("DOPGATE_TEST_DATABASE_URL").unwrap_or_else(|_| DEFAULT_TEST_DATABASE_URL.into())
}

/// A schema name no other test uses.
pub fn unique_schema() -> String {
  format!("t_{}", ulid::Ulid::new().to_string().to_lowercase())
}

/// Drops a schema when it goes out of scope.
pub struct SchemaGuard(pub String);

impl Drop for SchemaGuard {
  fn drop(&mut self) {
    let schema = self.0.clone();
    // Drop runs outside async code, so the cleanup gets its own runtime on
    // its own thread.
    let _ = std::thread::spawn(move || {
      let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
      runtime.block_on(async move {
        use sqlx::{ConnectOptions, Executor};
        let options: sqlx::postgres::PgConnectOptions = database_url().parse().unwrap();
        let Ok(mut connection) = options.connect().await else {
          return;
        };
        // A test that ended mid-transaction can leave a lock behind on a
        // connection its runtime never got to roll back. End those, then
        // drop the schema.
        let _ = connection.execute("SET lock_timeout = '5s'").await;
        for _ in 0..3 {
          let dropped = connection
            .execute(format!("DROP SCHEMA IF EXISTS \"{schema}\" CASCADE").as_str())
            .await;
          if dropped.is_ok() {
            return;
          }
          let _ = connection
            .execute(
              "SELECT pg_terminate_backend(pid) FROM pg_stat_activity \
               WHERE application_name = 'dopgate' AND state = 'idle in transaction' \
               AND now() - state_change > interval '3 seconds'",
            )
            .await;
        }
      });
    })
    .join();
  }
}

/// A connected, migrated client in a fresh schema, for service tests.
pub async fn database() -> (DbClient, SchemaGuard) {
  let schema = unique_schema();
  let db = DbClient::connect_with(&database_url(), &schema, Duration::from_secs(5), 3)
    .await
    .expect("PostgreSQL is not reachable. Start it with the command in tests/support/mod.rs.");
  db.migrate().await.unwrap();
  (db, SchemaGuard(schema))
}

/// A response, already read.
pub struct Reply {
  pub status: StatusCode,
  pub headers: HeaderMap,
  pub json: Value,
}

pub struct TestApp {
  pub state: AppState,
  pub router: Router,
  /// Dropped last, so the schema outlives the pool's use of it.
  pub _schema: SchemaGuard,
}

impl TestApp {
  pub async fn new() -> Self {
    Self::with(|_| {}).await
  }

  /// An instance whose configuration `customize` changes before it starts.
  pub async fn with(customize: impl FnOnce(&mut ServerConfig)) -> Self {
    let schema = unique_schema();
    let mut config = config_for(&schema);
    customize(&mut config);
    let state = server::build_state(config).await.unwrap();
    let router = server::router(state.clone());
    Self {
      state,
      router,
      _schema: SchemaGuard(schema),
    }
  }

  /// The setup token a new instance prints at startup.
  pub async fn setup_token(&self) -> String {
    self.state.setup.read().await.token.clone().unwrap()
  }

  pub async fn request(
    &self,
    method: Method,
    path: &str,
    body: Option<Value>,
  ) -> (StatusCode, Value) {
    self.request_with(method, path, body, None).await
  }

  pub async fn request_with(
    &self,
    method: Method,
    path: &str,
    body: Option<Value>,
    bearer: Option<&str>,
  ) -> (StatusCode, Value) {
    let reply = self.call(method, path, body, bearer, &[]).await;
    (reply.status, reply.json)
  }

  /// A JSON request with optional bearer token and extra headers.
  pub async fn call(
    &self,
    method: Method,
    path: &str,
    body: Option<Value>,
    bearer: Option<&str>,
    extra: &[(&str, &str)],
  ) -> Reply {
    let mut headers: Vec<(String, String)> = Vec::new();
    if let Some(token) = bearer {
      headers.push((
        header::AUTHORIZATION.as_str().into(),
        format!("Bearer {token}"),
      ));
    }
    let (content_type, body) = match body {
      Some(body) => (Some("application/json"), body.to_string()),
      None => (None, String::new()),
    };
    if let Some(content_type) = content_type {
      headers.push((
        header::CONTENT_TYPE.as_str().into(),
        content_type.to_owned(),
      ));
    }
    for (name, value) in extra {
      headers.push(((*name).into(), (*value).into()));
    }
    let header_refs: Vec<(&str, &str)> = headers
      .iter()
      .map(|(name, value)| (name.as_str(), value.as_str()))
      .collect();
    self.send(method, path, &header_refs, body).await
  }

  /// Send any request: raw headers and a raw body.
  pub async fn send(
    &self,
    method: Method,
    path: &str,
    headers: &[(&str, &str)],
    body: impl Into<Body>,
  ) -> Reply {
    let mut request = Request::builder().method(method).uri(path);
    for (name, value) in headers {
      request = request.header(*name, *value);
    }
    let response = self
      .router
      .clone()
      .oneshot(request.body(body.into()).unwrap())
      .await
      .unwrap();
    let status = response.status();
    let headers = response.headers().clone();
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    Reply {
      status,
      headers,
      json: serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    }
  }

  /// Change runtime settings with the service key.
  pub async fn settings(
    &self,
    patch: Value,
  ) {
    let (status, body) = self
      .request_with(
        Method::PATCH,
        "/api/v1/admin/settings",
        Some(patch),
        Some(SERVICE_KEY),
      )
      .await;
    assert_eq!(status, StatusCode::OK, "{body}");
  }
}

/// Every test instance accepts this service key, so admin routes can be
/// called before sign-in exists.
pub const SERVICE_KEY: &str = "test-service-key-0123456789-abcdefghij";

/// The configuration of an instance in `schema`, ignoring the process
/// environment.
pub fn config_for(schema: &str) -> ServerConfig {
  let overrides = ServerOverrides {
    database_url: Some(database_url()),
    ..Default::default()
  };
  let environment = EnvironmentOverrides {
    database_schema: Some(schema.into()),
    database_max_connections: Some("3".into()),
    service_key: Some(SERVICE_KEY.into()),
    ..Default::default()
  };
  ServerConfig::load_with_environment(&overrides, environment).unwrap()
}

/// Point the instance's mail at a fake SMTP server.
pub fn use_smtp(
  config: &mut ServerConfig,
  smtp: &smtp::FakeSmtp,
) {
  config.smtp.host = Some("127.0.0.1".into());
  config.smtp.port = Some(smtp.port);
  config.smtp.security = app::services::mailer::SmtpSecurity::None;
  config.smtp.from_email = Some("no-reply@example.com".into());
}
