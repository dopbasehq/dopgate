//! Managing your app's users, for root, admins, and the service key.

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use chrono::{DateTime, Utc};

use super::{
  model::*,
  repository::{self, ProfileChanges, UserRow},
};
use crate::{
  constants::{
    errors::{EMAIL_TAKEN, NOT_FOUND, REQUEST_INVALID},
    tokens::USER_ID_PREFIX,
  },
  http::HttpError,
  models::{AuthIdentity, Realm, UserStatus},
  modules::{
    audit,
    sessions::{self, model::SessionResponse},
    settings,
    verification::service::{self as verification, CodeTarget},
  },
  services::{otp::Purpose, password, token},
  state::AppState,
  utils::validate,
};

fn not_found() -> HttpError {
  HttpError::not_found(NOT_FOUND, "No user has this ID.")
}

fn encode_cursor(user: &UserRow) -> String {
  URL_SAFE_NO_PAD.encode(format!("{}|{}", user.created_at.to_rfc3339(), user.id))
}

fn decode_cursor(value: &str) -> Result<(DateTime<Utc>, String), HttpError> {
  let invalid = || HttpError::bad_request(REQUEST_INVALID, "The cursor is invalid.");
  let bytes = URL_SAFE_NO_PAD.decode(value).map_err(|_| invalid())?;
  let text = String::from_utf8(bytes).map_err(|_| invalid())?;
  let (time, id) = text.split_once('|').ok_or_else(invalid)?;
  let time = DateTime::parse_from_rfc3339(time)
    .map_err(|_| invalid())?
    .with_timezone(&Utc);
  Ok((time, id.to_owned()))
}

pub async fn list(
  state: &AppState,
  query: UserQuery,
) -> Result<UserPage, HttpError> {
  let limit = query.limit.unwrap_or(50).clamp(1, 200);
  let cursor = query.cursor.as_deref().map(decode_cursor).transpose()?;
  let search = query
    .search
    .as_deref()
    .map(str::trim)
    .filter(|search| !search.is_empty());
  let mut rows = repository::list(
    state.db.pool(),
    &repository::ListFilter {
      search,
      status: query.status,
      before: cursor.as_ref().map(|(time, id)| (*time, id.as_str())),
      limit: i64::from(limit) + 1,
    },
  )
  .await?;
  let next_cursor = if rows.len() > limit as usize {
    rows.truncate(limit as usize);
    rows.last().map(encode_cursor)
  } else {
    None
  };
  Ok(UserPage {
    items: rows.iter().map(UserRow::to_admin).collect(),
    next_cursor,
  })
}

async fn find(
  state: &AppState,
  id: &str,
) -> Result<UserRow, HttpError> {
  repository::find_by_id(state.db.pool(), id)
    .await?
    .ok_or_else(not_found)
}

pub async fn get(
  state: &AppState,
  id: &str,
) -> Result<AdminUser, HttpError> {
  Ok(find(state, id).await?.to_admin())
}

pub async fn create(
  state: &AppState,
  actor: &AuthIdentity,
  request: CreateUserRequest,
) -> Result<AdminUser, HttpError> {
  let email = validate::email(&request.email)?;
  let display_name = validate::display_name(request.display_name)?.flatten();
  let public_metadata = validate::metadata(
    "publicMetadata",
    request
      .public_metadata
      .unwrap_or_else(|| serde_json::json!({})),
  )?;
  let private_metadata = validate::metadata(
    "privateMetadata",
    request
      .private_metadata
      .unwrap_or_else(|| serde_json::json!({})),
  )?;
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
  let id = token::public_id(USER_ID_PREFIX);
  let mut tx = state.db.pool().begin().await?;
  let user = match repository::insert(
    &mut tx,
    &repository::NewUser {
      id: &id,
      email: &email,
      password_hash: password_hash.as_deref(),
      display_name: display_name.as_deref(),
      email_verified: request.email_verified,
      public_metadata: &public_metadata,
      private_metadata: &private_metadata,
    },
  )
  .await
  {
    Ok(user) => user,
    Err(error) if repository::is_email_taken(&error) => {
      return Err(HttpError::conflict(
        EMAIL_TAKEN,
        "Another user already uses this email.",
      ));
    }
    Err(error) => return Err(error.into()),
  };
  audit::service::record(
    &mut tx,
    audit::service::Event::by(actor, "user.created")
      .resource("user", Some(&user.id))
      .metadata(serde_json::json!({ "email": user.email })),
  )
  .await?;
  tx.commit().await?;
  Ok(user.to_admin())
}

