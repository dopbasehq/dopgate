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

/// The scheme name is case-insensitive.
#[tokio::test]
async fn the_bearer_scheme_ignores_case() {
  let app = TestApp::new().await;
  let token = app.root_token().await;
  for scheme in ["Bearer", "bearer", "BEARER"] {
    let (status, _) = me_with(&app, &format!("{scheme} {token}")).await;
    assert_eq!(status, StatusCode::OK, "{scheme}");
  }
}

/// The service key reaches the admin API but has no account of its own.
#[tokio::test]
async fn the_service_key_is_an_admin_without_an_account() {
  let key = "k".repeat(40);
  let configured = key.clone();
  let app = TestApp::with(move |config| {
    config.service_key = Some(zeroize::Zeroizing::new(configured));
  })
  .await;
  let bearer = format!("Bearer {key}");
  let reply = app
    .send(
      Method::GET,
      "/api/v1/admin/settings",
      &[(header::AUTHORIZATION.as_str(), bearer.as_str())],
      "",
    )
    .await;
  assert_eq!(reply.status, StatusCode::OK);
  let (status, body) = me_with(&app, &bearer).await;
  assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
  let (status, _) = me_with(&app, &format!("Bearer {}", "x".repeat(40))).await;
  assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn no_service_key_means_no_service_access() {
  let app = TestApp::new().await;
  let reply = app
    .send(
      Method::GET,
      "/api/v1/admin/users",
      &[(
        header::AUTHORIZATION.as_str(),
        "Bearer some-long-value-without-dots-at-all",
      )],
      "",
    )
    .await;
  assert_eq!(reply.status, StatusCode::UNAUTHORIZED);
}
