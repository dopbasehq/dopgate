//! Forgot and reset password, by emailed code, for admins and users. The
//! endpoints here are the app's; the console calls the same functions with
//! its realm.

use super::model::*;
use crate::{
  constants::errors::{ACCOUNT_DISABLED, CODE_INVALID},
  http::HttpError,
  models::Realm,
  modules::{
    accounts::repository as accounts,
    audit, email_templates, sessions, settings,
    verification::service::{self as verification},
  },
  services::{limits, otp::Purpose, password},
  state::AppState,
  utils::validate,
};

/// Email a reset code. The answer is the same whether or not the email has
/// an account, so the endpoint cannot be used to find accounts.
pub async fn forgot(
  state: &AppState,
  realm: Realm,
  request: ForgotPasswordRequest,
) -> Result<(), HttpError> {
  limits::per_address(state).await?;
  let email = validate::email(&request.email)?;
  verification::check_send_limits(state, realm, Purpose::PasswordReset, &email).await?;
  if let Some(account) = accounts::find_by_email(state.db.pool(), realm, &email).await?
    && account.is_active()
  {
    verification::issue(
      state,
      realm,
      Purpose::PasswordReset,
      verification::target_for(&account),
    )
    .await?;
  }
  Ok(())
}

/// Set a new password with the emailed code. Every session of the account
/// ends, the lockout clears, and the email counts as verified: the user just
/// proved they read that inbox.
pub async fn reset(
  state: &AppState,
  realm: Realm,
  request: ResetPasswordRequest,
) -> Result<(), HttpError> {
  limits::per_address(state).await?;
  let email = validate::email(&request.email)?;
  let policy = settings::service::password(state.db.pool()).await?;
  validate::new_password(&request.new_password, policy.min_length)?;
  let (mut tx, row) =
    verification::consume(state, realm, Purpose::PasswordReset, &email, &request.code).await?;
  let user = match row.account_id.as_deref() {
    Some(id) => accounts::find_by_id_for_update(&mut tx, realm, id).await?,
    None => None,
  }
  .ok_or_else(|| {
    HttpError::bad_request(
      CODE_INVALID,
      "That code is wrong or has expired. Ask for a new one.",
    )
  })?;
  if !user.is_active() {
    return Err(HttpError::forbidden(
      ACCOUNT_DISABLED,
      "This account is disabled. Contact an administrator.",
    ));
  }
  let hash = password::hash_async(request.new_password)
    .await
    .map_err(|error| {
      tracing::error!(%error, "failed to hash a password");
      HttpError::internal()
    })?;
  accounts::set_password(&mut *tx, realm, &user.id, &hash).await?;
  accounts::mark_verified(&mut *tx, realm, &user.id).await?;
  let ended =
    sessions::service::revoke_all(&mut tx, realm, &user.id, None, "password_reset").await?;
  let actor_type = verification::actor_type_of(&mut tx, realm, &user.id).await?;
  let action = format!("{}.password_reset", realm.resource());
  audit::service::record(
    &mut tx,
    audit::service::Event::account(realm, &user.id, &user.email, &actor_type, &action)
      .metadata(serde_json::json!({ "sessionsEnded": ended })),
  )
  .await?;
  tx.commit().await?;
  let values =
    email_templates::service::base_values(state, &user.email, user.display_name.as_deref()).await?;
  email_templates::service::send(state, "password_changed", &user.email, values).await
}
