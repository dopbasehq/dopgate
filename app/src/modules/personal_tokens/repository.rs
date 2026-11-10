//! Owns `personal_tokens`.

use chrono::{DateTime, Utc};
use sqlx::{PgExecutor, PgPool};

use super::model::PersonalToken;

const COLUMNS: &str = "id,user_id,name,last_four,expires_at,last_used_at,created_at";

#[derive(Clone, Debug, sqlx::FromRow)]
pub struct TokenRow {
  pub id: String,
  pub user_id: String,
  pub name: String,
  pub last_four: String,
  pub expires_at: Option<DateTime<Utc>>,
  pub last_used_at: Option<DateTime<Utc>>,
  pub created_at: DateTime<Utc>,
}

impl TokenRow {
  pub fn is_expired(&self) -> bool {
    self.expires_at.is_some_and(|at| at <= Utc::now())
  }

  pub fn to_token(&self) -> PersonalToken {
    PersonalToken {
      id: self.id.clone(),
      name: self.name.clone(),
      last_four: self.last_four.clone(),
      expires_at: self.expires_at,
      expired: self.is_expired(),
      last_used_at: self.last_used_at,
      created_at: self.created_at,
    }
  }
}

pub struct NewToken<'a> {
  pub id: &'a str,
  pub user_id: &'a str,
  pub name: &'a str,
  pub token_hash: &'a [u8],
  pub last_four: &'a str,
  pub expires_at: Option<DateTime<Utc>>,
}

/// Insert a token. A name the user already uses surfaces as a unique
/// violation.
pub async fn insert(
  executor: impl PgExecutor<'_>,
  token: &NewToken<'_>,
) -> Result<TokenRow, sqlx::Error> {
  sqlx::query_as(&format!(
    "INSERT INTO personal_tokens(id,user_id,name,token_hash,last_four,expires_at,created_at) \
     VALUES($1,$2,$3,$4,$5,$6,now()) RETURNING {COLUMNS}"
  ))
  .bind(token.id)
  .bind(token.user_id)
  .bind(token.name)
  .bind(token.token_hash)
  .bind(token.last_four)
  .bind(token.expires_at)
  .fetch_one(executor)
  .await
}

/// A user's tokens, newest first.
pub async fn list(
  pool: &PgPool,
  user_id: &str,
) -> Result<Vec<TokenRow>, sqlx::Error> {
  sqlx::query_as(&format!(
    "SELECT {COLUMNS} FROM personal_tokens WHERE user_id = $1 ORDER BY created_at DESC, id DESC"
  ))
  .bind(user_id)
  .fetch_all(pool)
  .await
}

pub async fn count(
  executor: impl PgExecutor<'_>,
  user_id: &str,
) -> Result<i64, sqlx::Error> {
  sqlx::query_scalar("SELECT COUNT(*) FROM personal_tokens WHERE user_id = $1")
    .bind(user_id)
    .fetch_one(executor)
    .await
}

/// The token with this hash, for a sign-in.
pub async fn find_by_hash(
  pool: &PgPool,
  token_hash: &[u8],
) -> Result<Option<TokenRow>, sqlx::Error> {
  sqlx::query_as(&format!(
    "SELECT {COLUMNS} FROM personal_tokens WHERE token_hash = $1"
  ))
  .bind(token_hash)
  .fetch_optional(pool)
  .await
}

/// Delete one of a user's tokens. Returns the deleted row.
pub async fn delete(
  executor: impl PgExecutor<'_>,
  user_id: &str,
  id: &str,
) -> Result<Option<TokenRow>, sqlx::Error> {
  sqlx::query_as(&format!(
    "DELETE FROM personal_tokens WHERE id = $1 AND user_id = $2 RETURNING {COLUMNS}"
  ))
  .bind(id)
  .bind(user_id)
  .fetch_optional(executor)
  .await
}

/// Note a use, at most once a minute, so a busy script doesn't write on
/// every call.
pub async fn touch(
  pool: &PgPool,
  id: &str,
) -> Result<(), sqlx::Error> {
  sqlx::query(
    "UPDATE personal_tokens SET last_used_at = now() \
     WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')",
  )
  .bind(id)
  .execute(pool)
  .await
  .map(|_| ())
}

/// Whether a token is still there, unexpired, and its user active. Checked
/// on every Dopgate request that carries a token from it. Returns the
/// user's email, status, and verified flag.
pub async fn live_owner(
  executor: impl PgExecutor<'_>,
  token_id: &str,
  user_id: &str,
) -> Result<Option<(String, String, bool)>, sqlx::Error> {
  sqlx::query_as(
    "SELECT u.email, u.status, u.email_verified_at IS NOT NULL \
     FROM personal_tokens t JOIN users u ON u.id = t.user_id \
     WHERE t.id = $1 AND t.user_id = $2 AND (t.expires_at IS NULL OR t.expires_at > now())",
  )
  .bind(token_id)
  .bind(user_id)
  .fetch_optional(executor)
  .await
}
