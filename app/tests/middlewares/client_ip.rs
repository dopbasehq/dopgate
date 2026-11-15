//! A backend that signs people in for them passes on the visitor's address
//! and browser with its backend key.

use axum::http::{Method, StatusCode};
use serde_json::{Value, json};

use crate::support::{PASSWORD, Reply, TestApp};

const SERVICE_KEY: &str = "a-service-key-that-is-long-enough-1234";

async fn with_service_key() -> TestApp {
  TestApp::with(|config| {
    config.service_key = Some(zeroize::Zeroizing::new(SERVICE_KEY.into()));
  })
  .await
}

async fn login(
  app: &TestApp,
  headers: &[(&str, &str)],
) -> Reply {
  app
    .call(
      Method::POST,
      "/api/v1/auth/login",
      Some(json!({ "email": "ada@example.com", "password": PASSWORD })),
      None,
      headers,
    )
    .await
}

/// The device the access token belongs to, as the user's device list shows
/// it.
async fn current_device(
  app: &TestApp,
  access_token: &str,
) -> Value {
  let (status, body) = app
    .request_with(
      Method::GET,
      "/api/v1/auth/sessions",
      None,
      Some(access_token),
    )
    .await;
  assert_eq!(status, StatusCode::OK, "{body}");
  body["data"]
    .as_array()
    .unwrap()
    .iter()
    .find(|device| device["current"] == true)
    .unwrap()
    .clone()
}

#[tokio::test]
async fn with_the_key_the_session_records_the_visitor() {
  let app = with_service_key().await;
  let root = app.root_token().await;
  app.create_user(&root, "ada@example.com").await;

  let reply = login(
    &app,
    &[
      ("x-dopgate-backend-key", SERVICE_KEY),
      ("x-dopgate-client-ip", "198.51.100.7"),
      ("x-dopgate-client-agent", "Firefox on the visitor's laptop"),
      ("user-agent", "the-backend/1.0"),
    ],
  )
  .await;
  assert_eq!(reply.status, StatusCode::OK, "{}", reply.json);
  let device = current_device(&app, reply.json["data"]["accessToken"].as_str().unwrap()).await;
  assert_eq!(device["ipAddress"], "198.51.100.7");
  assert_eq!(device["userAgent"], "Firefox on the visitor's laptop");
}

#[tokio::test]
async fn without_the_key_the_visitor_headers_are_ignored() {
  let app = with_service_key().await;
  let root = app.root_token().await;
  app.create_user(&root, "ada@example.com").await;

  let reply = login(
    &app,
    &[
      ("x-dopgate-client-ip", "198.51.100.7"),
      ("x-dopgate-client-agent", "Firefox"),
      ("user-agent", "curl/8"),
    ],
  )
  .await;
  assert_eq!(reply.status, StatusCode::OK, "{}", reply.json);
  let device = current_device(&app, reply.json["data"]["accessToken"].as_str().unwrap()).await;
  assert!(device["ipAddress"].is_null(), "{device}");
  assert_eq!(device["userAgent"], "curl/8");
}

#[tokio::test]
async fn a_wrong_key_or_a_bad_address_is_refused() {
  let app = with_service_key().await;
  let root = app.root_token().await;
  app.create_user(&root, "ada@example.com").await;

  // The right email and password with a wrong key: the answer names the
  // key, in a code of its own, and not the password.
  let reply = login(&app, &[("x-dopgate-backend-key", "not-the-key")]).await;
  assert_eq!(reply.status, StatusCode::UNAUTHORIZED);
  assert!(
    reply.json["error"]["BACKEND_KEY_INVALID"].is_string(),
    "{}",
    reply.json
  );
  assert!(reply.json["error"]["AUTHENTICATION_INVALID"].is_null());
  assert!(reply.headers.contains_key("x-request-id"));

  let reply = login(
    &app,
    &[
      ("x-dopgate-backend-key", SERVICE_KEY),
      ("x-dopgate-client-ip", "not-an-address"),
    ],
  )
  .await;
  assert_eq!(reply.status, StatusCode::BAD_REQUEST);
  assert!(reply.json["error"]["REQUEST_INVALID"].is_string());

  // An instance without a service key accepts no backend key at all.
  let bare = TestApp::new().await;
  let reply = login(&bare, &[("x-dopgate-backend-key", SERVICE_KEY)]).await;
  assert_eq!(reply.status, StatusCode::UNAUTHORIZED);
  assert!(reply.json["error"]["BACKEND_KEY_INVALID"].is_string());
}

/// A wrong key is refused on every route, also the ones anyone may call,
/// so a backend can check its key at startup without signing anyone in.
#[tokio::test]
async fn a_wrong_key_is_refused_on_a_public_route_too() {
  let app = with_service_key().await;
  let methods = |key: &'static str| {
    let app = &app;
    async move {
      app
        .call(
          Method::GET,
          "/api/v1/auth/methods",
          None,
          None,
          &[("x-dopgate-backend-key", key)],
        )
        .await
    }
  };
  let reply = methods("not-the-key").await;
  assert_eq!(reply.status, StatusCode::UNAUTHORIZED);
  assert!(reply.json["error"]["BACKEND_KEY_INVALID"].is_string());
  assert_eq!(methods(SERVICE_KEY).await.status, StatusCode::OK);
}

#[tokio::test]
async fn each_visitor_gets_their_own_address_limit() {
  let app = with_service_key().await;
  let root = app.root_token().await;
  app.create_user(&root, "ada@example.com").await;
  app
    .settings(&root, json!({ "limits": { "ipRequestsPerMinute": 2 } }))
    .await;

  let from = |address: &'static str| {
    [
      ("x-dopgate-backend-key", SERVICE_KEY),
      ("x-dopgate-client-ip", address),
    ]
  };
  for _ in 0..2 {
    assert_eq!(
      login(&app, &from("198.51.100.7")).await.status,
      StatusCode::OK
    );
  }
  let reply = login(&app, &from("198.51.100.7")).await;
  assert_eq!(reply.status, StatusCode::TOO_MANY_REQUESTS);
  // Another visitor of the same backend still has their whole budget.
  assert_eq!(
    login(&app, &from("203.0.113.4")).await.status,
    StatusCode::OK
  );
}
