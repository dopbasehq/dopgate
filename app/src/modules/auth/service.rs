//! Sign-up, sign-in, and the signed-in account. The password, sign-out,
//! and email-change steps take the realm, so the console uses them for
//! admins too.

use axum::http::StatusCode;

use super::model::*;
use crate::{
  constants::{
    errors::{
      ACCOUNT_DISABLED, AUTHENTICATION_INVALID, CODE_INVALID, EMAIL_NOT_VERIFIED, EMAIL_TAKEN,
      NOT_FOUND, SIGNUP_DISABLED,
    },
    tokens::{ACCESS_TOKEN_ID_PREFIX, USER_ID_PREFIX},
  },
  http::HttpError,
  models::{AccessClaims, Realm, TokenKind, User},
  modules::{
    accounts::repository::{self as accounts, AccountRow},
    audit, email_templates,
    sessions::{self, model::SignInMethod, service::Grant},
    settings,
    users::repository::{self as users, ProfileChanges, UserRow},
    verification::service::{self as verification, CodeTarget},
  },
  services::{jwt, limits, otp::Purpose, password},
  state::AppState,
  utils::validate,
};

/// A real hash of a random value, checked when the email has no account so
/// the answer takes as long as a real check.
static DUMMY_HASH: std::sync::OnceLock<String> = std::sync::OnceLock::new();

/// The placeholder hash, made on first use and kept for the life of the
/// process. Startup calls this, so a hashing failure stops the server there
/// and a sign-in never has to make the hash itself.
pub fn dummy_hash() -> anyhow::Result<&'static str> {
  if let Some(hash) = DUMMY_HASH.get() {
    return Ok(hash);
  }
  let hash = password::hash(&password::generate())?;
  Ok(DUMMY_HASH.get_or_init(|| hash))
}

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
  limits::per_address(state).await?;
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
  validate::new_password_checked(
    state,
    &request.password,
    policy.min_length,
    policy.reject_leaked,
  )
  .await?;
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
    audit::service::Event::user(&user.id, &user.email, "user.signed_up")
      .metadata(serde_json::json!({ "method": "password" })),
  )
  .await?;
  let grant = if signup.require_email_verification {
    None
  } else {
    let account = accounts::find_by_id(&mut *tx, Realm::App, &user.id)
      .await?
      .ok_or_else(HttpError::internal)?;
    Some(
      sessions::service::start(
        &mut tx,
        Realm::App,
        &account,
        "user",
        SignInMethod::Password,
        user_agent,
      )
      .await?,
    )
  };
  tx.commit().await?;
  let tokens = match grant {
    Some(grant) => Some(app_tokens(state, &user.id, grant).await?),
    None => None,
  };
  verification::issue(state, Realm::App, Purpose::EmailVerify, code_target(&user)).await?;
  Ok(SignupResult {
    user: tokens
      .as_ref()
      .map_or_else(|| user.into_user(), |tokens| tokens.user.clone()),
    verification_required: signup.require_email_verification,
    verification_sent: true,
    tokens,
  })
}

fn code_target(user: &UserRow) -> CodeTarget<'_> {
  CodeTarget {
    email: &user.email,
    account_id: Some(&user.id),
    display_name: user.display_name.as_deref(),
    current_email: None,
  }
}

/// The app's access token and refresh token for a started or refreshed
/// session.
pub async fn app_tokens(
  state: &AppState,
  user_id: &str,
  grant: Grant,
) -> Result<AuthTokens, HttpError> {
  let user = users::find_by_id(state.db.pool(), user_id)
    .await?
    .ok_or_else(HttpError::internal)?;
  let now = chrono::Utc::now();
  let expires_in = i64::from(grant.access_minutes) * 60;
  let claims = AccessClaims {
    iss: state.config.issuer().to_owned(),
    sub: user.id.clone(),
    aud: state.config.issuer().to_owned(),
    exp: now.timestamp() + expires_in,
    iat: now.timestamp(),
    jti: crate::services::token::public_id(ACCESS_TOKEN_ID_PREFIX),
    sid: Some(grant.session_id),
    kind: TokenKind::Human,
    via: None,
    tid: None,
    email: Some(user.email.clone()),
    email_verified: Some(user.is_verified()),
    owner: None,
    capabilities: None,
    public_metadata: user.public_claim(),
  };
  Ok(AuthTokens {
    access_token: jwt::sign(state, &claims).await?,
    token_type: "Bearer".into(),
    expires_in,
    refresh_token: Some(grant.refresh_token),
    user: user.into_user(),
  })
}

