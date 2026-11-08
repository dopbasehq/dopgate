//! Every route in the OpenAPI document answers, and answers the way its
//! phase says it should. The list comes from the document itself, so a new
//! route without an entry here fails `public_routes_are_all_listed`.

use std::collections::BTreeSet;

use axum::http::{Method, StatusCode, header};
use serde_json::{Value, json};

use crate::support::TestApp;

/// Routes that work today, with the status a bare request gets.
const WORKING: [(&str, &str, u16); 3] = [
  ("GET", "/api/v1/health", 200),
  ("GET", "/api/v1/bootstrap/status", 200),
  ("POST", "/api/v1/bootstrap/root", 401),
];

/// Public placeholders, with a request that passes body and query parsing.
fn public_placeholders() -> Vec<(&'static str, &'static str, Option<Value>)> {
  vec![
    ("GET", "/api/v1/auth/methods", None),
    (
      "POST",
      "/api/v1/auth/signup",
      Some(json!({"email": "user@example.com", "password": "correct-horse"})),
    ),
    (
      "POST",
      "/api/v1/auth/login",
      Some(json!({"email": "user@example.com", "password": "correct-horse"})),
    ),
    (
      "POST",
      "/api/v1/auth/refresh",
      Some(json!({"refreshToken": "dgr_x"})),
    ),
    (
      "POST",
      "/api/v1/auth/password/forgot",
      Some(json!({"email": "user@example.com", "method": "otp"})),
    ),
    (
      "POST",
      "/api/v1/auth/password/reset",
      Some(json!({"token": "dgl_x", "newPassword": "correct-horse"})),
    ),
    (
      "POST",
      "/api/v1/auth/verification/send",
      Some(json!({"email": "user@example.com", "purpose": "email_verify", "method": "link"})),
    ),
    (
      "POST",
      "/api/v1/auth/verification/confirm",
      Some(json!({"purpose": "login", "email": "user@example.com", "code": "123456"})),
    ),
    (
      "POST",
      "/api/v1/auth/mfa/challenge",
      Some(json!({"mfaToken": "m", "code": "123456"})),
    ),
    ("GET", "/api/v1/auth/sso/providers", None),
    (
      "GET",
      "/api/v1/auth/sso/{provider_id}/start?redirectUrl=https%3A%2F%2Fapp.example.com",
      None,
    ),
    ("GET", "/api/v1/auth/sso/callback?code=c&state=s", None),
    (
      "POST",
      "/api/v1/auth/sso/exchange",
      Some(json!({"handoffCode": "ssoh_x"})),
    ),
    ("GET", "/.well-known/jwks.json", None),
    ("GET", "/.well-known/openid-configuration", None),
    (
      "GET",
      "/oauth/authorize?response_type=code&client_id=c&redirect_uri=https%3A%2F%2Fa.example&scope=openid",
      None,
    ),
    // The token endpoint takes a form, sent separately below.
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
async fn protected_routes_need_a_token_then_answer_not_implemented() {
  let app = TestApp::new().await;
  let (protected, _) = documented_routes(&app).await;
  assert!(
    protected.len() >= 40,
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
    let reply = app
      .send(
        method.clone(),
        &uri,
        &[(header::AUTHORIZATION.as_str(), "Bearer not-a-real-token")],
        "",
      )
      .await;
    assert_eq!(
      reply.status,
      StatusCode::NOT_IMPLEMENTED,
      "{method} {path} with a token"
    );
    assert!(reply.json["error"]["NOT_IMPLEMENTED"].is_string());
  }
}

#[tokio::test]
async fn public_placeholders_answer_not_implemented() {
  let app = TestApp::new().await;
  for (method, path, body) in public_placeholders() {
    let uri = concrete(path);
    let (status, json) = app.request(method.parse().unwrap(), &uri, body).await;
    assert_eq!(
      status,
      StatusCode::NOT_IMPLEMENTED,
      "{method} {path}: {json}"
    );
    assert!(
      json["error"]["NOT_IMPLEMENTED"].is_string(),
      "{method} {path}"
    );
  }
  let reply = app
    .send(
      Method::POST,
      "/oauth/token",
      &[(
        header::CONTENT_TYPE.as_str(),
        "application/x-www-form-urlencoded",
      )],
      "grant_type=authorization_code&code=c",
    )
    .await;
  assert_eq!(reply.status, StatusCode::NOT_IMPLEMENTED);
}

#[tokio::test]
async fn working_routes_answer() {
  let app = TestApp::new().await;
  for (method, path, expected) in WORKING {
    let body = (method == "POST").then(|| {
      json!({"setupToken": "setup_wrong", "email": "root@example.com", "password": "correct-horse"})
    });
    let (status, _) = app.request(method.parse().unwrap(), path, body).await;
    assert_eq!(status.as_u16(), expected, "{method} {path}");
  }
}

/// A public route added to the API must be added to one of the lists above.
#[tokio::test]
async fn public_routes_are_all_listed() {
  let app = TestApp::new().await;
  let (_, public) = documented_routes(&app).await;
  let documented: BTreeSet<(String, String)> = public.into_iter().collect();
  let mut listed: BTreeSet<(String, String)> = public_placeholders()
    .into_iter()
    .map(|(method, path, _)| {
      let path = path.split('?').next().unwrap();
      (method.to_owned(), path.to_owned())
    })
    .collect();
  listed.insert(("POST".into(), "/oauth/token".into()));
  for (method, path, _) in WORKING {
    listed.insert((method.into(), path.into()));
  }
  assert_eq!(documented, listed);
}
