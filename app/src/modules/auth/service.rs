//! Sign-up, sign-in, and the signed-in account.

use axum::http::StatusCode;

use super::model::*;
use crate::{
  constants::{
    errors::{
      ACCOUNT_DISABLED, AUTHENTICATION_INVALID, EMAIL_NOT_VERIFIED, EMAIL_TAKEN, NOT_FOUND,
      SIGNUP_DISABLED,
    },
    tokens::USER_ID_PREFIX,
  },
  extractors::UserIdentity,
  http::HttpError,
  models::{Role, User},
  modules::{
    audit, email_templates,
    sessions::{self, model::SignInMethod},
    settings,
    users::repository::{self as users, ProfileChanges, UserRow},
    verification::service::{self as verification, CodeTarget},
  },
  services::{otp::Purpose, password},
  state::AppState,
  utils::validate,
};

/// A real hash of a random value, checked when the email has no account so
/// the answer takes as long as a real check.
static DUMMY_HASH: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
  password::hash(&password::generate()).expect("hashing the dummy password failed")
});

fn wrong_credentials() -> HttpError {
  HttpError::unauthorized(AUTHENTICATION_INVALID, "The email or password is wrong.")
}

fn disabled() -> HttpError {
  HttpError::forbidden(
    ACCOUNT_DISABLED,
    "This account is disabled. Contact an administrator.",
  )
}

pub async fn methods(state: &AppState) -> Result<AuthMethods, HttpError> {
  let pool = state.db.pool();
  let signup = settings::service::signup(pool).await?;
  Ok(AuthMethods {
    signup_enabled: signup.enabled,
    password: true,
    email_otp: true,
    email_verification_required: signup.require_email_verification,
    branding: settings::service::branding(pool).await?,
  })
}

pub async fn signup(
  state: &AppState,
  request: SignupRequest,
  user_agent: Option<&str>,
) -> Result<SignupResult, HttpError> {
  let pool = state.db.pool();
  let signup = settings::service::signup(pool).await?;
  if !signup.enabled {
    return Err(HttpError::forbidden(
      SIGNUP_DISABLED,
      "Sign-up is turned off. Ask an administrator for an account.",
    ));
  }
  let email = validate::email(&request.email)?;
  let policy = settings::service::password(pool).await?;
  validate::new_password(&request.password, policy.min_length)?;
  let display_name = validate::display_name(request.display_name)?.flatten();
  let hash = password::hash_async(request.password)
    .await
    .map_err(|error| {
      tracing::error!(%error, "failed to hash a password");
      HttpError::internal()
    })?;
  let id = crate::services::token::public_id(USER_ID_PREFIX);
  let empty = serde_json::json!({});
  let mut tx = pool.begin().await?;
  let user = match users::insert(
    &mut tx,
    &users::NewUser {
      id: &id,
      email: &email,
      password_hash: Some(&hash),
      display_name: display_name.as_deref(),
      role: Role::Member,
      email_verified: false,
      public_metadata: &empty,
      private_metadata: &empty,
    },
  )
  .await
  {
    Ok(user) => user,
    Err(error) if users::is_email_taken(&error) => {
      return Err(HttpError::conflict(
        EMAIL_TAKEN,
        "This email is already registered. Sign in instead.",
      ));
    }
    Err(error) => return Err(error.into()),
  };
  audit::service::record(
    &mut tx,
    audit::service::Event::user(&user.id, &user.email, &user.role, "user.signed_up")
      .metadata(serde_json::json!({ "method": "password" })),
  )
  .await?;
  let tokens = if signup.require_email_verification {
    None
  } else {
    Some(sessions::service::start(state, &mut tx, &user, SignInMethod::Password, user_agent).await?)
  };
  tx.commit().await?;
  verification::issue(state, Purpose::EmailVerify, code_target(&user)).await?;
  Ok(SignupResult {
    user: tokens
      .as_ref()
      .map_or_else(|| user.to_user(), |tokens| tokens.user.clone()),
    verification_required: signup.require_email_verification,
    verification_sent: true,
    tokens,
  })
}

