//! The columns `admins` and `users` share, read and written by realm.

use chrono::{DateTime, Utc};
use sqlx::{PgConnection, PgExecutor};

use crate::models::Realm;

/// The columns both account tables have.
pub const COLUMNS: &str = "id,email,email_verified_at,password_hash,display_name,avatar_url,status,failed_login_count,locked_until,last_sign_in_at,created_at,updated_at";

/// An admin or a user, as the shared code sees it.
#[derive(Clone, Debug, sqlx::FromRow)]
pub struct AccountRow {
  pub id: String,
  pub email: String,
  pub email_verified_at: Option<DateTime<Utc>>,
  pub password_hash: Option<String>,
  pub display_name: Option<String>,
  pub avatar_url: Option<String>,
  pub status: String,
  pub failed_login_count: i32,
  pub locked_until: Option<DateTime<Utc>>,
  pub last_sign_in_at: Option<DateTime<Utc>>,
  pub created_at: DateTime<Utc>,
  pub updated_at: DateTime<Utc>,
}

impl AccountRow {
  pub fn is_active(&self) -> bool {
    self.status == "active"
  }

  pub fn is_verified(&self) -> bool {
    self.email_verified_at.is_some()
  }

  pub fn is_locked(&self) -> bool {
    self.locked_until.is_some_and(|until| until > Utc::now())
  }
}

pub async fn find_by_id(
  executor: impl PgExecutor<'_>,
  realm: Realm,
  id: &str,
) -> Result<Option<AccountRow>, sqlx::Error> {
  sqlx::query_as(&format!(
    "SELECT {COLUMNS} FROM {} WHERE id = $1",
    realm.accounts()
  ))
  .bind(id)
  .fetch_optional(executor)
  .await
}

/// Lock the row for the rest of the transaction.
pub async fn find_by_id_for_update(
  connection: &mut PgConnection,
  realm: Realm,
  id: &str,
) -> Result<Option<AccountRow>, sqlx::Error> {
  sqlx::query_as(&format!(
    "SELECT {COLUMNS} FROM {} WHERE id = $1 FOR UPDATE",
    realm.accounts()
  ))
  .bind(id)
  .fetch_optional(connection)
  .await
}

/// `email` must already be normalized.
pub async fn find_by_email(
  executor: impl PgExecutor<'_>,
  realm: Realm,
  email: &str,
) -> Result<Option<AccountRow>, sqlx::Error> {
  sqlx::query_as(&format!(
    "SELECT {COLUMNS} FROM {} WHERE email = $1",
    realm.accounts()
  ))
  .bind(email)
  .fetch_optional(executor)
  .await
}

pub async fn mark_verified(
  executor: impl PgExecutor<'_>,
  realm: Realm,
  id: &str,
) -> Result<(), sqlx::Error> {
  sqlx::query(&format!(
    "UPDATE {} SET email_verified_at = COALESCE(email_verified_at, now()), updated_at = now() WHERE id = $1",
    realm.accounts()
  ))
  .bind(id)
  .execute(executor)
  .await
  .map(|_| ())
}

/// Record a successful sign-in and clear failed attempts.
pub async fn record_sign_in(
  executor: impl PgExecutor<'_>,
  realm: Realm,
  id: &str,
) -> Result<(), sqlx::Error> {
  sqlx::query(&format!(
    "UPDATE {} SET last_sign_in_at = now(), failed_login_count = 0, locked_until = NULL WHERE id = $1",
    realm.accounts()
  ))
  .bind(id)
  .execute(executor)
  .await
  .map(|_| ())
}

/// Count a wrong password. Locks the account for `lock_minutes` once the
/// count reaches `max_attempts`, and starts counting again. Returns whether
/// this attempt locked it.
pub async fn record_failure(
  executor: impl PgExecutor<'_>,
  realm: Realm,
  id: &str,
  max_attempts: i32,
  lock_minutes: i32,
) -> Result<bool, sqlx::Error> {
  sqlx::query_scalar(&format!(
    "UPDATE {} SET \
       locked_until = CASE WHEN failed_login_count + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE locked_until END, \
       failed_login_count = CASE WHEN failed_login_count + 1 >= $2 THEN 0 ELSE failed_login_count + 1 END \
     WHERE id = $1 RETURNING locked_until IS NOT NULL AND locked_until > now()",
    realm.accounts()
  ))
  .bind(id)
  .bind(max_attempts)
  .bind(lock_minutes)
  .fetch_one(executor)
  .await
}

pub async fn set_password(
  executor: impl PgExecutor<'_>,
  realm: Realm,
  id: &str,
  password_hash: &str,
) -> Result<(), sqlx::Error> {
  sqlx::query(&format!(
    "UPDATE {} SET password_hash = $2, failed_login_count = 0, locked_until = NULL, updated_at = now() WHERE id = $1",
    realm.accounts()
  ))
  .bind(id)
  .bind(password_hash)
  .execute(executor)
  .await
  .map(|_| ())
}

/// Move the account to a new, now verified, email.
pub async fn set_email(
  executor: impl PgExecutor<'_>,
  realm: Realm,
  id: &str,
  email: &str,
) -> Result<(), sqlx::Error> {
  sqlx::query(&format!(
    "UPDATE {} SET email = $2, email_verified_at = now(), updated_at = now() WHERE id = $1",
    realm.accounts()
  ))
  .bind(id)
  .bind(email)
  .execute(executor)
  .await
  .map(|_| ())
}

/// Whether a unique-violation error came from the email index.
pub fn is_email_taken(error: &sqlx::Error) -> bool {
  error
    .as_database_error()
    .is_some_and(|database| database.is_unique_violation())
}
