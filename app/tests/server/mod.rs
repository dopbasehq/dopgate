//! The router around the modules: error shapes, headers, CORS, and the
//! console fallback.

use axum::http::{Method, StatusCode, header};

use crate::support::TestApp;

#[tokio::test]
async fn responses_carry_hardening_headers_and_a_request_id() {
  let app = TestApp::new().await;
  let reply = app.send(Method::GET, "/api/v1/health", &[], "").await;
  let header = |name: &str| {
    reply
      .headers
      .get(name)
      .unwrap()
      .to_str()
      .unwrap()
      .to_owned()
  };
  assert_eq!(header("x-content-type-options"), "nosniff");
  assert_eq!(header("x-frame-options"), "DENY");
  assert_eq!(header("referrer-policy"), "no-referrer");
  assert_eq!(header("cache-control"), "no-store");
  assert!(header("content-security-policy").contains("frame-ancestors 'none'"));
  assert!(!header("x-request-id").is_empty());
}

#[tokio::test]
async fn malformed_json_gets_a_json_error() {
  let app = TestApp::new().await;
  let reply = app
    .send(
      Method::POST,
      "/api/v1/auth/login",
      &[(header::CONTENT_TYPE.as_str(), "application/json")],
      "{",
    )
    .await;
  assert_eq!(reply.status, StatusCode::BAD_REQUEST);
  assert!(reply.json["error"]["REQUEST_INVALID"].is_string());
  assert_eq!(reply.json["success"], false);
}

#[tokio::test]
async fn unknown_routes_and_wrong_methods_get_json_errors() {
  let app = TestApp::new().await;
  let reply = app
    .send(Method::GET, "/api/v1/no-such-route", &[], "")
    .await;
  assert_eq!(reply.status, StatusCode::NOT_FOUND);
  assert!(reply.json["error"]["REQUEST_INVALID"].is_string());

  let reply = app.send(Method::DELETE, "/api/v1/health", &[], "").await;
  assert_eq!(reply.status, StatusCode::METHOD_NOT_ALLOWED);
  assert!(reply.json["error"]["REQUEST_INVALID"].is_string());
}

#[tokio::test]
async fn pages_are_not_served_while_the_web_ui_is_off() {
  let app = TestApp::with(|config| config.web_ui_enabled = false).await;
  let reply = app.send(Method::GET, "/sign-in", &[], "").await;
  assert_eq!(reply.status, StatusCode::NOT_FOUND);
  assert!(reply.json["error"]["REQUEST_INVALID"].is_string());
}

#[tokio::test]
async fn missing_assets_are_404_not_the_page() {
  let app = TestApp::new().await;
  let reply = app
    .send(Method::GET, "/assets/missing-file.js", &[], "")
    .await;
  assert_eq!(reply.status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn allowed_origins_pass_cors_and_others_do_not() {
  let app = TestApp::with(|config| {
    config.allowed_origins = vec!["https://app.example.com".into()];
  })
  .await;
  let preflight = |origin: &'static str| {
    let app = &app;
    async move {
      app
        .send(
          Method::OPTIONS,
          "/api/v1/auth/login",
          &[
            ("origin", origin),
            ("access-control-request-method", "POST"),
            ("access-control-request-headers", "content-type"),
          ],
          "",
        )
        .await
    }
  };
  let allowed = preflight("https://app.example.com").await;
  assert_eq!(
    allowed.headers.get("access-control-allow-origin").unwrap(),
    "https://app.example.com"
  );
  let refused = preflight("https://evil.example.com").await;
  assert!(refused.headers.get("access-control-allow-origin").is_none());
}
