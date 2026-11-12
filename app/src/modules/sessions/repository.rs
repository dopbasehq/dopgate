//! Owns `sessions` and `refresh_tokens`, and their console twins
//! `admin_sessions` and `admin_refresh_tokens`. The realm picks the pair.

use chrono::{DateTime, Utc};
use sqlx::{PgConnection, PgExecutor};

use super::model::SessionResponse;
use crate::models::Realm;

pub struct NewSession<'a> {
  pub id: &'a str,
  pub account_id: &'a str,
  pub method: &'a str,
  pub ip_address: Option<&'a str>,
  pub user_agent: Option<&'a str>,
  pub idle_expires_at: DateTime<Utc>,
  pub absolute_expires_at: DateTime<Utc>,
}

pub async fn insert(
  connection: &mut PgConnection,
  realm: Realm,
  session: &NewSession<'_>,
) -> Result<(), sqlx::Error> {
  sqlx::query(&format!(
    "INSERT INTO {}(id,{},method,ip_address,user_agent,created_at,last_used_at,idle_expires_at,absolute_expires_at) \
     VALUES($1,$2,$3,$4,$5,now(),now(),$6,$7)",
    realm.sessions(),
    realm.owner_column()
  ))
  .bind(session.id)
  .bind(session.account_id)
  .bind(session.method)
  .bind(session.ip_address)
  .bind(session.user_agent)
  .bind(session.idle_expires_at)
  .bind(session.absolute_expires_at)
  .execute(connection)
  .await
  .map(|_| ())
}

pub async fn insert_refresh_token(
  connection: &mut PgConnection,
  realm: Realm,
  id: &str,
  session_id: &str,
  token_hash: &[u8],
  expires_at: DateTime<Utc>,
) -> Result<(), sqlx::Error> {
  sqlx::query(&format!(
    "INSERT INTO {}(id,session_id,token_hash,created_at,expires_at) VALUES($1,$2,$3,now(),$4)",
    realm.refresh_tokens()
  ))
  .bind(id)
  .bind(session_id)
  .bind(token_hash)
  .bind(expires_at)
  .execute(connection)
  .await
  .map(|_| ())
}

/// A refresh token joined with its session, locked for the transaction.
#[derive(sqlx::FromRow)]
pub struct RefreshLookup {
  pub token_id: String,
  pub used_at: Option<DateTime<Utc>>,
  pub expires_at: DateTime<Utc>,
  pub session_id: String,
  pub account_id: String,
  pub revoked_at: Option<DateTime<Utc>>,
  pub absolute_expires_at: DateTime<Utc>,
}

pub async fn find_refresh_token(
  connection: &mut PgConnection,
  realm: Realm,
  token_hash: &[u8],
) -> Result<Option<RefreshLookup>, sqlx::Error> {
  sqlx::query_as(&format!(
    "SELECT r.id AS token_id, r.used_at, r.expires_at, s.id AS session_id, s.{} AS account_id, s.revoked_at, s.absolute_expires_at \
     FROM {} r JOIN {} s ON s.id = r.session_id WHERE r.token_hash = $1 FOR UPDATE OF r, s",
    realm.owner_column(),
    realm.refresh_tokens(),
    realm.sessions()
  ))
  .bind(token_hash)
  .fetch_optional(connection)
  .await
}

/// The session and account a refresh token belongs to, without using it.
pub async fn session_of_refresh_token(
  executor: impl PgExecutor<'_>,
  realm: Realm,
  token_hash: &[u8],
) -> Result<Option<(String, String)>, sqlx::Error> {
  sqlx::query_as(&format!(
    "SELECT s.id, s.{} FROM {} r JOIN {} s ON s.id = r.session_id WHERE r.token_hash = $1",
    realm.owner_column(),
    realm.refresh_tokens(),
    realm.sessions()
  ))
  .bind(token_hash)
  .fetch_optional(executor)
  .await
}

