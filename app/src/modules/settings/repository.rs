//! Owns `settings`: one JSON object per section.

use sqlx::{PgConnection, PgExecutor};

/// The JSON of a section, if it was ever saved. Takes the pool, or the
/// connection of a transaction that is already open.
pub async fn value(
  executor: impl PgExecutor<'_>,
  key: &str,
) -> Result<Option<serde_json::Value>, sqlx::Error> {
  sqlx::query_scalar("SELECT value FROM settings WHERE key = $1")
    .bind(key)
    .fetch_optional(executor)
    .await
}

pub async fn put_value(
  connection: &mut PgConnection,
  key: &str,
  value: &serde_json::Value,
  updated_by: Option<&str>,
) -> Result<(), sqlx::Error> {
  sqlx::query(
    "INSERT INTO settings(key,value,updated_at,updated_by) VALUES($1,$2,now(),$3) \
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at, updated_by=excluded.updated_by",
  )
  .bind(key)
  .bind(value)
  .bind(updated_by)
  .execute(connection)
  .await
  .map(|_| ())
}
