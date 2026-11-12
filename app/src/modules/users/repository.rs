//! Owns `users`, your app's accounts. What admins and users share (the
//! password, the lockout, the verified email) goes through `accounts`.

use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::{PgConnection, PgExecutor, PgPool};

use super::model::AdminUser;
use crate::models::{User, UserStatus};

pub const COLUMNS: &str = "id,email,email_verified_at,password_hash,display_name,avatar_url,status,user_metadata,public_metadata,private_metadata,locked_until,last_sign_in_at,created_at,updated_at";

/// An account row as stored.
#[derive(Clone, Debug, sqlx::FromRow)]
pub struct UserRow {
  pub id: String,
  pub email: String,
  pub email_verified_at: Option<DateTime<Utc>>,
  pub password_hash: Option<String>,
  pub display_name: Option<String>,
  pub avatar_url: Option<String>,
  pub status: String,
  pub user_metadata: Value,
  pub public_metadata: Value,
  pub private_metadata: Value,
  pub locked_until: Option<DateTime<Utc>>,
  pub last_sign_in_at: Option<DateTime<Utc>>,
  pub created_at: DateTime<Utc>,
  pub updated_at: DateTime<Utc>,
}

impl UserRow {
  pub fn is_active(&self) -> bool {
    self.status == "active"
  }

  pub fn is_verified(&self) -> bool {
    self.email_verified_at.is_some()
  }

  /// The account as the user sees it.
  pub fn to_user(&self) -> User {
    User {
      id: self.id.clone(),
      email: self.email.clone(),
      email_verified: self.is_verified(),
      display_name: self.display_name.clone(),
      avatar_url: self.avatar_url.clone(),
      status: if self.is_active() {
        UserStatus::Active
      } else {
        UserStatus::Disabled
      },
      user_metadata: self.user_metadata.clone(),
      public_metadata: self.public_metadata.clone(),
      has_password: self.password_hash.is_some(),
      last_sign_in_at: self.last_sign_in_at,
      created_at: self.created_at,
      updated_at: self.updated_at,
    }
  }

  /// The account as admins see it.
  pub fn to_admin(&self) -> AdminUser {
    AdminUser {
      user: self.to_user(),
      private_metadata: self.private_metadata.clone(),
      locked_until: self.locked_until.filter(|until| *until > Utc::now()),
    }
  }
}

pub async fn find_by_id(
  executor: impl PgExecutor<'_>,
  id: &str,
) -> Result<Option<UserRow>, sqlx::Error> {
  sqlx::query_as(&format!("SELECT {COLUMNS} FROM users WHERE id = $1"))
    .bind(id)
    .fetch_optional(executor)
    .await
}

pub struct NewUser<'a> {
  pub id: &'a str,
  pub email: &'a str,
  pub password_hash: Option<&'a str>,
  pub display_name: Option<&'a str>,
  pub email_verified: bool,
  pub public_metadata: &'a Value,
  pub private_metadata: &'a Value,
}

/// Insert an account. A taken email surfaces as a unique violation.
pub async fn insert(
  connection: &mut PgConnection,
  user: &NewUser<'_>,
) -> Result<UserRow, sqlx::Error> {
  sqlx::query_as(&format!(
    "INSERT INTO users(id,email,email_verified_at,password_hash,display_name,status,public_metadata,private_metadata,created_at,updated_at) \
     VALUES($1,$2,CASE WHEN $3 THEN now() END,$4,$5,'active',$6,$7,now(),now()) RETURNING {COLUMNS}"
  ))
  .bind(user.id)
  .bind(user.email)
  .bind(user.email_verified)
  .bind(user.password_hash)
  .bind(user.display_name)
  .bind(user.public_metadata)
  .bind(user.private_metadata)
  .fetch_one(connection)
  .await
}

pub async fn set_status(
  executor: impl PgExecutor<'_>,
  id: &str,
  status: UserStatus,
) -> Result<UserRow, sqlx::Error> {
  sqlx::query_as(&format!(
    "UPDATE users SET status = $2, updated_at = now() WHERE id = $1 RETURNING {COLUMNS}"
  ))
  .bind(id)
  .bind(status.as_str())
  .fetch_one(executor)
  .await
}

/// The profile fields a user or an admin changes. `None` leaves a field as
/// it is; `Some(None)` clears it.
#[derive(Default)]
pub struct ProfileChanges {
  pub display_name: Option<Option<String>>,
  pub avatar_url: Option<Option<String>>,
  pub user_metadata: Option<Value>,
  pub public_metadata: Option<Value>,
  pub private_metadata: Option<Value>,
  pub email_verified: Option<bool>,
}

pub async fn update_profile(
  executor: impl PgExecutor<'_>,
  id: &str,
  changes: &ProfileChanges,
) -> Result<UserRow, sqlx::Error> {
  sqlx::query_as(&format!(
    "UPDATE users SET \
       display_name = CASE WHEN $2 THEN $3 ELSE display_name END, \
       avatar_url = CASE WHEN $4 THEN $5 ELSE avatar_url END, \
       user_metadata = COALESCE($6, user_metadata), \
       public_metadata = COALESCE($7, public_metadata), \
       private_metadata = COALESCE($8, private_metadata), \
       email_verified_at = CASE WHEN $9::BOOLEAN IS NULL THEN email_verified_at \
                                WHEN $9 THEN COALESCE(email_verified_at, now()) ELSE NULL END, \
       updated_at = now() \
     WHERE id = $1 RETURNING {COLUMNS}"
  ))
  .bind(id)
  .bind(changes.display_name.is_some())
  .bind(changes.display_name.clone().flatten())
  .bind(changes.avatar_url.is_some())
  .bind(changes.avatar_url.clone().flatten())
  .bind(changes.user_metadata.as_ref())
  .bind(changes.public_metadata.as_ref())
  .bind(changes.private_metadata.as_ref())
  .bind(changes.email_verified)
  .fetch_one(executor)
  .await
}

pub async fn delete(
  executor: impl PgExecutor<'_>,
  id: &str,
) -> Result<bool, sqlx::Error> {
  sqlx::query("DELETE FROM users WHERE id = $1")
    .bind(id)
    .execute(executor)
    .await
    .map(|result| result.rows_affected() > 0)
}

pub struct ListFilter<'a> {
  pub search: Option<&'a str>,
  pub status: Option<UserStatus>,
  /// Rows strictly older than this (created_at, id).
  pub before: Option<(DateTime<Utc>, &'a str)>,
  pub limit: i64,
}

pub async fn list(
  pool: &PgPool,
  filter: &ListFilter<'_>,
) -> Result<Vec<UserRow>, sqlx::Error> {
  let pattern = filter.search.map(|search| {
    format!(
      "%{}%",
      search
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
    )
  });
  let status = filter.status.map(UserStatus::as_str);
  let (before_time, before_id) = match filter.before {
    Some((time, id)) => (Some(time), Some(id)),
    None => (None, None),
  };
  sqlx::query_as(&format!(
    "SELECT {COLUMNS} FROM users \
     WHERE ($1::TEXT IS NULL OR email ILIKE $1 OR display_name ILIKE $1) \
       AND ($2::TEXT IS NULL OR status = $2) \
       AND ($3::TIMESTAMPTZ IS NULL OR (created_at, id) < ($3, $4)) \
     ORDER BY created_at DESC, id DESC LIMIT $5"
  ))
  .bind(pattern)
  .bind(status)
  .bind(before_time)
  .bind(before_id)
  .bind(filter.limit)
  .fetch_all(pool)
  .await
}

pub use crate::modules::accounts::repository::is_email_taken;
