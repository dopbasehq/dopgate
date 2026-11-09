use std::time::Duration;

use app::services::db::{DbClient, validate_schema};

use crate::support::{self, SchemaGuard};

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
