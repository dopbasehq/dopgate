//! Forgot and reset password, by emailed code.

use super::model::*;
use crate::{
  constants::errors::{ACCOUNT_DISABLED, CODE_INVALID},
  http::HttpError,
  modules::{
    audit, email_templates, sessions, settings,
    users::repository as users,
    verification::service::{self as verification, CodeTarget},
  },
  services::{limits, otp::Purpose, password},
  state::AppState,
  utils::validate,
};

/// Email a reset code. The answer is the same whether or not the email has
/// an account, so the endpoint cannot be used to find accounts.
pub async fn forgot(
  state: &AppState,
  request: ForgotPasswordRequest,
) -> Result<(), HttpError> {
  limits::per_address(state).await?;
  let email = validate::email(&request.email)?;
  verification::check_send_limits(state, Purpose::PasswordReset, &email).await?;
  if let Some(user) = users::find_by_email(state.db.pool(), &email).await?
    && user.is_active()
  {
    verification::issue(
      state,
      Purpose::PasswordReset,
      CodeTarget {
        email: &user.email,
        user_id: Some(&user.id),
        display_name: user.display_name.as_deref(),
        current_email: None,
      },
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
  request: ResetPasswordRequest,
) -> Result<(), HttpError> {
  limits::per_address(state).await?;
  let email = validate::email(&request.email)?;
  let policy = settings::service::password(state.db.pool()).await?;
  validate::new_password(&request.new_password, policy.min_length)?;
  let (mut tx, row) =
    verification::consume(state, Purpose::PasswordReset, &email, &request.code).await?;
  let user = match row.user_id.as_deref() {
    Some(id) => users::find_by_id_for_update(&mut tx, id).await?,
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
  users::set_password(&mut *tx, &user.id, &hash).await?;
  users::mark_verified(&mut *tx, &user.id).await?;
  let ended = sessions::service::revoke_all(&mut tx, &user.id, None, "password_reset").await?;
  audit::service::record(
    &mut tx,
    audit::service::Event::user(&user.id, &user.email, &user.role, "user.password_reset")
      .metadata(serde_json::json!({ "sessionsEnded": ended })),
  )
  .await?;
  tx.commit().await?;
  let values =
    email_templates::service::base_values(state, &user.email, user.display_name.as_deref()).await?;
  email_templates::service::send(state, "password_changed", &user.email, values).await
}
