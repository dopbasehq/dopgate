//! Owns `users`. Other modules read and change accounts through here.

use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::{PgConnection, PgExecutor};

use super::model::AdminUser;
use crate::models::{Role, User, UserStatus};

pub const COLUMNS: &str = "id,email,email_verified_at,password_hash,display_name,avatar_url,role,status,user_metadata,public_metadata,private_metadata,failed_login_count,locked_until,last_sign_in_at,created_at,updated_at";

/// An account row as stored.
#[derive(Clone, Debug, sqlx::FromRow)]
pub struct UserRow {
  pub id: String,
  pub email: String,
  pub email_verified_at: Option<DateTime<Utc>>,
  pub password_hash: Option<String>,
  pub display_name: Option<String>,
  pub avatar_url: Option<String>,
  pub role: String,
  pub status: String,
  pub user_metadata: Value,
  pub public_metadata: Value,
  pub private_metadata: Value,
  pub failed_login_count: i32,
  pub locked_until: Option<DateTime<Utc>>,
  pub last_sign_in_at: Option<DateTime<Utc>>,
  pub created_at: DateTime<Utc>,
  pub updated_at: DateTime<Utc>,
}

impl UserRow {
  pub fn role(&self) -> Role {
    Role::parse(&self.role).unwrap_or(Role::Member)
  }

  pub fn is_active(&self) -> bool {
    self.status == "active"
  }

  pub fn is_verified(&self) -> bool {
    self.email_verified_at.is_some()
  }

  pub fn is_locked(&self) -> bool {
    self.locked_until.is_some_and(|until| until > Utc::now())
  }

  /// The account as the user sees it.
  pub fn to_user(&self) -> User {
    User {
      id: self.id.clone(),
      email: self.email.clone(),
      email_verified: self.is_verified(),
      display_name: self.display_name.clone(),
      avatar_url: self.avatar_url.clone(),
      role: self.role(),
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

/// Lock the row for the rest of the transaction.
pub async fn find_by_id_for_update(
  connection: &mut PgConnection,
  id: &str,
) -> Result<Option<UserRow>, sqlx::Error> {
  sqlx::query_as(&format!(
    "SELECT {COLUMNS} FROM users WHERE id = $1 FOR UPDATE"
  ))
  .bind(id)
  .fetch_optional(connection)
  .await
}

/// `email` must already be normalized.
pub async fn find_by_email(
  executor: impl PgExecutor<'_>,
  email: &str,
) -> Result<Option<UserRow>, sqlx::Error> {
  sqlx::query_as(&format!("SELECT {COLUMNS} FROM users WHERE email = $1"))
    .bind(email)
    .fetch_optional(executor)
    .await
}

pub struct NewUser<'a> {
  pub id: &'a str,
  pub email: &'a str,
  pub password_hash: Option<&'a str>,
  pub display_name: Option<&'a str>,
  pub role: Role,
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
    "INSERT INTO users(id,email,email_verified_at,password_hash,display_name,role,status,public_metadata,private_metadata,created_at,updated_at) \
     VALUES($1,$2,CASE WHEN $3 THEN now() END,$4,$5,$6,'active',$7,$8,now(),now()) RETURNING {COLUMNS}"
  ))
  .bind(user.id)
  .bind(user.email)
  .bind(user.email_verified)
  .bind(user.password_hash)
  .bind(user.display_name)
  .bind(user.role.as_str())
  .bind(user.public_metadata)
  .bind(user.private_metadata)
  .fetch_one(connection)
  .await
}

pub async fn mark_verified(
  executor: impl PgExecutor<'_>,
  id: &str,
) -> Result<(), sqlx::Error> {
  sqlx::query(
    "UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()), updated_at = now() WHERE id = $1",
  )
  .bind(id)
  .execute(executor)
  .await
  .map(|_| ())
}

/// Record a successful sign-in and clear failed attempts.
pub async fn record_sign_in(
  executor: impl PgExecutor<'_>,
  id: &str,
) -> Result<(), sqlx::Error> {
  sqlx::query(
    "UPDATE users SET last_sign_in_at = now(), failed_login_count = 0, locked_until = NULL WHERE id = $1",
  )
  .bind(id)
  .execute(executor)
  .await
  .map(|_| ())
}

pub async fn set_password(
  executor: impl PgExecutor<'_>,
  id: &str,
  password_hash: &str,
) -> Result<(), sqlx::Error> {
  sqlx::query(
    "UPDATE users SET password_hash = $2, failed_login_count = 0, locked_until = NULL, updated_at = now() WHERE id = $1",
  )
  .bind(id)
  .bind(password_hash)
  .execute(executor)
  .await
  .map(|_| ())
}

pub async fn set_email(
  executor: impl PgExecutor<'_>,
  id: &str,
  email: &str,
) -> Result<UserRow, sqlx::Error> {
  sqlx::query_as(&format!(
    "UPDATE users SET email = $2, email_verified_at = now(), updated_at = now() WHERE id = $1 RETURNING {COLUMNS}"
  ))
  .bind(id)
  .bind(email)
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
  pub role: Option<Role>,
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
       role = COALESCE($10, role), \
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
  .bind(changes.role.map(Role::as_str))
  .fetch_one(executor)
  .await
}

/// Whether a unique-violation error came from the email index.
pub fn is_email_taken(error: &sqlx::Error) -> bool {
  error
    .as_database_error()
    .is_some_and(|database| database.is_unique_violation())
}
