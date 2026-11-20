use std::time::Duration;

use app::services::db::{DbClient, validate_schema};
use axum::http::{Method, StatusCode};
use serde_json::json;

use crate::support::{self, PASSWORD, SchemaGuard, TestApp, smtp::FakeSmtp, use_smtp};

#[test]
fn schema_names_are_checked_before_they_reach_sql() {
  for good in ["dopgate", "auth_1", "_private"] {
    assert!(validate_schema(good).is_ok(), "{good}");
  }
  for bad in [
    "",
    "Dopgate",
    "1abc",
    "dop-gate",
    "a\"b",
    "pg_catalog",
    &"a".repeat(64),
  ] {
    assert!(validate_schema(bad).is_err(), "{bad}");
  }
}

/// Two instances in one database each see only their own schema.
#[tokio::test]
async fn schemas_keep_instances_apart() {
  let (first, _first_guard) = support::database().await;
  let (second, _second_guard) = support::database().await;
  sqlx::query("INSERT INTO settings(key,value,updated_at) VALUES('signup','{}',now())")
    .execute(first.pool())
    .await
    .unwrap();
  let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM settings")
    .fetch_one(second.pool())
    .await
    .unwrap();
  assert_eq!(count, 0);
}

#[tokio::test]
async fn an_unreachable_database_fails_after_the_wait() {
  let schema = support::unique_schema();
  let _guard = SchemaGuard(schema.clone());
  let started = std::time::Instant::now();
  let error = DbClient::connect_with(
    "postgres://postgres:dopgate@127.0.0.1:1/postgres",
    &schema,
    Duration::from_millis(500),
    1,
  )
  .await
  .unwrap_err();
  assert!(format!("{error:#}").contains("failed to reach PostgreSQL"));
  assert!(started.elapsed() < Duration::from_secs(5));
  // The password never reaches the error.
  assert!(!format!("{error:#}").contains("dopgate@"));
}

/// A request that held a transaction and asked the pool for a second
/// connection stalled every sign-in once all connections were held that
/// way. With a pool of one, such a request can never finish, so each flow
/// here fails after the five-second wait if it comes back.
#[tokio::test]
async fn one_connection_is_enough_for_a_request() {
  let smtp = FakeSmtp::start().await;
  let app = TestApp::with(|config| {
    config.database_max_connections = 1;
    use_smtp(config, &smtp);
  })
  .await;

  // Console sign-in, then a user's password sign-in.
  let root = app.root_token().await;
  app.create_user(&root, "ada@example.com").await;
  let user = app.login("ada@example.com", PASSWORD).await;

  // A user makes an agent, and the agent trades its token.
  app
    .settings(&root, json!({ "selfService": { "agents": true } }))
    .await;
  let (status, body) = app
    .request_with(
      Method::POST,
      "/api/v1/auth/agents",
      Some(json!({ "name": "bot" })),
      Some(&user),
    )
    .await;
  assert_eq!(status, StatusCode::CREATED, "{body}");
  let (status, body) = app
    .request(
      Method::POST,
      "/api/v1/auth/token",
      Some(json!({ "token": body["data"]["token"] })),
    )
    .await;
  assert_eq!(status, StatusCode::OK, "{body}");

  // A code signs in an email that has no account yet.
  app
    .settings(
      &root,
      json!({ "signup": { "enabled": true, "requireEmailVerification": true, "passwordlessSignup": true } }),
    )
    .await;
  let (status, body) = app
    .request(
      Method::POST,
      "/api/v1/auth/verification/send",
      Some(json!({ "email": "new@example.com", "purpose": "login" })),
    )
    .await;
  assert_eq!(status, StatusCode::OK, "{body}");
  let code = smtp.code_for("new@example.com").await;
  let (status, body) = app
    .request(
      Method::POST,
      "/api/v1/auth/verification/confirm",
      Some(json!({ "email": "new@example.com", "purpose": "login", "code": code })),
    )
    .await;
  assert_eq!(status, StatusCode::OK, "{body}");

  // The refresh token from that sign-in rotates.
  let (status, body) = app
    .request(
      Method::POST,
      "/api/v1/auth/refresh",
      Some(json!({ "refreshToken": body["data"]["refreshToken"] })),
    )
    .await;
  assert_eq!(status, StatusCode::OK, "{body}");
}
