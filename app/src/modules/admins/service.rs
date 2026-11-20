//! Managing root and admins. Everyone on the admin side can read the list;
//! only root adds, changes, disables, or removes admins, and nobody changes
//! root through the API.

use super::{
  model::*,
  repository::{self, AdminChanges, AdminRow},
};
use crate::{
  constants::{
    errors::{EMAIL_TAKEN, NOT_FOUND, ROOT_PROTECTED},
    tokens::ADMIN_ID_PREFIX,
  },
  http::HttpError,
  models::{Admin, AuthIdentity, Realm, Role, UserStatus},
  modules::{accounts::repository as accounts, audit, sessions, settings, verification},
  services::{authz, password, token},
  state::AppState,
  utils::validate,
};

fn not_found() -> HttpError {
  HttpError::not_found(NOT_FOUND, "No admin has this ID.")
}

async fn find(
  state: &AppState,
  id: &str,
) -> Result<AdminRow, HttpError> {
  repository::find_by_id(state.db.pool(), id)
    .await?
    .ok_or_else(not_found)
}

/// Root is managed from its own account, never through this API.
fn require_not_root(target: &AdminRow) -> Result<(), HttpError> {
  if target.role == Role::Root {
    return Err(HttpError::forbidden(
      ROOT_PROTECTED,
      "The root account can't be changed through the API.",
    ));
  }
  Ok(())
}

pub async fn list(state: &AppState) -> Result<AdminList, HttpError> {
  Ok(AdminList {
    items: repository::list(state.db.pool())
      .await?
      .into_iter()
      .map(AdminRow::into_admin)
      .collect(),
  })
}

pub async fn get(
  state: &AppState,
  id: &str,
) -> Result<Admin, HttpError> {
  Ok(find(state, id).await?.into_admin())
}

pub async fn create(
  state: &AppState,
  actor: &AuthIdentity,
  request: CreateAdminRequest,
) -> Result<Admin, HttpError> {
  authz::require_root(actor)?;
  let email = validate::email(&request.email)?;
  let display_name = validate::display_name(request.display_name)?.flatten();
  let password_hash = match request.password {
    Some(password) if !password.is_empty() => {
      let policy = settings::service::password(state.db.pool()).await?;
      validate::new_password_checked(state, &password, policy.min_length, policy.reject_leaked)
        .await?;
      Some(password::hash_async(password).await.map_err(|error| {
        tracing::error!(%error, "failed to hash a password");
        HttpError::internal()
      })?)
    }
    _ => None,
  };
  let id = token::public_id(ADMIN_ID_PREFIX);
  let mut tx = state.db.pool().begin().await?;
  let admin = match repository::insert(
    &mut tx,
    &repository::NewAdmin {
      id: &id,
      email: &email,
      password_hash: password_hash.as_deref(),
      display_name: display_name.as_deref(),
      role: Role::Admin,
      email_verified: false,
    },
  )
  .await
  {
    Ok(admin) => admin,
    Err(error) if crate::modules::accounts::repository::is_email_taken(&error) => {
      return Err(HttpError::conflict(
        EMAIL_TAKEN,
        "Another admin already uses this email.",
      ));
    }
    Err(error) => return Err(error.into()),
  };
  audit::service::record(
    &mut tx,
    audit::service::Event::by(actor, "admin.created")
      .resource("admin", Some(&admin.id))
      .metadata(serde_json::json!({ "email": admin.email })),
  )
  .await?;
  tx.commit().await?;
  Ok(admin.into_admin())
}

pub async fn update(
  state: &AppState,
  actor: &AuthIdentity,
  id: &str,
  request: UpdateAdminRequest,
) -> Result<Admin, HttpError> {
  authz::require_root(actor)?;
  let target = find(state, id).await?;
  require_not_root(&target)?;
  let changes = AdminChanges {
    display_name: validate::display_name(request.display_name)?,
    avatar_url: validate::avatar_url(request.avatar_url)?,
  };
  let mut fields = Vec::new();
  if changes.display_name.is_some() {
    fields.push("displayName");
  }
  if changes.avatar_url.is_some() {
    fields.push("avatarUrl");
  }
  let mut tx = state.db.pool().begin().await?;
  let updated = repository::update_profile(&mut *tx, id, &changes).await?;
  audit::service::record(
    &mut tx,
    audit::service::Event::by(actor, "admin.updated")
      .resource("admin", Some(id))
      .metadata(serde_json::json!({ "fields": fields })),
  )
  .await?;
  tx.commit().await?;
  Ok(updated.into_admin())
}

