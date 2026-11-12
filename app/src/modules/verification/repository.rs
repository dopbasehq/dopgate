//! Owns `verification_tokens`, and `admin_codes` for the console. The realm
//! picks the table.

use chrono::{DateTime, Utc};
use sqlx::PgConnection;

use crate::models::Realm;

#[derive(sqlx::FromRow)]
pub struct CodeRow {
  pub id: String,
  pub account_id: Option<String>,
  pub email: String,
  pub secret_hash: Vec<u8>,
  pub new_email: Option<String>,
  pub attempts: i32,
  pub expires_at: DateTime<Utc>,
}

pub struct NewCode<'a> {
  pub id: &'a str,
  pub account_id: Option<&'a str>,
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
  realm: Realm,
  code: &NewCode<'_>,
) -> Result<(), sqlx::Error> {
  let table = realm.codes();
  sqlx::query(&format!(
    "DELETE FROM {table} WHERE email = $1 AND purpose = $2 AND consumed_at IS NULL"
  ))
  .bind(code.email)
  .bind(code.purpose)
  .execute(&mut *connection)
  .await?;
  sqlx::query(&format!(
    "INSERT INTO {table}(id,{},email,purpose,secret_hash,new_email,ip_address,created_at,expires_at) \
     VALUES($1,$2,$3,$4,$5,$6,$7,now(),$8)",
    realm.owner_column()
  ))
  .bind(code.id)
  .bind(code.account_id)
  .bind(code.email)
  .bind(code.purpose)
  .bind(code.secret_hash)
  .bind(code.new_email)
  .bind(code.ip_address)
  .bind(code.expires_at)
  .execute(&mut *connection)
  .await?;
  // Keep the table small: drop codes that ended a day ago.
  sqlx::query(&format!(
    "DELETE FROM {table} WHERE expires_at < now() - interval '1 day'"
  ))
  .execute(&mut *connection)
  .await?;
  Ok(())
}

/// The newest unused code for an email and purpose, locked.
pub async fn latest(
  connection: &mut PgConnection,
  realm: Realm,
  email: &str,
  purpose: &str,
) -> Result<Option<CodeRow>, sqlx::Error> {
  sqlx::query_as(&format!(
    "SELECT id, {} AS account_id, email, secret_hash, new_email, attempts, expires_at FROM {} \
     WHERE email = $1 AND purpose = $2 AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1 FOR UPDATE",
    realm.owner_column(),
    realm.codes()
  ))
  .bind(email)
  .bind(purpose)
  .fetch_optional(connection)
  .await
}

pub async fn count_attempt(
  connection: &mut PgConnection,
  realm: Realm,
  id: &str,
) -> Result<(), sqlx::Error> {
  sqlx::query(&format!(
    "UPDATE {} SET attempts = attempts + 1 WHERE id = $1",
    realm.codes()
  ))
  .bind(id)
  .execute(connection)
  .await
  .map(|_| ())
}

pub async fn consume(
  connection: &mut PgConnection,
  realm: Realm,
  id: &str,
) -> Result<(), sqlx::Error> {
  sqlx::query(&format!(
    "UPDATE {} SET consumed_at = now() WHERE id = $1",
    realm.codes()
  ))
  .bind(id)
  .execute(connection)
  .await
  .map(|_| ())
}
