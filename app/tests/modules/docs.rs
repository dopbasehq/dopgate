use std::collections::BTreeSet;

use axum::http::{Method, StatusCode};

use crate::support::TestApp;

/// Every module shows up in the OpenAPI document, placeholders included,
/// with the security schemes the routes refer to.
#[tokio::test]
async fn openapi_lists_every_module() {
  let app = TestApp::new().await;
  let (status, body) = app.request(Method::GET, "/api/v1/openapi.json", None).await;
  assert_eq!(status, StatusCode::OK);
  assert_eq!(body["info"]["title"], "Dopgate API");
  assert_eq!(body["info"]["version"], env!("CARGO_PKG_VERSION"));
  let tags: BTreeSet<&str> = body["tags"]
    .as_array()
    .unwrap()
    .iter()
    .map(|tag| tag["name"].as_str().unwrap())
    .collect();
  for tag in [
    "health",
    "bootstrap",
    "auth",
    "recovery",
    "verification",
    "sessions",
    "mfa",
    "sso",
    "users",
    "keys",
    "settings",
    "audit",
  ] {
    assert!(tags.contains(tag), "missing tag {tag}");
  }
  let schemes = body["components"]["securitySchemes"].as_object().unwrap();
  assert!(schemes.contains_key("bearerAuth"));
  for removed in ["clients", "oidc", "backups"] {
    assert!(!tags.contains(removed), "{removed} should be gone");
  }
}

/// Handlers share names such as `list` across modules; the document still
/// needs one ID per operation, or Swagger links and client generators break.
#[tokio::test]
async fn operation_ids_are_unique_and_prefixed_with_their_tag() {
  let app = TestApp::new().await;
  let (_, body) = app.request(Method::GET, "/api/v1/openapi.json", None).await;
  let mut seen = BTreeSet::new();
  for item in body["paths"].as_object().unwrap().values() {
    for operation in item.as_object().unwrap().values() {
      let id = operation["operationId"].as_str().unwrap();
      let tag = operation["tags"][0].as_str().unwrap();
      assert!(id.starts_with(&format!("{tag}_")), "{id} lacks its tag");
      assert!(seen.insert(id.to_owned()), "duplicate operation ID {id}");
    }
  }
}

#[tokio::test]
async fn swagger_ui_is_served() {
  let app = TestApp::new().await;
  let reply = app.send(Method::GET, "/api/docs/", &[], "").await;
  assert_eq!(reply.status, StatusCode::OK);
}

#[tokio::test]
async fn docs_can_be_turned_off() {
  let app = TestApp::with(|config| config.docs_enabled = false).await;
  let (status, _) = app.request(Method::GET, "/api/v1/openapi.json", None).await;
  assert_eq!(status, StatusCode::NOT_FOUND);
  let reply = app.send(Method::GET, "/api/docs/", &[], "").await;
  assert_eq!(reply.status, StatusCode::NOT_FOUND);
}