pub async fn set_status(
  state: &AppState,
  actor: &AuthIdentity,
  id: &str,
  status: UserStatus,
) -> Result<Admin, HttpError> {
  authz::require_root(actor)?;
  let target = find(state, id).await?;
  require_not_root(&target)?;
  let mut tx = state.db.pool().begin().await?;
  let updated = repository::set_status(&mut *tx, id, status).await?;
  let (action, ended) = match status {
    UserStatus::Disabled => (
      "admin.disabled",
      sessions::service::revoke_all(&mut tx, Realm::Console, id, None, "account_disabled").await?,
    ),
    UserStatus::Active => ("admin.enabled", 0),
  };
  audit::service::record(
    &mut tx,
    audit::service::Event::by(actor, action)
      .resource("admin", Some(id))
      .metadata(serde_json::json!({ "sessionsEnded": ended })),
  )
  .await?;
  tx.commit().await?;
  Ok(updated.into_admin())
}

pub async fn delete(
  state: &AppState,
  actor: &AuthIdentity,
  id: &str,
) -> Result<(), HttpError> {
  authz::require_root(actor)?;
  let target = find(state, id).await?;
  // Only root gets here and root can't be the target, so nobody deletes
  // their own account.
  require_not_root(&target)?;
  let mut tx = state.db.pool().begin().await?;
  if !repository::delete(&mut *tx, id).await? {
    return Err(not_found());
  }
  audit::service::record(
    &mut tx,
    audit::service::Event::by(actor, "admin.deleted")
      .resource("admin", Some(id))
      .metadata(serde_json::json!({ "email": target.email })),
  )
  .await?;
  tx.commit().await?;
  Ok(())
}

/// What `dopgate admin reset-password` changed.
#[derive(Debug)]
pub struct PasswordReset {
  pub admin_id: String,
  pub email: String,
  pub role: Role,
  /// A disabled admin keeps its status, so it still can't sign in.
  pub disabled: bool,
  pub sessions_ended: u64,
}

/// Why `dopgate admin reset-password` changed nothing.
#[derive(Debug)]
pub enum ResetPasswordError {
  /// No root or admin has this email.
  NotFound,
  /// The password broke the policy. The message says how.
  WeakPassword(String),
  Hash(anyhow::Error),
  Database(sqlx::Error),
}

impl std::fmt::Display for ResetPasswordError {
  fn fmt(
    &self,
    formatter: &mut std::fmt::Formatter<'_>,
  ) -> std::fmt::Result {
    match self {
      Self::NotFound => formatter.write_str("no root or admin has that email"),
      Self::WeakPassword(message) => formatter.write_str(message),
      Self::Hash(error) => write!(formatter, "the password could not be hashed: {error}"),
      Self::Database(error) => write!(formatter, "the database refused the change: {error}"),
    }
  }
}

impl std::error::Error for ResetPasswordError {
  fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
    match self {
      Self::Hash(error) => Some(error.as_ref()),
      Self::Database(error) => Some(error),
      Self::NotFound | Self::WeakPassword(_) => None,
    }
  }
}

impl From<sqlx::Error> for ResetPasswordError {
  fn from(error: sqlx::Error) -> Self {
    Self::Database(error)
  }
}

/// Set a new password for root or an admin, straight in the database, for
/// someone who lost theirs. Whoever can reach the database can run it, so it
/// asks for no other proof. The lockout clears, every console session of the
/// account ends, and codes already emailed to it stop working.
pub async fn reset_password(
  db: &crate::services::db::DbClient,
  email: &str,
  new_password: &str,
) -> Result<PasswordReset, ResetPasswordError> {
  let email = crate::utils::email::normalize(email).ok_or(ResetPasswordError::NotFound)?;
  password::check_policy(new_password)
    .map_err(|violation| ResetPasswordError::WeakPassword(violation.0))?;
  let password_hash = password::hash_async(new_password.to_owned())
    .await
    .map_err(ResetPasswordError::Hash)?;
  let mut tx = db.pool().begin().await?;
  let admin = repository::find_by_email_for_update(&mut tx, &email)
    .await?
    .ok_or(ResetPasswordError::NotFound)?;
  accounts::set_password(&mut *tx, Realm::Console, &admin.id, &password_hash).await?;
  let sessions_ended =
    sessions::repository::revoke_all(&mut *tx, Realm::Console, &admin.id, None, "password_reset")
      .await?;
  verification::repository::consume_all(&mut tx, Realm::Console, &admin.id).await?;
  audit::service::record(
    &mut tx,
    audit::service::Event {
      actor_type: "system",
      actor_id: None,
      actor_label: Some("cli"),
      action: "admin.password_reset",
      resource_type: Some(Realm::Console.resource()),
      resource_id: Some(&admin.id),
      metadata: serde_json::json!({ "email": admin.email, "sessionsEnded": sessions_ended }),
    },
  )
  .await?;
  tx.commit().await?;
  Ok(PasswordReset {
    disabled: admin.status != UserStatus::Active,
    role: admin.role,
    admin_id: admin.id,
    email: admin.email,
    sessions_ended,
  })
}
