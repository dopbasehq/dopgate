//! Personal tokens: a user's own tokens that sign in as that user, for
//! scripts and other systems. Users create them only after a password or
//! code sign-in, never with another personal token, and only while an admin
//! has `selfService.personalTokens` on. Admins can list and revoke them but
//! never see a token.

use axum::http::StatusCode;
use chrono::{Duration, Utc};

use super::{
  model::*,
  repository::{self, TokenRow},
};
use crate::{
  constants::{
    errors::{FEATURE_DISABLED, LIMIT_REACHED, NOT_FOUND, REQUEST_INVALID, TOKEN_NAME_TAKEN},
    tokens::{PERSONAL_TOKEN_ID_PREFIX, PERSONAL_TOKEN_PREFIX},
  },
  extractors::UserIdentity,
  http::HttpError,
  models::AuthIdentity,
  modules::{audit, settings, users},
  services::token,
  state::AppState,
};

const NAME_MAX_CHARS: usize = 64;

fn not_found() -> HttpError {
  HttpError::not_found(NOT_FOUND, "No personal token has this ID.")
}

fn unprocessable(message: &str) -> HttpError {
  HttpError::new(StatusCode::UNPROCESSABLE_ENTITY, REQUEST_INVALID, message)
}

/// A token name: one line of 1 to 64 characters.
pub fn clean_name(raw: &str) -> Result<String, HttpError> {
  let name = raw.trim();
  if name.is_empty() || name.chars().count() > NAME_MAX_CHARS || name.chars().any(char::is_control)
  {
    return Err(unprocessable(
      "The name must be one line of 1 to 64 characters.",
    ));
  }
  Ok(name.to_owned())
}

fn list_of(rows: Vec<TokenRow>) -> PersonalTokenList {
  PersonalTokenList {
    items: rows.iter().map(TokenRow::to_token).collect(),
  }
}

pub async fn list_own(
  state: &AppState,
  user: &UserIdentity,
) -> Result<PersonalTokenList, HttpError> {
  Ok(list_of(
    repository::list(state.db.pool(), &user.user_id).await?,
  ))
}

pub async fn create(
  state: &AppState,
  user: &UserIdentity,
  request: CreatePersonalTokenRequest,
) -> Result<CreatedPersonalToken, HttpError> {
  let pool = state.db.pool();
  let rules = settings::service::self_service(pool).await?;
  if !rules.personal_tokens {
    return Err(HttpError::forbidden(
      FEATURE_DISABLED,
      "Personal tokens are turned off. Ask an admin to turn them on.",
    ));
  }
  let name = clean_name(&request.name)?;
  if let Some(expires_at) = request.expires_at {
    let now = Utc::now();
    if expires_at <= now {
      return Err(unprocessable("The expiry must be in the future."));
    }
    if expires_at > now + Duration::days(token::MAX_EXPIRY_DAYS) {
      return Err(unprocessable("A personal token can last at most 3 years."));
    }
  }
  let secret = token::generate(PERSONAL_TOKEN_PREFIX).map_err(|_| HttpError::internal())?;
  let last_four: String = secret
    .chars()
    .rev()
    .take(4)
    .collect::<Vec<_>>()
    .into_iter()
    .rev()
    .collect();
  let mut tx = pool.begin().await?;
  // Lock the user so two requests can't both slip under the limit.
  sqlx::query("SELECT 1 FROM users WHERE id = $1 FOR UPDATE")
    .bind(&user.user_id)
    .execute(&mut *tx)
    .await?;
  let existing = repository::count(&mut *tx, &user.user_id).await?;
  if existing >= i64::from(rules.max_personal_tokens_per_user) {
    return Err(HttpError::conflict(
      LIMIT_REACHED,
      &format!(
        "You already have {} personal tokens. Delete one first.",
        rules.max_personal_tokens_per_user
      ),
    ));
  }
  let id = token::public_id(PERSONAL_TOKEN_ID_PREFIX);
  let row = match repository::insert(
    &mut *tx,
    &repository::NewToken {
      id: &id,
      user_id: &user.user_id,
      name: &name,
      token_hash: &token::hash(&secret),
      last_four: &last_four,
      expires_at: request.expires_at,
    },
  )
  .await
  {
    Ok(row) => row,
    Err(error)
      if error
        .as_database_error()
        .is_some_and(|database| database.is_unique_violation()) =>
    {
      return Err(HttpError::conflict(
        TOKEN_NAME_TAKEN,
        "You already have a personal token with this name.",
      ));
    }
    Err(error) => return Err(error.into()),
  };
  audit::service::record(
    &mut tx,
    audit::service::Event::user(&user.user_id, &user.email, "personal_token.created")
      .resource("personal_token", Some(&row.id))
      .metadata(serde_json::json!({ "name": row.name, "expiresAt": row.expires_at })),
  )
  .await?;
  tx.commit().await?;
  Ok(CreatedPersonalToken {
    token: secret,
    personal_token: row.to_token(),
  })
}

/// Delete one of the caller's tokens. It stops working at once.
pub async fn delete_own(
  state: &AppState,
  user: &UserIdentity,
  id: &str,
) -> Result<(), HttpError> {
  let mut tx = state.db.pool().begin().await?;
  let row = repository::delete(&mut *tx, &user.user_id, id)
    .await?
    .ok_or_else(not_found)?;
  audit::service::record(
    &mut tx,
    audit::service::Event::user(&user.user_id, &user.email, "personal_token.deleted")
      .resource("personal_token", Some(&row.id))
      .metadata(serde_json::json!({ "name": row.name })),
  )
  .await?;
  tx.commit().await?;
  Ok(())
}

async fn require_user(
  state: &AppState,
  user_id: &str,
) -> Result<(), HttpError> {
  users::repository::find_by_id(state.db.pool(), user_id)
    .await?
    .ok_or_else(|| HttpError::not_found(NOT_FOUND, "No user has this ID."))
    .map(|_| ())
}

/// A user's tokens, for admins. Never includes a token.
pub async fn list_for_user(
  state: &AppState,
  user_id: &str,
) -> Result<PersonalTokenList, HttpError> {
  require_user(state, user_id).await?;
  Ok(list_of(repository::list(state.db.pool(), user_id).await?))
}

/// Revoke a user's token, for admins.
pub async fn revoke_for_user(
  state: &AppState,
  actor: &AuthIdentity,
  user_id: &str,
  id: &str,
) -> Result<(), HttpError> {
  require_user(state, user_id).await?;
  let mut tx = state.db.pool().begin().await?;
  let row = repository::delete(&mut *tx, user_id, id)
    .await?
    .ok_or_else(not_found)?;
  audit::service::record(
    &mut tx,
    audit::service::Event::by(actor, "personal_token.deleted")
      .resource("personal_token", Some(&row.id))
      .metadata(serde_json::json!({ "name": row.name, "userId": user_id })),
  )
  .await?;
  tx.commit().await?;
  Ok(())
}
