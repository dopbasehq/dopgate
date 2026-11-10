//! Root and admins: who may manage them, and what each action does.

use axum::http::{Method, StatusCode};
use serde_json::json;

use crate::support::{PASSWORD, TestApp};

const SERVICE_KEY: &str = "a-service-key-that-is-long-enough-1234";

async fn root_id(
  app: &TestApp,
  root: &str,
) -> String {
  let (_, me) = app
    .request_with(Method::GET, "/api/v1/console/me", None, Some(root))
    .await;
  me["data"]["id"].as_str().unwrap().to_owned()
}

#[tokio::test]
async fn root_adds_and_manages_admins() {
  let app = TestApp::new().await;
  let root = app.root_token().await;
  let id = app.create_admin(&root, "ana@example.com").await;
  assert!(id.starts_with("adm_"));

  let (status, list) = app
    .request_with(Method::GET, "/api/v1/admin/admins", None, Some(&root))
    .await;
  assert_eq!(status, StatusCode::OK);
  let items = list["data"]["items"].as_array().unwrap();
  assert_eq!(items.len(), 2);
  assert_eq!(items[0]["role"], "root");
  assert_eq!(items[1]["email"], "ana@example.com");
  assert_eq!(items[1]["role"], "admin");

  let (status, body) = app
    .request_with(
      Method::PATCH,
      &format!("/api/v1/admin/admins/{id}"),
      Some(json!({ "displayName": "Ana" })),
      Some(&root),
    )
    .await;
  assert_eq!(status, StatusCode::OK, "{body}");
  assert_eq!(body["data"]["displayName"], "Ana");

  // Disabling ends the admin's console sessions and blocks sign-in.
  let session = app.console_login("ana@example.com", PASSWORD).await;
  let (status, _) = app
    .request_with(
      Method::POST,
      &format!("/api/v1/admin/admins/{id}/disable"),
      None,
      Some(&root),
    )
    .await;
  assert_eq!(status, StatusCode::OK);
  let (status, _) = app
    .request_with(Method::GET, "/api/v1/console/me", None, Some(&session))
    .await;
  assert_eq!(status, StatusCode::UNAUTHORIZED);
  let (status, body) = app
    .request(
      Method::POST,
      "/api/v1/console/login",
      Some(json!({ "email": "ana@example.com", "password": PASSWORD })),
    )
    .await;
  assert_eq!(status, StatusCode::FORBIDDEN);
  assert!(body["error"]["ACCOUNT_DISABLED"].is_string());
  app
    .request_with(
      Method::POST,
      &format!("/api/v1/admin/admins/{id}/enable"),
      None,
      Some(&root),
    )
    .await;
  app.console_login("ana@example.com", PASSWORD).await;

  let reply = app
    .call(
      Method::DELETE,
      &format!("/api/v1/admin/admins/{id}"),
      None,
      Some(&root),
      &[],
    )
    .await;
  assert_eq!(reply.status, StatusCode::NO_CONTENT);
  let (_, events) = app
    .request_with(
      Method::GET,
      "/api/v1/admin/audit-events?action=admin.deleted",
      None,
      Some(&root),
    )
    .await;
  assert_eq!(
    events["data"]["items"][0]["metadata"]["email"],
    "ana@example.com"
  );
}

#[tokio::test]
async fn admins_read_the_list_but_only_root_changes_it() {
  let app = TestApp::with(|config| {
    config.service_key = Some(zeroize::Zeroizing::new(SERVICE_KEY.into()));
  })
  .await;
  let root = app.root_token().await;
  let other = app.create_admin(&root, "bo@example.com").await;
  app.create_admin(&root, "ana@example.com").await;
  let admin = app.console_login("ana@example.com", PASSWORD).await;

  for token in [admin.as_str(), SERVICE_KEY] {
    let (status, _) = app
      .request_with(Method::GET, "/api/v1/admin/admins", None, Some(token))
      .await;
    assert_eq!(status, StatusCode::OK);
    for (method, path, body) in [
      (
        Method::POST,
        "/api/v1/admin/admins".to_owned(),
        Some(json!({ "email": "x@example.com" })),
      ),
      (
        Method::PATCH,
        format!("/api/v1/admin/admins/{other}"),
        Some(json!({ "displayName": "X" })),
      ),
      (
        Method::POST,
        format!("/api/v1/admin/admins/{other}/disable"),
        None,
      ),
      (
        Method::DELETE,
        format!("/api/v1/admin/admins/{other}"),
        None,
      ),
    ] {
      let (status, _) = app.request_with(method, &path, body, Some(token)).await;
      assert_eq!(status, StatusCode::FORBIDDEN, "{path}");
    }
  }
}

#[tokio::test]
async fn root_cannot_be_changed_through_the_api() {
  let app = TestApp::new().await;
  let root = app.root_token().await;
  let root_id = root_id(&app, &root).await;
  assert!(root_id.starts_with("adm_"));
  for (method, path) in [
    (Method::DELETE, format!("/api/v1/admin/admins/{root_id}")),
    (
      Method::POST,
      format!("/api/v1/admin/admins/{root_id}/disable"),
    ),
    (Method::PATCH, format!("/api/v1/admin/admins/{root_id}")),
  ] {
    let (status, body) = app
      .request_with(method, &path, Some(json!({})), Some(&root))
      .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{path}");
    assert!(body["error"]["ROOT_PROTECTED"].is_string(), "{body}");
  }
}

#[tokio::test]
async fn admin_emails_are_unique_among_admins() {
  let app = TestApp::new().await;
  let root = app.root_token().await;
  app.create_admin(&root, "ana@example.com").await;
  let (status, body) = app
    .request_with(
      Method::POST,
      "/api/v1/admin/admins",
      Some(json!({ "email": "Ana@Example.com" })),
      Some(&root),
    )
    .await;
  assert_eq!(status, StatusCode::CONFLICT, "{body}");
  assert!(body["error"]["EMAIL_TAKEN"].is_string());
}
