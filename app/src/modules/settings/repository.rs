//! Owns `settings`. Plain values are JSON in `value`. Secret values go
//! through the master key with `crypto::setting_aad` and land in
//! `ciphertext` and `nonce`.

use sqlx::{SqliteConnection, SqlitePool};

/// The JSON of a plain setting.
pub async fn value(
  pool: &SqlitePool,
  key: &str,
) -> Result<Option<String>, sqlx::Error> {
  sqlx::query_scalar("SELECT value FROM settings WHERE key = ? AND value IS NOT NULL")
    .bind(key)
    .fetch_optional(pool)
    .await
}

/// The ciphertext and nonce of a secret setting.
pub async fn secret(
  pool: &SqlitePool,
  key: &str,
) -> Result<Option<(Vec<u8>, Vec<u8>)>, sqlx::Error> {
  sqlx::query_as("SELECT ciphertext, nonce FROM settings WHERE key = ? AND ciphertext IS NOT NULL")
    .bind(key)
    .fetch_optional(pool)
    .await
}

pub async fn put_value(
  connection: &mut SqliteConnection,
  key: &str,
  value: &str,
  updated_by: Option<&str>,
  now: &str,
) -> Result<(), sqlx::Error> {
  sqlx::query(
    "INSERT INTO settings(key,value,ciphertext,nonce,updated_at,updated_by) VALUES(?,?,NULL,NULL,?,?) \
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, ciphertext=NULL, nonce=NULL, updated_at=excluded.updated_at, updated_by=excluded.updated_by",
  )
  .bind(key)
  .bind(value)
  .bind(now)
  .bind(updated_by)
  .execute(connection)
  .await
  .map(|_| ())
}

pub async fn put_secret(
  connection: &mut SqliteConnection,
  key: &str,
  ciphertext: &[u8],
  nonce: &[u8],
  updated_by: Option<&str>,
  now: &str,
) -> Result<(), sqlx::Error> {
  sqlx::query(
    "INSERT INTO settings(key,value,ciphertext,nonce,updated_at,updated_by) VALUES(?,NULL,?,?,?,?) \
     ON CONFLICT(key) DO UPDATE SET value=NULL, ciphertext=excluded.ciphertext, nonce=excluded.nonce, updated_at=excluded.updated_at, updated_by=excluded.updated_by",
  )
  .bind(key)
  .bind(ciphertext)
  .bind(nonce)
  .bind(now)
  .bind(updated_by)
  .execute(connection)
  .await
  .map(|_| ())
}

pub async fn delete(
  connection: &mut SqliteConnection,
  key: &str,
) -> Result<(), sqlx::Error> {
  sqlx::query("DELETE FROM settings WHERE key = ?")
    .bind(key)
    .execute(connection)
    .await
    .map(|_| ())
}