/// Check an email and password. Wrong passwords count toward the account
/// lockout. While locked, every attempt gets the same answer as a wrong
/// password. A disabled account is only reported after the right password,
/// so the answer never reveals that an account exists.
pub async fn check_password(
  state: &AppState,
  realm: Realm,
  email: &str,
  given: String,
) -> Result<AccountRow, HttpError> {
  limits::per_address(state).await?;
  let pool = state.db.pool();
  let Some(email) = crate::utils::email::normalize(email) else {
    return Err(wrong_credentials());
  };
  let account = accounts::find_by_email(pool, realm, &email).await?;
  // The hash moves to a blocking thread, so it is copied either way.
  let stored = match account
    .as_ref()
    .and_then(|account| account.password_hash.clone())
  {
    Some(hash) => hash,
    None => dummy_hash()
      .map_err(|error| {
        tracing::error!(%error, "failed to hash the placeholder password");
        HttpError::internal()
      })?
      .to_owned(),
  };
  let matches = password::verify_async(given, stored).await;
  let Some(account) = account else {
    return Err(wrong_credentials());
  };
  let actor_type = verification::actor_type_of(pool, realm, &account.id).await?;
  let failed = format!("{}.sign_in_failed", realm.resource());
  if account.is_locked() {
    audit::service::record_now(
      pool,
      audit::service::Event::account(realm, &account.id, &account.email, actor_type, &failed)
        .metadata(serde_json::json!({ "reason": "locked" })),
    )
    .await;
    return Err(wrong_credentials());
  }
  if !matches || account.password_hash.is_none() {
    let config = settings::service::limits(pool).await?;
    let locked = accounts::record_failure(
      pool,
      realm,
      &account.id,
      i32::try_from(config.lockout_attempts).unwrap_or(i32::MAX),
      i32::try_from(config.lockout_minutes).unwrap_or(i32::MAX),
    )
    .await?;
    audit::service::record_now(
      pool,
      audit::service::Event::account(realm, &account.id, &account.email, actor_type, &failed)
        .metadata(serde_json::json!({ "reason": "password", "locked": locked })),
    )
    .await;
    return Err(wrong_credentials());
  }
  if !account.is_active() {
    return Err(disabled());
  }
  Ok(account)
}

/// Sign in to your app with an email and password.
pub async fn login(
  state: &AppState,
  request: LoginRequest,
  user_agent: Option<&str>,
) -> Result<AuthTokens, HttpError> {
  let user = check_password(state, Realm::App, &request.email, request.password).await?;
  let pool = state.db.pool();
  let signup = settings::service::signup(pool).await?;
  if signup.require_email_verification && !user.is_verified() {
    return Err(HttpError::forbidden(
      EMAIL_NOT_VERIFIED,
      "Confirm your email before signing in. Enter the code we emailed you, or ask for a new one.",
    ));
  }
  let mut tx = pool.begin().await?;
  let grant = sessions::service::start(
    &mut tx,
    Realm::App,
    &user,
    "user",
    SignInMethod::Password,
    user_agent,
  )
  .await?;
  tx.commit().await?;
  app_tokens(state, &user.id, grant).await
}

