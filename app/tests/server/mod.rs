//! The router around the modules: error shapes, headers, the maintenance
//! gate, the page fallback, and the single-server lock.

use std::sync::atomic::Ordering;

use app::server::InstanceLock;
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
  let app = TestApp::new().await;
  let reply = app.send(Method::GET, "/login", &[], "").await;
  assert_eq!(reply.status, StatusCode::NOT_FOUND);
  assert!(reply.json["error"]["REQUEST_INVALID"].is_string());
}

#[tokio::test]
async fn maintenance_answers_api_requests_with_503() {
  let app = TestApp::new().await;
  app.state.maintenance.store(true, Ordering::SeqCst);
  let (status, body) = app.request(Method::GET, "/api/v1/health", None).await;
  assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
  assert!(body["error"]["INSTANCE_RESTORING"].is_string());
  app.state.maintenance.store(false, Ordering::SeqCst);
  let (status, _) = app.request(Method::GET, "/api/v1/health", None).await;
  assert_eq!(status, StatusCode::OK);
}

#[test]
fn only_one_server_holds_a_database() {
  let directory = tempfile::TempDir::new().unwrap();
  let url = app::config::sqlite_url(&directory.path().join("dopgate.db"));
  let first = InstanceLock::acquire(&url).unwrap();
  assert!(first.is_some());
  assert!(InstanceLock::acquire(&url).is_err());
  drop(first);
  assert!(InstanceLock::acquire(&url).unwrap().is_some());
}
