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
  assert!(body["data"]["userId"].as_str().unwrap().starts_with("usr_"));

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
  assert_eq!(status, StatusCode::BAD_REQUEST);
  assert!(body["error"]["EMAIL_INVALID"].is_string());

  let (status, body) = app
    .request(
      Method::POST,
      ROOT,
      Some(json!({"setupToken": token, "email": "root@example.com", "password": "short"})),
    )
    .await;
  assert_eq!(status, StatusCode::BAD_REQUEST);
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
  let directory = tempfile::TempDir::new().unwrap();
  let config = crate::support::config_in(&directory);
  let (db, _) = app::server::prepare_instance(&config).await.unwrap();
  app::modules::bootstrap::service::create_root(&db, "root@example.com", "correct-horse")
    .await
    .unwrap();
  db.close().await;
  let state = app::server::build_state(config).await.unwrap();
  assert!(state.setup.read().await.token.is_none());
}
