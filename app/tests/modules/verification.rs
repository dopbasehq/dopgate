//! Emailed codes: limits, wrong guesses, and sign-in without a password.

use axum::http::{Method, StatusCode};
use serde_json::{Value, json};

use crate::support::{TestApp, smtp::FakeSmtp, use_smtp};

async fn app_with_mail() -> (TestApp, FakeSmtp, String) {
  let smtp = FakeSmtp::start().await;
  let app = TestApp::with(|config| use_smtp(config, &smtp)).await;
  let root = app.root_token().await;
  (app, smtp, root)
}

async fn send(
  app: &TestApp,
  email: &str,
  purpose: &str,
) -> (StatusCode, Value) {
  app
    .request(
      Method::POST,
      "/api/v1/auth/verification/send",
      Some(json!({ "email": email, "purpose": purpose })),
    )
    .await
}

async fn confirm(
  app: &TestApp,
  email: &str,
  code: &str,
) -> (StatusCode, Value) {
  app
    .request(
      Method::POST,
      "/api/v1/auth/verification/confirm",
      Some(json!({ "email": email, "purpose": "login", "code": code })),
    )
    .await
}

#[tokio::test]
async fn an_emailed_code_signs_an_existing_user_in() {
  let (app, smtp, root) = app_with_mail().await;
  app.create_user(&root, "ada@example.com").await;
  let (status, _) = send(&app, "Ada@Example.com", "login").await;
  assert_eq!(status, StatusCode::OK);
  let code = smtp.code_for("ada@example.com").await;
  let spaced = format!("{} {}", &code[..3], &code[3..]);
  let (status, body) = confirm(&app, "ada@example.com", &spaced).await;
  assert_eq!(status, StatusCode::OK, "{body}");
  assert!(body["data"]["accessToken"].is_string());
}

#[tokio::test]
async fn unknown_emails_get_the_same_answer_and_no_mail() {
  let (app, smtp, _) = app_with_mail().await;
  let (status, body) = send(&app, "nobody@example.com", "login").await;
  assert_eq!(status, StatusCode::OK);
  assert_eq!(body["message"], "CODE_SENT");
  tokio::time::sleep(std::time::Duration::from_millis(300)).await;
  assert!(smtp.messages_to("nobody@example.com").is_empty());
}

#[tokio::test]
async fn passwordless_signup_creates_a_verified_user_when_allowed() {
  let (app, smtp, root) = app_with_mail().await;
  app
    .settings(&root, json!({ "signup": { "enabled": true, "requireEmailVerification": true, "passwordlessSignup": true } }))
    .await;
  send(&app, "new@example.com", "login").await;
  let code = smtp.code_for("new@example.com").await;
  let (status, body) = confirm(&app, "new@example.com", &code).await;
  assert_eq!(status, StatusCode::OK, "{body}");
  assert!(
    body["data"]["user"]["id"]
      .as_str()
      .unwrap()
      .starts_with("usr_")
  );
  assert_eq!(body["data"]["user"]["emailVerified"], true);
  assert_eq!(body["data"]["user"]["hasPassword"], false);
}

#[tokio::test]
async fn wrong_codes_count_down_then_burn_the_code() {
  let (app, smtp, root) = app_with_mail().await;
  app.create_user(&root, "ada@example.com").await;
  send(&app, "ada@example.com", "login").await;
  let code = smtp.code_for("ada@example.com").await;
  let wrong = if code == "000000" { "111111" } else { "000000" };
  for left in (1..=4).rev() {
    let (status, body) = confirm(&app, "ada@example.com", wrong).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let message = body["error"]["CODE_INVALID"].as_str().unwrap();
    assert!(message.contains(&format!("{left} tr")), "{message}");
  }
  let (_, body) = confirm(&app, "ada@example.com", wrong).await;
  assert!(
    body["error"]["CODE_INVALID"]
      .as_str()
      .unwrap()
      .contains("used up")
  );
  // The right code no longer works either.
  let (status, _) = confirm(&app, "ada@example.com", &code).await;
  assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn an_expired_code_is_refused() {
  let (app, smtp, root) = app_with_mail().await;
  app.create_user(&root, "ada@example.com").await;
  send(&app, "ada@example.com", "login").await;
  let code = smtp.code_for("ada@example.com").await;
  sqlx::query("UPDATE verification_tokens SET expires_at = now() - interval '1 second'")
    .execute(app.state.db.pool())
    .await
    .unwrap();
  let (status, body) = confirm(&app, "ada@example.com", &code).await;
  assert_eq!(status, StatusCode::BAD_REQUEST);
  assert!(body["error"]["CODE_EXPIRED"].is_string());
}

#[tokio::test]
async fn asking_again_waits_and_replaces_the_earlier_code() {
  let (app, smtp, root) = app_with_mail().await;
  app.create_user(&root, "ada@example.com").await;
  send(&app, "ada@example.com", "login").await;
  let first = smtp.code_for("ada@example.com").await;
  let reply = app
    .call(
      Method::POST,
      "/api/v1/auth/verification/send",
      Some(json!({ "email": "ada@example.com", "purpose": "login" })),
      None,
      &[],
    )
    .await;
  assert_eq!(reply.status, StatusCode::TOO_MANY_REQUESTS);
  assert!(reply.headers.contains_key("retry-after"));

  app
    .settings(
      &root,
      json!({ "limits": { "codeMinutes": 10, "codeMaxAttempts": 5, "codeResendSeconds": 0, "codesPerHour": 5,
                          "lockoutAttempts": 5, "lockoutMinutes": 15, "ipRequestsPerMinute": 20 } }),
    )
    .await;
  send(&app, "ada@example.com", "login").await;
  smtp.wait_for("ada@example.com", 2).await;
  let second = smtp.code_for("ada@example.com").await;
  if first != second {
    let (status, _) = confirm(&app, "ada@example.com", &first).await;
    assert_eq!(
      status,
      StatusCode::BAD_REQUEST,
      "the replaced code still worked"
    );
  }
  let (status, _) = confirm(&app, "ada@example.com", &second).await;
  assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn the_send_endpoint_only_handles_its_own_purposes() {
  let (app, _smtp, _) = app_with_mail().await;
  let (status, _) = send(&app, "ada@example.com", "password_reset").await;
  assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}
