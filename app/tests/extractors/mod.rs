//! Resolving the caller from the `Authorization` header.

use axum::http::{Method, StatusCode, header};

use crate::support::TestApp;

const ME: &str = "/api/v1/auth/me";

async fn me_with(
  app: &TestApp,
  authorization: &str,
) -> (StatusCode, serde_json::Value) {
  let reply = app
    .send(
      Method::GET,
      ME,
      &[(header::AUTHORIZATION.as_str(), authorization)],
      "",
    )
    .await;
  (reply.status, reply.json)
}

#[tokio::test]
async fn a_missing_header_asks_for_sign_in() {
  let app = TestApp::new().await;
  let (status, body) = app.request(Method::GET, ME, None).await;
  assert_eq!(status, StatusCode::UNAUTHORIZED);
  assert!(body["error"]["AUTHENTICATION_REQUIRED"].is_string());
}

#[tokio::test]
async fn malformed_headers_are_refused() {
  let app = TestApp::new().await;
  for value in [
    "Bearer",
    "Bearer ",
    "Basic dXNlcjpwYXNz",
    "token-without-scheme",
  ] {
    let (status, body) = me_with(&app, value).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED, "{value:?}");
    assert!(
      body["error"]["AUTHENTICATION_INVALID"].is_string(),
      "{value:?}"
    );
  }
}

/// The scheme name is case-insensitive. A well-formed token reaches token
/// verification, which answers 501 until phase 2.
#[tokio::test]
async fn the_bearer_scheme_ignores_case() {
  let app = TestApp::new().await;
  for value in ["Bearer abc", "bearer abc", "BEARER abc"] {
    let (status, _) = me_with(&app, value).await;
    assert_eq!(status, StatusCode::NOT_IMPLEMENTED, "{value:?}");
  }
}

#[tokio::test]
async fn client_secret_keys_are_recognised() {
  let app = TestApp::new().await;
  let reply = app
    .send(
      Method::GET,
      "/api/v1/admin/users",
      &[(header::AUTHORIZATION.as_str(), "Bearer sk_test")],
      "",
    )
    .await;
  assert_eq!(reply.status, StatusCode::NOT_IMPLEMENTED);
}
