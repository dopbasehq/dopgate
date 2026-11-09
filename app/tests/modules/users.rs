//! Admin user management: who may do what, and what each action does.

use axum::http::{Method, StatusCode};
use serde_json::json;

use crate::support::{PASSWORD, TestApp};

#[tokio::test]
async fn admins_list_search_and_page_through_users() {
  let app = TestApp::new().await;
  let root = app.root_token().await;
  for index in 0..5 {
    app
      .create_user(&root, &format!("user{index}@example.com"), "member")
      .await;
  }
  let (status, body) = app
    .request_with(
      Method::GET,
      "/api/v1/admin/users?limit=2&role=member",
      None,
      Some(&root),
    )
    .await;
  assert_eq!(status, StatusCode::OK);
  assert_eq!(body["data"]["items"].as_array().unwrap().len(), 2);
  let mut seen: Vec<String> = Vec::new();
  let mut cursor = body["data"]["nextCursor"].as_str().map(str::to_owned);
  seen.extend(
    body["data"]["items"]
      .as_array()
      .unwrap()
      .iter()
      .map(|u| u["email"].as_str().unwrap().to_owned()),
  );
  while let Some(next) = cursor {
    let (_, page) = app
      .request_with(
        Method::GET,
        &format!("/api/v1/admin/users?limit=2&role=member&cursor={next}"),
        None,
        Some(&root),
      )
      .await;
    seen.extend(
      page["data"]["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|u| u["email"].as_str().unwrap().to_owned()),
    );
    cursor = page["data"]["nextCursor"].as_str().map(str::to_owned);
  }
  seen.sort();
  seen.dedup();
  assert_eq!(seen.len(), 5);

  let (_, body) = app
    .request_with(
      Method::GET,
      "/api/v1/admin/users?search=USER3",
      None,
      Some(&root),
    )
    .await;
  assert_eq!(body["data"]["items"][0]["email"], "user3@example.com");
  assert_eq!(body["data"]["items"].as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn only_root_creates_and_manages_admins() {
  let app = TestApp::new().await;
  let root = app.root_token().await;
  let admin_id = app.create_user(&root, "admin@example.com", "admin").await;
  let other_admin = app.create_user(&root, "admin2@example.com", "admin").await;
  let member_id = app.create_user(&root, "member@example.com", "member").await;
  let admin = app.login("admin@example.com", PASSWORD).await;

  let (status, _) = app
    .request_with(
      Method::POST,
      "/api/v1/admin/users",
      Some(json!({ "email": "x@example.com", "role": "admin" })),
      Some(&admin),
    )
    .await;
  assert_eq!(status, StatusCode::FORBIDDEN);
  let (status, _) = app
    .request_with(
      Method::POST,
      &format!("/api/v1/admin/users/{other_admin}/disable"),
      None,
      Some(&admin),
    )
    .await;
  assert_eq!(status, StatusCode::FORBIDDEN);
  let (status, _) = app
    .request_with(
      Method::PATCH,
      &format!("/api/v1/admin/users/{member_id}"),
      Some(json!({ "role": "admin" })),
      Some(&admin),
    )
    .await;
  assert_eq!(status, StatusCode::FORBIDDEN);
  let (status, body) = app
    .request_with(
      Method::PATCH,
      &format!("/api/v1/admin/users/{member_id}"),
      Some(json!({ "privateMetadata": { "crm": "c_1" }, "displayName": "Mem" })),
      Some(&admin),
    )
    .await;
  assert_eq!(status, StatusCode::OK, "{body}");
  assert_eq!(body["data"]["privateMetadata"]["crm"], "c_1");

  let (status, body) = app
    .request_with(
      Method::PATCH,
      &format!("/api/v1/admin/users/{admin_id}"),
      Some(json!({ "role": "member" })),
      Some(&root),
    )
    .await;
  assert_eq!(status, StatusCode::OK);
  assert_eq!(body["data"]["role"], "member");
}

#[tokio::test]
async fn root_cannot_be_changed_through_the_api() {
  let app = TestApp::new().await;
  let root = app.root_token().await;
  let (_, me) = app
    .request_with(Method::GET, "/api/v1/auth/me", None, Some(&root))
    .await;
  let root_id = me["data"]["id"].as_str().unwrap().to_owned();
  for (method, path) in [
    (Method::DELETE, format!("/api/v1/admin/users/{root_id}")),
    (
      Method::POST,
      format!("/api/v1/admin/users/{root_id}/disable"),
    ),
    (Method::PATCH, format!("/api/v1/admin/users/{root_id}")),
  ] {
    let (status, body) = app
      .request_with(method, &path, Some(json!({})), Some(&root))
      .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{path}");
    assert!(body["error"]["ROOT_PROTECTED"].is_string(), "{body}");
  }
}

#[tokio::test]
async fn disabling_ends_sessions_and_blocks_sign_in() {
  let app = TestApp::new().await;
  let root = app.root_token().await;
  let id = app.create_user(&root, "ada@example.com", "member").await;
  let session = app.login("ada@example.com", PASSWORD).await;
  let (status, body) = app
    .request_with(
      Method::POST,
      &format!("/api/v1/admin/users/{id}/disable"),
      None,
      Some(&root),
    )
    .await;
  assert_eq!(status, StatusCode::OK);
  assert_eq!(body["data"]["status"], "disabled");
  let (status, _) = app
    .request_with(Method::GET, "/api/v1/auth/me", None, Some(&session))
    .await;
  assert_eq!(status, StatusCode::UNAUTHORIZED);
  let (status, body) = app
    .request(
      Method::POST,
      "/api/v1/auth/login",
      Some(json!({ "email": "ada@example.com", "password": PASSWORD })),
    )
    .await;
  assert_eq!(status, StatusCode::FORBIDDEN);
  assert!(body["error"]["ACCOUNT_DISABLED"].is_string());
  app
    .request_with(
      Method::POST,
      &format!("/api/v1/admin/users/{id}/enable"),
      None,
      Some(&root),
    )
    .await;
  app.login("ada@example.com", PASSWORD).await;
}

#[tokio::test]
async fn deleting_frees_the_email_and_is_audited() {
  let app = TestApp::new().await;
  let root = app.root_token().await;
  let id = app.create_user(&root, "ada@example.com", "member").await;
  let reply = app
    .call(
      Method::DELETE,
      &format!("/api/v1/admin/users/{id}"),
      None,
      Some(&root),
      &[],
    )
    .await;
  assert_eq!(reply.status, StatusCode::NO_CONTENT);
  let (status, _) = app
    .request_with(
      Method::GET,
      &format!("/api/v1/admin/users/{id}"),
      None,
      Some(&root),
    )
    .await;
  assert_eq!(status, StatusCode::NOT_FOUND);
  let new_id = app.create_user(&root, "ada@example.com", "member").await;
  assert_ne!(new_id, id);
  let (_, events) = app
    .request_with(
      Method::GET,
      "/api/v1/admin/audit-events?action=user.deleted",
      None,
      Some(&root),
    )
    .await;
  assert_eq!(
    events["data"]["items"][0]["metadata"]["email"],
    "ada@example.com"
  );
}

#[tokio::test]
async fn admins_see_and_end_a_users_sessions() {
  let app = TestApp::new().await;
  let root = app.root_token().await;
  let id = app.create_user(&root, "ada@example.com", "member").await;
  let session = app.login("ada@example.com", PASSWORD).await;
  let path = format!("/api/v1/admin/users/{id}/sessions");
  let (_, body) = app
    .request_with(Method::GET, &path, None, Some(&root))
    .await;
  assert_eq!(body["data"].as_array().unwrap().len(), 1);
  assert_eq!(body["data"][0]["current"], false);
  app
    .request_with(Method::DELETE, &path, None, Some(&root))
    .await;
  let (status, _) = app
    .request_with(Method::GET, "/api/v1/auth/me", None, Some(&session))
    .await;
  assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn bad_input_is_refused_with_a_reason() {
  let app = TestApp::new().await;
  let root = app.root_token().await;
  app.create_user(&root, "ada@example.com", "member").await;
  for (body, expected) in [
    (json!({ "email": "ada@example.com" }), StatusCode::CONFLICT),
    (json!({ "email": "bad" }), StatusCode::UNPROCESSABLE_ENTITY),
    (
      json!({ "email": "b@example.com", "password": "short" }),
      StatusCode::UNPROCESSABLE_ENTITY,
    ),
    (
      json!({ "email": "b@example.com", "publicMetadata": "x" }),
      StatusCode::UNPROCESSABLE_ENTITY,
    ),
    (
      json!({ "email": "b@example.com", "role": "root" }),
      StatusCode::FORBIDDEN,
    ),
  ] {
    let (status, reply) = app
      .request_with(
        Method::POST,
        "/api/v1/admin/users",
        Some(body.clone()),
        Some(&root),
      )
      .await;
    assert_eq!(status, expected, "{body}: {reply}");
  }
}
