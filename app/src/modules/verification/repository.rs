//! Owns `verification_tokens`.

use chrono::{DateTime, Utc};
use sqlx::PgConnection;

#[derive(sqlx::FromRow)]
pub struct CodeRow {
  pub id: String,
  pub user_id: Option<String>,
  pub email: String,
  pub secret_hash: Vec<u8>,
  pub new_email: Option<String>,
  pub attempts: i32,
  pub expires_at: DateTime<Utc>,
}

pub struct NewCode<'a> {
  pub id: &'a str,
  pub user_id: Option<&'a str>,
  pub email: &'a str,
  pub purpose: &'a str,
  pub secret_hash: &'a [u8],
  pub new_email: Option<&'a str>,
  pub ip_address: Option<&'a str>,
  pub expires_at: DateTime<Utc>,
}

/// Insert a code and drop any earlier unused code for the same email and
/// purpose: asking again replaces the old code.
pub async fn replace(
  connection: &mut PgConnection,
  code: &NewCode<'_>,
) -> Result<(), sqlx::Error> {
  sqlx::query(
    "DELETE FROM verification_tokens WHERE email = $1 AND purpose = $2 AND consumed_at IS NULL",
  )
  .bind(code.email)
  .bind(code.purpose)
  .execute(&mut *connection)
  .await?;
  sqlx::query(
    "INSERT INTO verification_tokens(id,user_id,email,purpose,secret_hash,new_email,ip_address,created_at,expires_at) \
     VALUES($1,$2,$3,$4,$5,$6,$7,now(),$8)",
  )
  .bind(code.id)
  .bind(code.user_id)
  .bind(code.email)
  .bind(code.purpose)
  .bind(code.secret_hash)
  .bind(code.new_email)
  .bind(code.ip_address)
  .bind(code.expires_at)
  .execute(&mut *connection)
  .await?;
  // Keep the table small: drop codes that ended a day ago.
  sqlx::query("DELETE FROM verification_tokens WHERE expires_at < now() - interval '1 day'")
    .execute(&mut *connection)
    .await?;
  Ok(())
}

/// The newest unused code for an email and purpose, locked.
pub async fn latest(
  connection: &mut PgConnection,
  email: &str,
  purpose: &str,
) -> Result<Option<CodeRow>, sqlx::Error> {
  sqlx::query_as(
    "SELECT id, user_id, email, secret_hash, new_email, attempts, expires_at FROM verification_tokens \
     WHERE email = $1 AND purpose = $2 AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1 FOR UPDATE",
  )
  .bind(email)
  .bind(purpose)
  .fetch_optional(connection)
  .await
}

pub async fn count_attempt(
  connection: &mut PgConnection,
  id: &str,
) -> Result<(), sqlx::Error> {
  sqlx::query("UPDATE verification_tokens SET attempts = attempts + 1 WHERE id = $1")
    .bind(id)
    .execute(connection)
    .await
    .map(|_| ())
}

pub async fn consume(
  connection: &mut PgConnection,
  id: &str,
) -> Result<(), sqlx::Error> {
  sqlx::query("UPDATE verification_tokens SET consumed_at = now() WHERE id = $1")
    .bind(id)
    .execute(connection)
    .await
    .map(|_| ())
}