/// Sign out. With a signed-in session, it ends (or all of them). With only
/// a refresh token, that token's session ends.
pub async fn logout(
  state: &AppState,
  realm: Realm,
  current: Option<(&str, &str)>,
  refresh_token: Option<&str>,
  all_sessions: bool,
) -> Result<(), HttpError> {
  let target = match (current, refresh_token) {
    (Some((account_id, session_id)), _) => Some((account_id.to_owned(), session_id.to_owned())),
    (None, Some(token)) => sessions::service::session_of_refresh_token(state, realm, token)
      .await?
      .map(|(session_id, account_id)| (account_id, session_id)),
    (None, None) => {
      return Err(HttpError::unauthorized(
        crate::constants::errors::AUTHENTICATION_REQUIRED,
        "Send an access token or a refresh token to sign out.",
      ));
    }
  };
  let Some((account_id, session_id)) = target else {
    return Ok(());
  };
  let mut tx = state.db.pool().begin().await?;
  if all_sessions {
    sessions::service::revoke_all(&mut tx, realm, &account_id, None, "signed_out_everywhere")
      .await?;
  } else {
    sessions::service::revoke_current(&mut tx, realm, &account_id, &session_id).await?;
  }
  if let Some(account) = accounts::find_by_id(&mut *tx, realm, &account_id).await? {
    let actor_type = verification::actor_type_of(&mut *tx, realm, &account.id).await?;
    let action = format!("{}.signed_out", realm.resource());
    audit::service::record(
      &mut tx,
      audit::service::Event::account(realm, &account.id, &account.email, actor_type, &action)
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
  user_id: &str,
) -> Result<User, HttpError> {
  Ok(current(state, user_id).await?.into_user())
}

pub async fn update_me(
  state: &AppState,
  user_id: &str,
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
  let updated = users::update_profile(&mut *tx, user_id, &changes).await?;
  audit::service::record(
    &mut tx,
    audit::service::Event::user(&updated.id, &updated.email, "user.profile_updated"),
  )
  .await?;
  tx.commit().await?;
  Ok(updated.into_user())
}

async fn find_account(
  state: &AppState,
  realm: Realm,
  account_id: &str,
) -> Result<AccountRow, HttpError> {
  accounts::find_by_id(state.db.pool(), realm, account_id)
    .await?
    .ok_or_else(|| HttpError::not_found(NOT_FOUND, "This account no longer exists."))
}

/// Check the current password of an account that has one. A wrong guess
/// counts like a wrong sign-in, toward the caller's address limit and the
/// account lockout, and a locked account gets the same answer as a wrong
/// password. Without this, a stolen access token could guess the password
/// without limit.
async fn confirm_password(
  state: &AppState,
  realm: Realm,
  account: &AccountRow,
  given: Option<String>,
) -> Result<(), HttpError> {
  let Some(stored) = account.password_hash.clone() else {
    return Ok(());
  };
  limits::per_address(state).await?;
  let wrong = || HttpError::unauthorized(AUTHENTICATION_INVALID, "The current password is wrong.");
  let pool = state.db.pool();
  let actor_type = verification::actor_type_of(pool, realm, &account.id).await?;
  let failed = format!("{}.password_check_failed", realm.resource());
  if account.is_locked() {
    audit::service::record_now(
      pool,
      audit::service::Event::account(realm, &account.id, &account.email, actor_type, &failed)
        .metadata(serde_json::json!({ "reason": "locked" })),
    )
    .await;
    return Err(wrong());
  }
  if password::verify_async(given.unwrap_or_default(), stored).await {
    return Ok(());
  }
  let config = settings::service::limits(pool).await?;
  let locked = accounts::record_failure(
    pool,
    realm,
    &account.id,
    i32::try_from(config.lockout_attempts).unwrap_or(i32::MAX),
    i32::try_from(config.lockout_minutes).unwrap_or(i32::MAX),
  )
  .await?;
  audit::service::record_now(
    pool,
    audit::service::Event::account(realm, &account.id, &account.email, actor_type, &failed)
      .metadata(serde_json::json!({ "reason": "password", "locked": locked })),
  )
  .await;
  Err(wrong())
}

/// Set a new password. Other sessions end; the current one stays signed in.
///
/// An account with a password confirms the current one. An account without
/// one (made by an emailed code, or by an admin without a password) sends a
/// password reset code instead, so a stolen access token alone can't add a
/// password and keep the account.
pub async fn change_password(
  state: &AppState,
  realm: Realm,
  account_id: &str,
  session_id: &str,
  request: ChangePasswordRequest,
) -> Result<(), HttpError> {
  let account = find_account(state, realm, account_id).await?;
  let first_password = account.password_hash.is_none();
  if first_password && request.code.as_deref().is_none_or(str::is_empty) {
    return Err(HttpError::bad_request(
      CODE_INVALID,
      "This account has no password yet. Set one with the code from a password reset email.",
    ));
  }
  confirm_password(state, realm, &account, request.current_password).await?;
  let policy = settings::service::password(state.db.pool()).await?;
  validate::new_password_checked(
    state,
    &request.new_password,
    policy.min_length,
    policy.reject_leaked,
  )
  .await?;
  let hash = password::hash_async(request.new_password)
    .await
    .map_err(|error| {
      tracing::error!(%error, "failed to hash a password");
      HttpError::internal()
    })?;
  let mut tx = match request.code.as_deref().filter(|_| first_password) {
    Some(code) => {
      let (mut tx, row) =
        verification::consume(state, realm, Purpose::PasswordReset, &account.email, code).await?;
      if row.account_id.as_deref() != Some(account.id.as_str()) {
        tx.rollback().await?;
        return Err(HttpError::bad_request(
          CODE_INVALID,
          "That code is wrong or has expired. Ask for a new one.",
        ));
      }
      // The code proved the inbox, as a password reset does.
      accounts::mark_verified(&mut *tx, realm, &account.id).await?;
      tx
    }
    None => state.db.pool().begin().await?,
  };
  accounts::set_password(&mut *tx, realm, &account.id, &hash).await?;
  let ended = sessions::service::revoke_all(
    &mut tx,
    realm,
    &account.id,
    Some(session_id),
    "password_changed",
  )
  .await?;
  let actor_type = verification::actor_type_of(&mut *tx, realm, &account.id).await?;
  let action = format!("{}.password_changed", realm.resource());
  audit::service::record(
    &mut tx,
    audit::service::Event::account(realm, &account.id, &account.email, actor_type, &action)
      .metadata(serde_json::json!({ "otherSessionsEnded": ended })),
  )
  .await?;
  tx.commit().await?;
  let values =
    email_templates::service::base_values(state, &account.email, account.display_name.as_deref())
      .await?;
  email_templates::service::send(
    state,
    email_templates::Template::PasswordChanged,
    &account.email,
    values,
  )
  .await
}

/// Start an email change: a code goes to the new address. The account moves
/// once the code is confirmed.
pub async fn change_email(
  state: &AppState,
  realm: Realm,
  account_id: &str,
  request: ChangeEmailRequest,
) -> Result<(), HttpError> {
  let account = find_account(state, realm, account_id).await?;
  let new_email = validate::email(&request.new_email)?;
  if new_email == account.email {
    return Err(HttpError::new(
      StatusCode::UNPROCESSABLE_ENTITY,
      crate::constants::errors::EMAIL_INVALID,
      "That is already the email on this account.",
    ));
  }
  confirm_password(state, realm, &account, request.password).await?;
  if accounts::find_by_email(state.db.pool(), realm, &new_email)
    .await?
    .is_some()
  {
    return Err(HttpError::conflict(
      EMAIL_TAKEN,
      "Another account already uses this email.",
    ));
  }
  verification::check_send_limits(state, realm, Purpose::EmailChange, &new_email).await?;
  verification::issue(
    state,
    realm,
    Purpose::EmailChange,
    CodeTarget {
      email: &new_email,
      account_id: Some(&account.id),
      display_name: account.display_name.as_deref(),
      current_email: Some(&account.email),
    },
  )
  .await
}
