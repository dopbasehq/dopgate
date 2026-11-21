//! Owns `signing_keys` reads for the API. Key generation lives in
//! `services::keys`.

use sqlx::{PgConnection, PgPool};

use super::model::SigningKeyResponse;

pub async fn list(pool: &PgPool) -> Result<Vec<SigningKeyResponse>, sqlx::Error> {
  sqlx::query_as(
    "SELECT id, algorithm, status, created_at, rotated_at, retired_at FROM signing_keys ORDER BY created_at DESC",
  )
  .fetch_all(pool)
  .await
}

pub async fn find(
  connection: &mut PgConnection,
  id: &str,
) -> Result<SigningKeyResponse, sqlx::Error> {
  sqlx::query_as(
    "SELECT id, algorithm, status, created_at, rotated_at, retired_at FROM signing_keys WHERE id = $1",
  )
  .bind(id)
  .fetch_one(connection)
  .await
}

/// Move the active key to `retiring`.
pub async fn retire_active(connection: &mut PgConnection) -> Result<(), sqlx::Error> {
  sqlx::query(
    "UPDATE signing_keys SET status = 'retiring', rotated_at = now() WHERE status = 'active'",
  )
  .execute(connection)
  .await
  .map(|_| ())
}