pub async fn update(
  state: &AppState,
  actor: &AuthIdentity,
  id: &str,
  request: UpdateUserRequest,
) -> Result<AdminUser, HttpError> {
  find(state, id).await?;
  let changes = ProfileChanges {
    display_name: validate::display_name(request.display_name)?,
    avatar_url: validate::avatar_url(request.avatar_url)?,
    user_metadata: None,
    public_metadata: request
      .public_metadata
      .map(|value| validate::metadata("publicMetadata", value))
      .transpose()?,
    private_metadata: request
      .private_metadata
      .map(|value| validate::metadata("privateMetadata", value))
      .transpose()?,
    email_verified: request.email_verified,
  };
  let mut tx = state.db.pool().begin().await?;
  let updated = repository::update_profile(&mut *tx, id, &changes).await?;
  let mut fields = Vec::new();
  for (name, changed) in [
    ("displayName", changes.display_name.is_some()),
    ("avatarUrl", changes.avatar_url.is_some()),
    ("publicMetadata", changes.public_metadata.is_some()),
    ("privateMetadata", changes.private_metadata.is_some()),
    ("emailVerified", changes.email_verified.is_some()),
  ] {
    if changed {
      fields.push(name);
    }
  }
  audit::service::record(
    &mut tx,
    audit::service::Event::by(actor, "user.updated")
      .resource("user", Some(id))
      .metadata(serde_json::json!({ "fields": fields })),
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
  let target = find(state, id).await?;
  let mut tx = state.db.pool().begin().await?;
  if !repository::delete(&mut *tx, id).await? {
    return Err(not_found());
  }
  audit::service::record(
    &mut tx,
    audit::service::Event::by(actor, "user.deleted")
      .resource("user", Some(id))
      .metadata(serde_json::json!({ "email": target.email })),
  )
  .await?;
  tx.commit().await?;
  Ok(())
}

pub async fn set_status(
  state: &AppState,
  actor: &AuthIdentity,
  id: &str,
  status: UserStatus,
) -> Result<AdminUser, HttpError> {
  find(state, id).await?;
  let mut tx = state.db.pool().begin().await?;
  let updated = repository::set_status(&mut *tx, id, status).await?;
  let (action, ended) = match status {
    UserStatus::Disabled => (
      "user.disabled",
      sessions::service::revoke_all(&mut tx, Realm::App, id, None, "account_disabled").await?,
    ),
    UserStatus::Active => ("user.enabled", 0),
  };
  audit::service::record(
    &mut tx,
    audit::service::Event::by(actor, action)
      .resource("user", Some(id))
      .metadata(serde_json::json!({ "sessionsEnded": ended })),
  )
  .await?;
  tx.commit().await?;
  Ok(updated.to_admin())
}

/// Email the user a password reset code.
pub async fn send_password_reset(
  state: &AppState,
  actor: &AuthIdentity,
  id: &str,
) -> Result<(), HttpError> {
  let target = find(state, id).await?;
  verification::issue(
    state,
    Realm::App,
    Purpose::PasswordReset,
    CodeTarget {
      email: &target.email,
      account_id: Some(&target.id),
      display_name: target.display_name.as_deref(),
      current_email: None,
    },
  )
  .await?;
  audit::service::record_now(
    state.db.pool(),
    audit::service::Event::by(actor, "user.password_reset_sent").resource("user", Some(id)),
  )
  .await;
  Ok(())
}

pub async fn sessions(
  state: &AppState,
  id: &str,
) -> Result<Vec<SessionResponse>, HttpError> {
  find(state, id).await?;
  sessions::service::list(state, Realm::App, id, None).await
}

pub async fn revoke_sessions(
  state: &AppState,
  actor: &AuthIdentity,
  id: &str,
) -> Result<(), HttpError> {
  find(state, id).await?;
  let mut tx = state.db.pool().begin().await?;
  let ended =
    sessions::service::revoke_all(&mut tx, Realm::App, id, None, "revoked_by_admin").await?;
  audit::service::record(
    &mut tx,
    audit::service::Event::by(actor, "user.sessions_revoked")
      .resource("user", Some(id))
      .metadata(serde_json::json!({ "sessionsEnded": ended })),
  )
  .await?;
  tx.commit().await?;
  Ok(())
}
