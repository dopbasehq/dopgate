//! A fresh instance per test: its own data directory, database, and master
//! key, served in process.

pub mod smtp;

use app::{
  config::{EnvironmentOverrides, ServerConfig, ServerOverrides},
  server,
  state::AppState,
};
use axum::{
  Router,
  body::{Body, to_bytes},
  http::{HeaderMap, Method, Request, StatusCode, header},
};
use serde_json::Value;
use tempfile::TempDir;
use tower::ServiceExt;

/// A response, already read.
pub struct Reply {
  pub status: StatusCode,
  pub headers: HeaderMap,
  pub json: Value,
}

pub struct TestApp {
  /// Dropped last, so the data directory outlives the database.
  _directory: TempDir,
  pub state: AppState,
  pub router: Router,
}

impl TestApp {
  pub async fn new() -> Self {
    Self::with(|_| {}).await
  }

  /// An instance whose configuration `customize` changes before it starts.
  pub async fn with(customize: impl FnOnce(&mut ServerConfig)) -> Self {
    let directory = TempDir::new().unwrap();
    let mut config = config_in(&directory);
    customize(&mut config);
    let state = server::build_state(config).await.unwrap();
    let router = server::router(state.clone());
    Self {
      _directory: directory,
      state,
      router,
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
    let mut headers = Vec::new();
    if let Some(token) = bearer {
      headers.push((header::AUTHORIZATION.as_str(), format!("Bearer {token}")));
    }
    let (content_type, body) = match body {
      Some(body) => (Some("application/json"), body.to_string()),
      None => (None, String::new()),
    };
    if let Some(content_type) = content_type {
      headers.push((header::CONTENT_TYPE.as_str(), content_type.to_owned()));
    }
    let header_refs: Vec<(&str, &str)> = headers
      .iter()
      .map(|(name, value)| (*name, value.as_str()))
      .collect();
    let reply = self.send(method, path, &header_refs, body).await;
    (reply.status, reply.json)
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
}

/// The configuration of an instance in `directory`, ignoring the process
/// environment and the user's home directory.
pub fn config_in(directory: &TempDir) -> ServerConfig {
  let overrides = ServerOverrides {
    data_dir: Some(directory.path().to_path_buf()),
    ..Default::default()
  };
  ServerConfig::load_with_environment(&overrides, EnvironmentOverrides::default()).unwrap()
}
