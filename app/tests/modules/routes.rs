//! Every route in the OpenAPI document answers. The public list comes from
//! the document itself, so a new public route without an entry here fails
//! `public_routes_are_all_listed`.

use std::collections::BTreeSet;

use axum::http::{Method, StatusCode, header};
use serde_json::{Value, json};

use crate::support::TestApp;

/// Public routes, a request for each, and the status a fresh instance gives.
/// Sign-up, sign-in, tokens, and codes answer 501 until their pull
/// requests land.
fn public_routes() -> Vec<(&'static str, &'static str, Option<Value>, u16)> {
  vec![
    ("GET", "/api/v1/health", None, 200),
    ("GET", "/api/v1/bootstrap/status", None, 200),
    (
      "POST",
      "/api/v1/bootstrap/root",
      Some(
        json!({"setupToken": "setup_wrong", "email": "root@example.com", "password": "correct-horse"}),
      ),
      401,
    ),
    ("GET", "/.well-known/jwks.json", None, 501),
    ("GET", "/api/v1/auth/methods", None, 501),
    (
      "POST",
      "/api/v1/auth/signup",
      Some(json!({"email": "user@example.com", "password": "correct-horse"})),
      501,
    ),
    (
      "POST",
      "/api/v1/auth/login",
      Some(json!({"email": "user@example.com", "password": "correct-horse"})),
      501,
    ),
    (
      "POST",
      "/api/v1/auth/refresh",
      Some(json!({"refreshToken": "dgr_x"})),
      501,
    ),
    (
      "POST",
      "/api/v1/auth/password/forgot",
      Some(json!({"email": "user@example.com", "method": "otp"})),
      501,
    ),
    (
      "POST",
      "/api/v1/auth/password/reset",
      Some(json!({"token": "dgl_x", "newPassword": "correct-horse"})),
      501,
    ),
    (
      "POST",
      "/api/v1/auth/verification/send",
      Some(json!({"email": "user@example.com", "purpose": "email_verify", "method": "link"})),
      501,
    ),
    (
      "POST",
      "/api/v1/auth/verification/confirm",
      Some(json!({"purpose": "login", "email": "user@example.com", "code": "123456"})),
      501,
    ),
    (
      "POST",
      "/api/v1/auth/mfa/challenge",
      Some(json!({"mfaToken": "m", "code": "123456"})),
      501,
    ),
    ("GET", "/api/v1/auth/sso/providers", None, 501),
    (
      "GET",
      "/api/v1/auth/sso/{provider_id}/start?redirectUrl=https%3A%2F%2Fapp.example.com",
      None,
      501,
    ),
    ("GET", "/api/v1/auth/sso/callback?code=c&state=s", None, 501),
    (
      "POST",
      "/api/v1/auth/sso/exchange",
      Some(json!({"handoffCode": "ssoh_x"})),
      501,
    ),
  ]
}

/// Every `(method, path)` in the OpenAPI document, split by whether it needs
/// a bearer token.
async fn documented_routes(app: &TestApp) -> (Vec<(String, String)>, Vec<(String, String)>) {
  let (_, doc) = app.request(Method::GET, "/api/v1/openapi.json", None).await;
  let mut protected = Vec::new();
  let mut public = Vec::new();
  for (path, item) in doc["paths"].as_object().unwrap() {
    for (method, operation) in item.as_object().unwrap() {
      let needs_bearer = operation["security"].as_array().is_some_and(|options| {
        options
          .iter()
          .all(|option| option.get("bearerAuth").is_some())
      });
      let route = (method.to_uppercase(), path.clone());
      if needs_bearer {
        protected.push(route);
      } else {
        public.push(route);
      }
    }
  }
  (protected, public)
}

/// Fill path parameters such as `{id}` with a placeholder value.
fn concrete(path: &str) -> String {
  path
    .split('/')
    .map(|segment| {
      if segment.starts_with('{') {
        "x"
      } else {
        segment
      }
    })
    .collect::<Vec<_>>()
    .join("/")
}

#[tokio::test]
async fn protected_routes_refuse_missing_and_bad_tokens() {
  let app = TestApp::new().await;
  let (protected, _) = documented_routes(&app).await;
  assert!(
    protected.len() >= 25,
    "only {} protected routes",
    protected.len()
  );
  for (method, path) in protected {
    let method: Method = method.parse().unwrap();
    let uri = concrete(&path);

    let reply = app.send(method.clone(), &uri, &[], "").await;
    assert_eq!(
      reply.status,
      StatusCode::UNAUTHORIZED,
      "{method} {path} without a token"
    );
    assert!(reply.json["error"]["AUTHENTICATION_REQUIRED"].is_string());

    // The token is checked before the body is read, so no body is needed.
    // Access tokens arrive with sign-in, so only a wrong service key is
    // checked here.
    for token in ["not-a-real-token"] {
      let bearer = format!("Bearer {token}");
      let reply = app
        .send(
          method.clone(),
          &uri,
          &[(header::AUTHORIZATION.as_str(), bearer.as_str())],
          "",
        )
        .await;
      assert_eq!(
        reply.status,
        StatusCode::UNAUTHORIZED,
        "{method} {path} with {token}"
      );
    }
  }
}

#[tokio::test]
async fn public_routes_answer() {
  let app = TestApp::new().await;
  for (method, path, body, expected) in public_routes() {
    let uri = concrete(path);
    let (status, json) = app.request(method.parse().unwrap(), &uri, body).await;
    assert_eq!(status.as_u16(), expected, "{method} {path}: {json}");
    if expected == 501 {
      assert!(
        json["error"]["NOT_IMPLEMENTED"].is_string(),
        "{method} {path}"
      );
    }
  }
}

#[tokio::test]
async fn planned_routes_answer_not_implemented_to_the_service_key() {
  let app = TestApp::new().await;
  let root = crate::support::SERVICE_KEY;
  for (method, path) in [
    (Method::GET, "/api/v1/admin/sso/providers"),
    (Method::POST, "/api/v1/auth/mfa/totp/enroll"),
    (Method::GET, "/api/v1/admin/users"),
    (Method::GET, "/api/v1/admin/keys"),
  ] {
    let (status, body) = app
      .request_with(method.clone(), path, Some(json!({})), Some(root))
      .await;
    assert_eq!(
      status,
      StatusCode::NOT_IMPLEMENTED,
      "{method} {path}: {body}"
    );
  }
}

#[tokio::test]
async fn removed_routes_are_gone() {
  let app = TestApp::new().await;
  for path in [
    "/api/v1/admin/clients",
    "/api/v1/admin/backups",
    "/api/v1/admin/export",
    "/.well-known/openid-configuration",
  ] {
    let reply = app.send(Method::GET, path, &[], "").await;
    assert_eq!(reply.status, StatusCode::NOT_FOUND, "{path}");
  }
}

/// A public route added to the API must be added to the list above.
#[tokio::test]
async fn public_routes_are_all_listed() {
  let app = TestApp::new().await;
  let (_, public) = documented_routes(&app).await;
  let documented: BTreeSet<(String, String)> = public.into_iter().collect();
  let listed: BTreeSet<(String, String)> = public_routes()
    .into_iter()
    .map(|(method, path, _, _)| {
      let path = path.split('?').next().unwrap();
      (method.to_owned(), path.to_owned())
    })
    .collect();
  assert_eq!(documented, listed);
}