fn code_target(user: &UserRow) -> CodeTarget<'_> {
  CodeTarget {
    email: &user.email,
    user_id: Some(&user.id),
    display_name: user.display_name.as_deref(),
    current_email: None,
  }
}

/// Sign in with an email and password. A disabled or unverified account is
/// only reported after the right password, so the answer never reveals that
/// an account exists.
pub async fn login(
  state: &AppState,
  request: LoginRequest,
  user_agent: Option<&str>,
) -> Result<AuthTokens, HttpError> {
  let pool = state.db.pool();
  let Some(email) = crate::utils::email::normalize(&request.email) else {
    return Err(wrong_credentials());
  };
  let user = users::find_by_email(pool, &email).await?;
  let stored = user
    .as_ref()
    .and_then(|user| user.password_hash.clone())
    .unwrap_or_else(|| DUMMY_HASH.clone());
  let matches = password::verify_async(request.password, stored).await;
  let Some(user) = user else {
    return Err(wrong_credentials());
  };
  if !matches || user.password_hash.is_none() {
    audit::service::record_now(
      pool,
      audit::service::Event::user(&user.id, &user.email, &user.role, "user.sign_in_failed")
        .metadata(serde_json::json!({ "reason": "password" })),
    )
    .await;
    return Err(wrong_credentials());
  }
  if !user.is_active() {
    return Err(disabled());
  }
  let signup = settings::service::signup(pool).await?;
  if signup.require_email_verification && !user.is_verified() {
    return Err(HttpError::forbidden(
      EMAIL_NOT_VERIFIED,
      &format!(
        "Confirm your email first. Send a code to {} with /auth/verification/send.",
        user.email
      ),
    ));
  }
  let mut tx = pool.begin().await?;
  let tokens =
    sessions::service::start(state, &mut tx, &user, SignInMethod::Password, user_agent).await?;
  tx.commit().await?;
  Ok(tokens)
}

/// Sign out. With an access token, its session ends (or all of them). With
/// only a refresh token, that token's session ends.
pub async fn logout(
  state: &AppState,
  user: Option<&UserIdentity>,
  refresh_token: Option<&str>,
  all_sessions: bool,
) -> Result<(), HttpError> {
  let target = match (user, refresh_token) {
    (Some(user), _) => Some((user.user_id.clone(), user.session_id.clone())),
    (None, Some(token)) => sessions::service::session_of_refresh_token(state, token)
      .await?
      .map(|(session_id, user_id)| (user_id, session_id)),
    (None, None) => {
      return Err(HttpError::unauthorized(
        crate::constants::errors::AUTHENTICATION_REQUIRED,
        "Send an access token or a refresh token to sign out.",
      ));
    }
  };
  let Some((user_id, session_id)) = target else {
    return Ok(());
  };
  let mut tx = state.db.pool().begin().await?;
  if all_sessions {
    sessions::service::revoke_all(&mut tx, &user_id, None, "signed_out_everywhere").await?;
  } else {
    sessions::service::revoke_current(&mut tx, &user_id, &session_id).await?;
  }
  if let Some(account) = users::find_by_id(&mut *tx, &user_id).await? {
    audit::service::record(
      &mut tx,
      audit::service::Event::user(
        &account.id,
        &account.email,
        &account.role,
        "user.signed_out",
      )
      .metadata(serde_json::json!({ "allSessions": all_sessions, "sessionId": session_id })),
    )
    .await?;
  }
  tx.commit().await?;
  Ok(())
}

async fn current(
  state: &AppState,
  user_id: &str,
) -> Result<UserRow, HttpError> {
  users::find_by_id(state.db.pool(), user_id)
    .await?
    .ok_or_else(|| HttpError::not_found(NOT_FOUND, "This account no longer exists."))
}

pub async fn me(
  state: &AppState,
  user: &UserIdentity,
) -> Result<User, HttpError> {
  Ok(current(state, &user.user_id).await?.to_user())
}

