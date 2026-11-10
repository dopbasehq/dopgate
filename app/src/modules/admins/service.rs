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
  modules::{audit, sessions, settings},
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
  if target.role() == Role::Root {
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
      .iter()
      .map(AdminRow::to_admin)
      .collect(),
  })
}

pub async fn get(
  state: &AppState,
  id: &str,
) -> Result<Admin, HttpError> {
  Ok(find(state, id).await?.to_admin())
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
      validate::new_password(&password, policy.min_length)?;
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
  Ok(admin.to_admin())
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
  Ok(updated.to_admin())
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
  Ok(updated.to_admin())
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
