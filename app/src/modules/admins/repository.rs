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
  pub role: String,
  pub status: String,
  pub locked_until: Option<DateTime<Utc>>,
  pub last_sign_in_at: Option<DateTime<Utc>>,
  pub created_at: DateTime<Utc>,
  pub updated_at: DateTime<Utc>,
}

impl AdminRow {
  pub fn role(&self) -> Role {
    Role::parse(&self.role).unwrap_or(Role::Admin)
  }

  pub fn is_active(&self) -> bool {
    self.status == "active"
  }

  pub fn to_admin(&self) -> Admin {
    Admin {
      id: self.id.clone(),
      email: self.email.clone(),
      display_name: self.display_name.clone(),
      avatar_url: self.avatar_url.clone(),
      role: self.role(),
      status: if self.is_active() {
        UserStatus::Active
      } else {
        UserStatus::Disabled
      },
      has_password: self.password_hash.is_some(),
      locked_until: self.locked_until.filter(|until| *until > Utc::now()),
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
  .bind(changes.display_name.clone().flatten())
  .bind(changes.avatar_url.is_some())
  .bind(changes.avatar_url.clone().flatten())
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