pub async fn update_me(
  state: &AppState,
  user: &UserIdentity,
  request: UpdateProfileRequest,
) -> Result<User, HttpError> {
  let changes = ProfileChanges {
    display_name: validate::display_name(request.display_name)?,
    avatar_url: validate::avatar_url(request.avatar_url)?,
    user_metadata: request
      .user_metadata
      .map(|value| validate::metadata("userMetadata", value))
      .transpose()?,
    ..ProfileChanges::default()
  };
  let mut tx = state.db.pool().begin().await?;
  let updated = users::update_profile(&mut *tx, &user.user_id, &changes).await?;
  audit::service::record(
    &mut tx,
    audit::service::Event::user(
      &updated.id,
      &updated.email,
      &updated.role,
      "user.profile_updated",
    ),
  )
  .await?;
  tx.commit().await?;
  Ok(updated.to_user())
}

/// Check the current password of an account that has one.
async fn confirm_password(
  account: &UserRow,
  given: Option<String>,
) -> Result<(), HttpError> {
  let Some(stored) = account.password_hash.clone() else {
    return Ok(());
  };
  let given = given.unwrap_or_default();
  if password::verify_async(given, stored).await {
    Ok(())
  } else {
    Err(HttpError::unauthorized(
      AUTHENTICATION_INVALID,
      "The current password is wrong.",
    ))
  }
}

/// Set a new password. Other sessions end; this one stays signed in.
pub async fn change_password(
  state: &AppState,
  user: &UserIdentity,
  request: ChangePasswordRequest,
) -> Result<(), HttpError> {
  let account = current(state, &user.user_id).await?;
  confirm_password(&account, request.current_password).await?;
  let policy = settings::service::password(state.db.pool()).await?;
  validate::new_password(&request.new_password, policy.min_length)?;
  let hash = password::hash_async(request.new_password)
    .await
    .map_err(|error| {
      tracing::error!(%error, "failed to hash a password");
      HttpError::internal()
    })?;
  let mut tx = state.db.pool().begin().await?;
  users::set_password(&mut *tx, &account.id, &hash).await?;
  let ended = sessions::service::revoke_all(
    &mut tx,
    &account.id,
    Some(&user.session_id),
    "password_changed",
  )
  .await?;
  audit::service::record(
    &mut tx,
    audit::service::Event::user(
      &account.id,
      &account.email,
      &account.role,
      "user.password_changed",
    )
    .metadata(serde_json::json!({ "otherSessionsEnded": ended })),
  )
  .await?;
  tx.commit().await?;
  let values =
    email_templates::service::base_values(state, &account.email, account.display_name.as_deref())
      .await?;
  email_templates::service::send(state, "password_changed", &account.email, values).await
}

/// Start an email change: a code goes to the new address. The account moves
/// once the code is confirmed with `/auth/verification/confirm`.
pub async fn change_email(
  state: &AppState,
  user: &UserIdentity,
  request: ChangeEmailRequest,
) -> Result<(), HttpError> {
  let account = current(state, &user.user_id).await?;
  let new_email = validate::email(&request.new_email)?;
  if new_email == account.email {
    return Err(HttpError::new(
      StatusCode::UNPROCESSABLE_ENTITY,
      crate::constants::errors::EMAIL_INVALID,
      "That is already the email on this account.",
    ));
  }
  confirm_password(&account, request.password).await?;
  if users::find_by_email(state.db.pool(), &new_email)
    .await?
    .is_some()
  {
    return Err(HttpError::conflict(
      EMAIL_TAKEN,
      "Another account already uses this email.",
    ));
  }
  verification::check_send_limits(state, Purpose::EmailChange, &new_email).await?;
  verification::issue(
    state,
    Purpose::EmailChange,
    CodeTarget {
      email: &new_email,
      user_id: Some(&account.id),
      display_name: account.display_name.as_deref(),
      current_email: Some(&account.email),
    },
  )
  .await
}
