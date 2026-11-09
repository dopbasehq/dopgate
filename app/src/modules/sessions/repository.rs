//! Owns `sessions` and `refresh_tokens`.

use chrono::{DateTime, Utc};
use sqlx::{PgConnection, PgExecutor};

use super::model::SessionResponse;

pub struct NewSession<'a> {
  pub id: &'a str,
  pub user_id: &'a str,
  pub method: &'a str,
  pub ip_address: Option<&'a str>,
  pub user_agent: Option<&'a str>,
  pub idle_expires_at: DateTime<Utc>,
  pub absolute_expires_at: DateTime<Utc>,
}

pub async fn insert(
  connection: &mut PgConnection,
  session: &NewSession<'_>,
) -> Result<(), sqlx::Error> {
  sqlx::query(
    "INSERT INTO sessions(id,user_id,method,ip_address,user_agent,created_at,last_used_at,idle_expires_at,absolute_expires_at) \
     VALUES($1,$2,$3,$4,$5,now(),now(),$6,$7)",
  )
  .bind(session.id)
  .bind(session.user_id)
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
  id: &str,
  session_id: &str,
  token_hash: &[u8],
  expires_at: DateTime<Utc>,
) -> Result<(), sqlx::Error> {
  sqlx::query(
    "INSERT INTO refresh_tokens(id,session_id,token_hash,created_at,expires_at) VALUES($1,$2,$3,now(),$4)",
  )
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
  pub user_id: String,
  pub revoked_at: Option<DateTime<Utc>>,
  pub absolute_expires_at: DateTime<Utc>,
}

pub async fn find_refresh_token(
  connection: &mut PgConnection,
  token_hash: &[u8],
) -> Result<Option<RefreshLookup>, sqlx::Error> {
  sqlx::query_as(
    "SELECT r.id AS token_id, r.used_at, r.expires_at, s.id AS session_id, s.user_id, s.revoked_at, s.absolute_expires_at \
     FROM refresh_tokens r JOIN sessions s ON s.id = r.session_id WHERE r.token_hash = $1 FOR UPDATE OF r, s",
  )
  .bind(token_hash)
  .fetch_optional(connection)
  .await
}

pub async fn mark_used(
  connection: &mut PgConnection,
  token_id: &str,
) -> Result<(), sqlx::Error> {
  sqlx::query("UPDATE refresh_tokens SET used_at = now() WHERE id = $1")
    .bind(token_id)
    .execute(connection)
    .await
    .map(|_| ())
}

pub async fn touch(
  connection: &mut PgConnection,
  session_id: &str,
  idle_expires_at: DateTime<Utc>,
) -> Result<(), sqlx::Error> {
  sqlx::query("UPDATE sessions SET last_used_at = now(), idle_expires_at = $2 WHERE id = $1")
    .bind(session_id)
    .bind(idle_expires_at)
    .execute(connection)
    .await
    .map(|_| ())
}

/// End one session. Returns whether a live session was ended.
pub async fn revoke(
  executor: impl PgExecutor<'_>,
  session_id: &str,
  user_id: &str,
  reason: &str,
) -> Result<bool, sqlx::Error> {
  sqlx::query(
    "UPDATE sessions SET revoked_at = now(), revoked_reason = $3 WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL",
  )
  .bind(session_id)
  .bind(user_id)
  .bind(reason)
  .execute(executor)
  .await
  .map(|result| result.rows_affected() > 0)
}

/// End every live session of a user, except `keep` when given.
pub async fn revoke_all(
  executor: impl PgExecutor<'_>,
  user_id: &str,
  keep: Option<&str>,
  reason: &str,
) -> Result<u64, sqlx::Error> {
  sqlx::query(
    "UPDATE sessions SET revoked_at = now(), revoked_reason = $3 \
     WHERE user_id = $1 AND revoked_at IS NULL AND ($2::TEXT IS NULL OR id <> $2)",
  )
  .bind(user_id)
  .bind(keep)
  .bind(reason)
  .execute(executor)
  .await
  .map(|result| result.rows_affected())
}

/// Live sessions, newest first.
pub async fn list_active(
  executor: impl PgExecutor<'_>,
  user_id: &str,
  current: Option<&str>,
) -> Result<Vec<SessionResponse>, sqlx::Error> {
  sqlx::query_as(
    "SELECT id, method, ip_address, user_agent, (id = $2) AS current, created_at, last_used_at, \
            LEAST(idle_expires_at, absolute_expires_at) AS expires_at \
     FROM sessions \
     WHERE user_id = $1 AND revoked_at IS NULL AND absolute_expires_at > now() AND idle_expires_at > now() \
     ORDER BY last_used_at DESC",
  )
  .bind(user_id)
  .bind(current.unwrap_or(""))
  .fetch_all(executor)
  .await
}
