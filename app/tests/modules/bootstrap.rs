use axum::http::{Method, StatusCode};
use serde_json::json;

use crate::support::TestApp;

const ROOT: &str = "/api/v1/bootstrap/root";

#[tokio::test]
async fn new_instance_is_not_initialized_and_has_a_setup_token() {
  let app = TestApp::new().await;
  let (status, body) = app
    .request(Method::GET, "/api/v1/bootstrap/status", None)
    .await;
  assert_eq!(status, StatusCode::OK);
  assert_eq!(body["data"]["initialized"], false);
  assert!(app.setup_token().await.starts_with("setup_"));
}

#[tokio::test]
async fn setup_token_creates_root_once() {
  let app = TestApp::new().await;
  let token = app.setup_token().await;
  let (status, body) = app
    .request(
      Method::POST,
      ROOT,
      Some(
        json!({"setupToken": token, "email": " Root@Example.COM ", "password": "correct-horse"}),
      ),
    )
    .await;
  assert_eq!(status, StatusCode::CREATED, "{body}");
  assert_eq!(body["data"]["email"], "root@example.com");
  assert!(
    body["data"]["adminId"]
      .as_str()
      .unwrap()
      .starts_with("adm_")
  );

  let (_, status_body) = app
    .request(Method::GET, "/api/v1/bootstrap/status", None)
    .await;
  assert_eq!(status_body["data"]["initialized"], true);

  // The token is spent, so a second attempt is refused even with it.
  let (status, body) = app
    .request(
      Method::POST,
      ROOT,
      Some(json!({"setupToken": token, "email": "other@example.com", "password": "correct-horse"})),
    )
    .await;
  assert_eq!(status, StatusCode::CONFLICT);
  assert!(body["error"]["ALREADY_INITIALIZED"].is_string());
}

#[tokio::test]
async fn setup_records_an_audit_event() {
  let app = TestApp::new().await;
  let token = app.setup_token().await;
  app
    .request(
      Method::POST,
      ROOT,
      Some(json!({"setupToken": token, "email": "root@example.com", "password": "correct-horse"})),
    )
    .await;
  let report = app::services::audit_chain::verify(app.state.db.pool())
    .await
    .unwrap();
  assert!(report.ok);
  assert_eq!(report.records, 1);
  let action: String = sqlx::query_scalar("SELECT action FROM audit_events")
    .fetch_one(app.state.db.pool())
    .await
    .unwrap();
  assert_eq!(action, "instance.initialized");
}

#[tokio::test]
async fn wrong_setup_token_is_refused() {
  let app = TestApp::new().await;
  let (status, body) = app
    .request(
      Method::POST,
      ROOT,
      Some(json!({"setupToken": "setup_wrong", "email": "root@example.com", "password": "correct-horse"})),
    )
    .await;
  assert_eq!(status, StatusCode::UNAUTHORIZED);
  assert!(body["error"]["SETUP_TOKEN_INVALID"].is_string());
}

#[tokio::test]
async fn invalid_email_and_short_password_are_refused() {
  let app = TestApp::new().await;
  let token = app.setup_token().await;
  let (status, body) = app
    .request(
      Method::POST,
      ROOT,
      Some(json!({"setupToken": token, "email": "not-an-email", "password": "correct-horse"})),
    )
    .await;
  assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
  assert!(body["error"]["EMAIL_INVALID"].is_string());

  let (status, body) = app
    .request(
      Method::POST,
      ROOT,
      Some(json!({"setupToken": token, "email": "root@example.com", "password": "short"})),
    )
    .await;
  assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
  assert!(body["error"]["PASSWORD_INVALID"].is_string());
}

/// Five wrong tokens lock the address out, and then even the right token is
/// refused until the window passes.
#[tokio::test]
async fn repeated_wrong_setup_tokens_lock_out() {
  let app = TestApp::new().await;
  let token = app.setup_token().await;
  for _ in 0..5 {
    let (status, _) = app
      .request(
        Method::POST,
        ROOT,
        Some(json!({"setupToken": "setup_wrong", "email": "root@example.com", "password": "correct-horse"})),
      )
      .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
  }
  let (status, body) = app
    .request(
      Method::POST,
      ROOT,
      Some(json!({"setupToken": token, "email": "root@example.com", "password": "correct-horse"})),
    )
    .await;
  assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
  assert!(body["error"]["RATE_LIMITED"].is_string());
}

/// A refused email or password leaves the setup token usable.
#[tokio::test]
async fn refused_request_keeps_the_setup_token() {
  let app = TestApp::new().await;
  let token = app.setup_token().await;
  app
    .request(
      Method::POST,
      ROOT,
      Some(json!({"setupToken": token, "email": "root@example.com", "password": "short"})),
    )
    .await;
  assert_eq!(app.setup_token().await, token);
  let (status, _) = app
    .request(
      Method::POST,
      ROOT,
      Some(json!({"setupToken": token, "email": "root@example.com", "password": "correct-horse"})),
    )
    .await;
  assert_eq!(status, StatusCode::CREATED);
  assert!(app.state.setup.read().await.token.is_none());
}

/// An instance that already has root starts without a setup token.
#[tokio::test]
async fn initialized_instance_has_no_setup_token() {
  let schema = crate::support::unique_schema();
  let _guard = crate::support::SchemaGuard(schema.clone());
  let config = crate::support::config_for(&schema);
  let db = app::server::prepare_instance(&config).await.unwrap();
  app::modules::bootstrap::service::create_root(&db, "root@example.com", "correct-horse")
    .await
    .unwrap();
  db.close().await;
  let state = app::server::build_state(config).await.unwrap();
  assert!(state.setup.read().await.token.is_none());
}

/// `DOPGATE_ROOT_EMAIL` on a fresh database creates root with a generated
/// password that works, once. A second start leaves root alone.
#[tokio::test]
async fn root_email_creates_root_with_a_generated_password_once() {
  let schema = crate::support::unique_schema();
  let _guard = crate::support::SchemaGuard(schema.clone());
  let mut config = crate::support::config_for(&schema);
  config.root_email = Some("owner@example.com".into());
  let (state, setup) = app::server::build_state_with_setup(config.clone())
    .await
    .unwrap();
  let app::server::RootSetup::Created { email, password } = setup else {
    panic!("root was not created");
  };
  assert_eq!(email, "owner@example.com");
  assert!(password.len() >= 24);
  assert!(state.setup.read().await.token.is_none());

  let router = app::server::router(state.clone());
  let app = crate::support::TestApp {
    state,
    router,
    _schema: crate::support::SchemaGuard(crate::support::unique_schema()),
  };
  let token = app.console_login("owner@example.com", &password).await;
  let (_, me) = app
    .request_with(Method::GET, "/api/v1/console/me", None, Some(&token))
    .await;
  assert_eq!(me["data"]["role"], "root");
  assert!(me["data"]["id"].as_str().unwrap().starts_with("adm_"));

  let (_, again) = app::server::build_state_with_setup(config).await.unwrap();
  assert!(matches!(again, app::server::RootSetup::Exists));
}
