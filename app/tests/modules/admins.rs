//! Root and admins: who may manage them, and what each action does.

use axum::http::{Method, StatusCode};
use serde_json::json;

use app::modules::admins::service::{ResetPasswordError, reset_password};

use crate::support::{PASSWORD, ROOT_EMAIL, TestApp, smtp::FakeSmtp, use_smtp};

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

async fn console_login_status(
  app: &TestApp,
  email: &str,
  password: &str,
) -> StatusCode {
  app
    .request(
      Method::POST,
      "/api/v1/console/login",
      Some(json!({ "email": email, "password": password })),
    )
    .await
    .0
}

#[tokio::test]
async fn reset_password_replaces_roots_password_and_ends_its_sessions() {
  let app = TestApp::new().await;
  let token = app.root_token().await;
  // A lockout from the guessing that led here clears with the reset.
  sqlx::query("UPDATE admins SET locked_until = now() + interval '1 hour' WHERE role = 'root'")
    .execute(app.state.db.pool())
    .await
    .unwrap();

  let reset = reset_password(&app.state.db, " Root@Example.com ", "a brand new secret")
    .await
    .unwrap();
  assert_eq!(reset.email, ROOT_EMAIL);
  assert_eq!(reset.role.as_str(), "root");
  assert!(!reset.disabled);
  assert_eq!(reset.sessions_ended, 1);

  let (status, _) = app
    .request_with(Method::GET, "/api/v1/console/me", None, Some(&token))
    .await;
  assert_eq!(status, StatusCode::UNAUTHORIZED);
  assert_eq!(
    console_login_status(&app, ROOT_EMAIL, PASSWORD).await,
    StatusCode::UNAUTHORIZED
  );
  app.console_login(ROOT_EMAIL, "a brand new secret").await;

  let label: String = sqlx::query_scalar(
    "SELECT actor_label FROM audit_events WHERE action = 'admin.password_reset'",
  )
  .fetch_one(app.state.db.pool())
  .await
  .unwrap();
  assert_eq!(label, "cli");
}

#[tokio::test]
async fn reset_password_works_for_an_admin_and_leaves_root_alone() {
  let app = TestApp::new().await;
  let root = app.root_token().await;
  app.create_admin(&root, "ops@example.com").await;
  let admin = app.console_login("ops@example.com", PASSWORD).await;

  let reset = reset_password(&app.state.db, "ops@example.com", "a brand new secret")
    .await
    .unwrap();
  assert_eq!(reset.role.as_str(), "admin");
  assert_eq!(reset.sessions_ended, 1);
  let (status, _) = app
    .request_with(Method::GET, "/api/v1/console/me", None, Some(&admin))
    .await;
  assert_eq!(status, StatusCode::UNAUTHORIZED);
  app
    .console_login("ops@example.com", "a brand new secret")
    .await;
  let (status, _) = app
    .request_with(Method::GET, "/api/v1/console/me", None, Some(&root))
    .await;
  assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn reset_password_refuses_and_changes_nothing() {
  let app = TestApp::new().await;
  let root = app.root_token().await;
  // An app user with this email is not an admin.
  app.create_user(&root, "person@example.com").await;
  for email in ["person@example.com", "nobody@example.com", "not an email"] {
    assert!(
      matches!(
        reset_password(&app.state.db, email, "a brand new secret").await,
        Err(ResetPasswordError::NotFound)
      ),
      "{email}"
    );
  }
  assert!(matches!(
    reset_password(&app.state.db, ROOT_EMAIL, "short").await,
    Err(ResetPasswordError::WeakPassword(_))
  ));
  app.console_login(ROOT_EMAIL, PASSWORD).await;
  let (status, _) = app
    .request_with(Method::GET, "/api/v1/console/me", None, Some(&root))
    .await;
  assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn reset_password_voids_codes_already_emailed() {
  let smtp = FakeSmtp::start().await;
  let app = TestApp::with(|config| use_smtp(config, &smtp)).await;
  app.root_token().await;
  let (status, _) = app
    .request(
      Method::POST,
      "/api/v1/console/password/forgot",
      Some(json!({ "email": ROOT_EMAIL })),
    )
    .await;
  assert_eq!(status, StatusCode::OK);
  let code = smtp.code_for(ROOT_EMAIL).await;

  reset_password(&app.state.db, ROOT_EMAIL, "a brand new secret")
    .await
    .unwrap();
  let (status, body) = app
    .request(
      Method::POST,
      "/api/v1/console/password/reset",
      Some(json!({ "email": ROOT_EMAIL, "code": code, "newPassword": "someone else's pick" })),
    )
    .await;
  assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
  assert!(body["error"]["CODE_INVALID"].is_string(), "{body}");
  app.console_login(ROOT_EMAIL, "a brand new secret").await;
}

#[tokio::test]
async fn reset_password_keeps_a_disabled_admin_disabled() {
  let app = TestApp::new().await;
  let root = app.root_token().await;
  let id = app.create_admin(&root, "ops@example.com").await;
  let (status, _) = app
    .request_with(
      Method::POST,
      &format!("/api/v1/admin/admins/{id}/disable"),
      None,
      Some(&root),
    )
    .await;
  assert_eq!(status, StatusCode::OK);

  let reset = reset_password(&app.state.db, "ops@example.com", "a brand new secret")
    .await
    .unwrap();
  assert!(reset.disabled);
  assert_ne!(
    console_login_status(&app, "ops@example.com", "a brand new secret").await,
    StatusCode::OK
  );
}