pub async fn mark_used(
  connection: &mut PgConnection,
  realm: Realm,
  token_id: &str,
) -> Result<(), sqlx::Error> {
  sqlx::query(&format!(
    "UPDATE {} SET used_at = now() WHERE id = $1",
    realm.refresh_tokens()
  ))
  .bind(token_id)
  .execute(connection)
  .await
  .map(|_| ())
}

pub async fn touch(
  connection: &mut PgConnection,
  realm: Realm,
  session_id: &str,
  idle_expires_at: DateTime<Utc>,
) -> Result<(), sqlx::Error> {
  sqlx::query(&format!(
    "UPDATE {} SET last_used_at = now(), idle_expires_at = $2 WHERE id = $1",
    realm.sessions()
  ))
  .bind(session_id)
  .bind(idle_expires_at)
  .execute(connection)
  .await
  .map(|_| ())
}

/// End one session. Returns whether a live session was ended.
pub async fn revoke(
  executor: impl PgExecutor<'_>,
  realm: Realm,
  session_id: &str,
  account_id: &str,
  reason: &str,
) -> Result<bool, sqlx::Error> {
  sqlx::query(&format!(
    "UPDATE {} SET revoked_at = now(), revoked_reason = $3 WHERE id = $1 AND {} = $2 AND revoked_at IS NULL",
    realm.sessions(),
    realm.owner_column()
  ))
  .bind(session_id)
  .bind(account_id)
  .bind(reason)
  .execute(executor)
  .await
  .map(|result| result.rows_affected() > 0)
}

/// End every live session of an account, except `keep` when given.
pub async fn revoke_all(
  executor: impl PgExecutor<'_>,
  realm: Realm,
  account_id: &str,
  keep: Option<&str>,
  reason: &str,
) -> Result<u64, sqlx::Error> {
  sqlx::query(&format!(
    "UPDATE {} SET revoked_at = now(), revoked_reason = $3 \
     WHERE {} = $1 AND revoked_at IS NULL AND ($2::TEXT IS NULL OR id <> $2)",
    realm.sessions(),
    realm.owner_column()
  ))
  .bind(account_id)
  .bind(keep)
  .bind(reason)
  .execute(executor)
  .await
  .map(|result| result.rows_affected())
}

/// Live sessions, newest first.
pub async fn list_active(
  executor: impl PgExecutor<'_>,
  realm: Realm,
  account_id: &str,
  current: Option<&str>,
) -> Result<Vec<SessionResponse>, sqlx::Error> {
  sqlx::query_as(&format!(
    "SELECT id, method, ip_address, user_agent, (id = $2) AS current, created_at, last_used_at, \
            LEAST(idle_expires_at, absolute_expires_at) AS expires_at \
     FROM {} \
     WHERE {} = $1 AND revoked_at IS NULL AND absolute_expires_at > now() AND idle_expires_at > now() \
     ORDER BY last_used_at DESC",
    realm.sessions(),
    realm.owner_column()
  ))
  .bind(account_id)
  .bind(current.unwrap_or(""))
  .fetch_all(executor)
  .await
}

/// Whether a session is live and its account active. Checked on every
/// request that carries an access token.
pub async fn live_account(
  executor: impl PgExecutor<'_>,
  realm: Realm,
  session_id: &str,
  account_id: &str,
) -> Result<Option<(String, String, bool)>, sqlx::Error> {
  sqlx::query_as(&format!(
    "SELECT a.email, a.status, a.email_verified_at IS NOT NULL \
     FROM {} s JOIN {} a ON a.id = s.{} \
     WHERE s.id = $1 AND s.{} = $2 AND s.revoked_at IS NULL AND s.absolute_expires_at > now()",
    realm.sessions(),
    realm.accounts(),
    realm.owner_column(),
    realm.owner_column()
  ))
  .bind(session_id)
  .bind(account_id)
  .fetch_optional(executor)
  .await
}
