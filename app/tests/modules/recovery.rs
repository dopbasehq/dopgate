//! Forgot and reset password by emailed code.

use axum::http::{Method, StatusCode};
use serde_json::json;

use crate::support::{PASSWORD, TestApp, smtp::FakeSmtp, use_smtp};

#[tokio::test]
async fn a_reset_code_sets_a_new_password_and_ends_every_session() {
  let smtp = FakeSmtp::start().await;
  let app = TestApp::with(|config| use_smtp(config, &smtp)).await;
  let root = app.root_token().await;
  app.create_user(&root, "ada@example.com").await;
  let session = app.login("ada@example.com", PASSWORD).await;

  let (status, _) = app
    .request(
      Method::POST,
      "/api/v1/auth/password/forgot",
      Some(json!({ "email": "ada@example.com" })),
    )
    .await;
  assert_eq!(status, StatusCode::OK);
  let code = smtp.code_for("ada@example.com").await;

  let (status, body) = app
    .request(
      Method::POST,
      "/api/v1/auth/password/reset",
      Some(json!({ "email": "ada@example.com", "code": code, "newPassword": "short" })),
    )
    .await;
  assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");

  let (status, body) = app
    .request(
      Method::POST,
      "/api/v1/auth/password/reset",
      Some(json!({ "email": "ada@example.com", "code": code, "newPassword": "a fresh password" })),
    )
    .await;
  assert_eq!(status, StatusCode::OK, "{body}");
  let (status, _) = app
    .request_with(Method::GET, "/api/v1/auth/me", None, Some(&session))
    .await;
  assert_eq!(status, StatusCode::UNAUTHORIZED);
  app.login("ada@example.com", "a fresh password").await;
}

#[tokio::test]
async fn unknown_emails_get_the_same_answer_and_no_mail() {
  let smtp = FakeSmtp::start().await;
  let app = TestApp::with(|config| use_smtp(config, &smtp)).await;
  let (status, body) = app
    .request(
      Method::POST,
      "/api/v1/auth/password/forgot",
      Some(json!({ "email": "nobody@example.com" })),
    )
    .await;
  assert_eq!(status, StatusCode::OK);
  assert_eq!(body["message"], "PASSWORD_RESET_SENT");
  tokio::time::sleep(std::time::Duration::from_millis(300)).await;
  assert!(smtp.messages_to("nobody@example.com").is_empty());
}

#[tokio::test]
async fn a_reset_unlocks_a_locked_account() {
  let smtp = FakeSmtp::start().await;
  let app = TestApp::with(|config| use_smtp(config, &smtp)).await;
  let root = app.root_token().await;
  app.create_user(&root, "ada@example.com").await;
  for _ in 0..5 {
    app
      .request(
        Method::POST,
        "/api/v1/auth/login",
        Some(json!({ "email": "ada@example.com", "password": "wrong" })),
      )
      .await;
  }
  app
    .request(
      Method::POST,
      "/api/v1/auth/password/forgot",
      Some(json!({ "email": "ada@example.com" })),
    )
    .await;
  let code = smtp.code_for("ada@example.com").await;
  app
    .request(
      Method::POST,
      "/api/v1/auth/password/reset",
      Some(json!({ "email": "ada@example.com", "code": code, "newPassword": "a fresh password" })),
    )
    .await;
  app.login("ada@example.com", "a fresh password").await;
}
