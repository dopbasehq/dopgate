//! Owns `admins`. What admins share with users (the password, the lockout,
//! the verified email) goes through `accounts`.

use chrono::{DateTime, Utc};
use sqlx::{PgConnection, PgExecutor, PgPool};

use crate::models::{Admin, Role, UserStatus};

pub const COLUMNS: &str = "id,email,password_hash,display_name,avatar_url,role,status,locked_until,last_sign_in_at,created_at,updated_at";

#[derive(Clone, Debug, sqlx::FromRow)]
pub struct AdminRow {
  pub id: String,
  pub email: String,
  pub password_hash: Option<String>,
  pub display_name: Option<String>,
  pub avatar_url: Option<String>,
  #[sqlx(try_from = "String")]
  pub role: Role,
  #[sqlx(try_from = "String")]
  pub status: UserStatus,
  pub locked_until: Option<DateTime<Utc>>,
  pub last_sign_in_at: Option<DateTime<Utc>>,
  pub created_at: DateTime<Utc>,
  pub updated_at: DateTime<Utc>,
}

impl AdminRow {
  /// The admin as the API returns it. Takes the row, so nothing is copied.
  pub fn into_admin(self) -> Admin {
    Admin {
      has_password: self.password_hash.is_some(),
      locked_until: self.locked_until.filter(|until| *until > Utc::now()),
      id: self.id,
      email: self.email,
      display_name: self.display_name,
      avatar_url: self.avatar_url,
      role: self.role,
      status: self.status,
      last_sign_in_at: self.last_sign_in_at,
      created_at: self.created_at,
      updated_at: self.updated_at,
    }
  }
}

pub async fn find_by_id(
  executor: impl PgExecutor<'_>,
  id: &str,
) -> Result<Option<AdminRow>, sqlx::Error> {
  sqlx::query_as(&format!("SELECT {COLUMNS} FROM admins WHERE id = $1"))
    .bind(id)
    .fetch_optional(executor)
    .await
}

/// Root's email, once root exists.
pub async fn root_email(executor: impl PgExecutor<'_>) -> Result<Option<String>, sqlx::Error> {
  sqlx::query_scalar("SELECT email FROM admins WHERE role = 'root'")
    .fetch_optional(executor)
    .await
}

pub struct NewAdmin<'a> {
  pub id: &'a str,
  pub email: &'a str,
  pub password_hash: Option<&'a str>,
  pub display_name: Option<&'a str>,
  pub role: Role,
  /// Root's email counts as verified: whoever runs the server chose it.
  pub email_verified: bool,
}

/// Insert an admin. A taken email, or a second root, surfaces as a unique
/// violation.
pub async fn insert(
  connection: &mut PgConnection,
  admin: &NewAdmin<'_>,
) -> Result<AdminRow, sqlx::Error> {
  sqlx::query_as(&format!(
    "INSERT INTO admins(id,email,email_verified_at,password_hash,display_name,role,status,created_at,updated_at) \
     VALUES($1,$2,CASE WHEN $3 THEN now() END,$4,$5,$6,'active',now(),now()) RETURNING {COLUMNS}"
  ))
  .bind(admin.id)
  .bind(admin.email)
  .bind(admin.email_verified)
  .bind(admin.password_hash)
  .bind(admin.display_name)
  .bind(admin.role.as_str())
  .fetch_one(connection)
  .await
}

/// `None` leaves a field as it is; `Some(None)` clears it.
#[derive(Default)]
pub struct AdminChanges {
  pub display_name: Option<Option<String>>,
  pub avatar_url: Option<Option<String>>,
}

pub async fn update_profile(
  executor: impl PgExecutor<'_>,
  id: &str,
  changes: &AdminChanges,
) -> Result<AdminRow, sqlx::Error> {
  sqlx::query_as(&format!(
    "UPDATE admins SET \
       display_name = CASE WHEN $2 THEN $3 ELSE display_name END, \
       avatar_url = CASE WHEN $4 THEN $5 ELSE avatar_url END, \
       updated_at = now() \
     WHERE id = $1 RETURNING {COLUMNS}"
  ))
  .bind(id)
  .bind(changes.display_name.is_some())
  .bind(
    changes
      .display_name
      .as_ref()
      .and_then(|value| value.as_deref()),
  )
  .bind(changes.avatar_url.is_some())
  .bind(
    changes
      .avatar_url
      .as_ref()
      .and_then(|value| value.as_deref()),
  )
  .fetch_one(executor)
  .await
}

pub async fn set_status(
  executor: impl PgExecutor<'_>,
  id: &str,
  status: UserStatus,
) -> Result<AdminRow, sqlx::Error> {
  sqlx::query_as(&format!(
    "UPDATE admins SET status = $2, updated_at = now() WHERE id = $1 RETURNING {COLUMNS}"
  ))
  .bind(id)
  .bind(status.as_str())
  .fetch_one(executor)
  .await
}

pub async fn delete(
  executor: impl PgExecutor<'_>,
  id: &str,
) -> Result<bool, sqlx::Error> {
  sqlx::query("DELETE FROM admins WHERE id = $1")
    .bind(id)
    .execute(executor)
    .await
    .map(|result| result.rows_affected() > 0)
}

/// Every admin, root first, then newest first. An instance has a handful,
/// so there is no paging.
pub async fn list(pool: &PgPool) -> Result<Vec<AdminRow>, sqlx::Error> {
  sqlx::query_as(&format!(
    "SELECT {COLUMNS} FROM admins ORDER BY (role = 'root') DESC, created_at DESC, id DESC"
  ))
  .fetch_all(pool)
  .await
}

/// The admin with this email, locked until the transaction ends.
pub async fn find_by_email_for_update(
  connection: &mut PgConnection,
  email: &str,
) -> Result<Option<AdminRow>, sqlx::Error> {
  sqlx::query_as(&format!(
    "SELECT {COLUMNS} FROM admins WHERE email = $1 FOR UPDATE"
  ))
  .bind(email)
  .fetch_optional(connection)
  .await
}
