//! Emailed codes: sending them, and confirming them for email verification,
//! sign-in without a password, and email changes. Password resets use the
//! same codes through the recovery module.

use std::time::Duration;

use axum::http::StatusCode;
use chrono::Utc;
use sqlx::{PgConnection, Postgres, Transaction};

use super::{model::*, repository};
use crate::{
  constants::{
    errors::{ACCOUNT_DISABLED, CODE_EXPIRED, CODE_INVALID, EMAIL_TAKEN, REQUEST_INVALID},
    tokens::{USER_ID_PREFIX, VERIFICATION_ID_PREFIX},
  },
  http::HttpError,
  models::{Role, User},
  modules::{
    audit,
    auth::model::AuthTokens,
    email_templates,
    sessions::{self, model::SignInMethod},
    settings,
    users::repository::{self as users, UserRow},
  },
  services::{client_ip, otp, token},
  state::AppState,
  utils::validate,
};

/// Who a code is for.
pub struct CodeTarget<'a> {
  /// Where the code goes.
  pub email: &'a str,
  pub user_id: Option<&'a str>,
  pub display_name: Option<&'a str>,
  /// For email changes: the account's current address, for the message.
  pub current_email: Option<&'a str>,
}

/// The per-email limits on sending codes: a short wait between codes of the
/// same kind, and a cap per hour. They apply whether or not the email has an
/// account, so the answer never tells the two apart.
pub async fn check_send_limits(
  state: &AppState,
  purpose: Purpose,
  email: &str,
) -> Result<(), HttpError> {
  let config = settings::service::limits(state.db.pool()).await?;
  if config.code_resend_seconds > 0 {
    let key = format!("code:resend:{}:{email}", purpose.as_str());
    state
      .limits
      .hit(
        &key,
        1,
        Duration::from_secs(u64::from(config.code_resend_seconds)),
      )
      .await
      .map_err(|limited| HttpError::rate_limited(limited.retry_after))?;
  }
  state
    .limits
    .hit(
      &format!("code:hour:{email}"),
      config.codes_per_hour,
      Duration::from_secs(3600),
    )
    .await
    .map_err(|limited| HttpError::rate_limited(limited.retry_after))
}

/// Create a code, replacing any earlier one, and email it.
pub async fn issue(
  state: &AppState,
  purpose: Purpose,
  target: CodeTarget<'_>,
) -> Result<(), HttpError> {
  let config = settings::service::limits(state.db.pool()).await?;
  let code = otp::generate_code();
  let ip_address = client_ip::current().map(|address| address.to_string());
  let mut tx = state.db.pool().begin().await?;
  repository::replace(
    &mut tx,
    &repository::NewCode {
      id: &token::public_id(VERIFICATION_ID_PREFIX),
      user_id: target.user_id,
      email: target.email,
      purpose: purpose.as_str(),
      secret_hash: &token::hash(&code),
      new_email: (purpose == Purpose::EmailChange).then_some(target.email),
      ip_address: ip_address.as_deref(),
      expires_at: Utc::now() + chrono::Duration::minutes(i64::from(config.code_minutes)),
    },
  )
  .await?;
  tx.commit().await?;
  let mut values = email_templates::service::base_values(
    state,
    target.current_email.unwrap_or(target.email),
    target.display_name,
  )
  .await?;
  values.insert("code", code);
  values.insert("expires_minutes", config.code_minutes.to_string());
  values.insert("new_email", target.email.to_owned());
  email_templates::service::send(state, purpose.template(), target.email, values).await
}

/// Check a code. On success the code is marked used inside the returned
/// transaction, which the caller commits with the rest of its change. A
/// wrong guess is counted and committed before the error returns.
pub async fn consume(
  state: &AppState,
  purpose: Purpose,
  email: &str,
  code: &str,
) -> Result<(Transaction<'static, Postgres>, repository::CodeRow), HttpError> {
  let config = settings::service::limits(state.db.pool()).await?;
  let mut tx = state.db.pool().begin().await?;
  let Some(row) = repository::latest(&mut tx, email, purpose.as_str()).await? else {
    tx.rollback().await?;
    return Err(HttpError::bad_request(
      CODE_INVALID,
      "That code is wrong or has expired. Ask for a new one.",
    ));
  };
  if row.expires_at <= Utc::now() {
    tx.rollback().await?;
    return Err(HttpError::bad_request(
      CODE_EXPIRED,
      "That code has expired. Ask for a new one.",
    ));
  }
  let max_attempts = i32::try_from(config.code_max_attempts).unwrap_or(i32::MAX);
  if row.attempts >= max_attempts {
    tx.rollback().await?;
    return Err(used_up());
  }
  let code = otp::normalize_code(code);
  let matches: bool =
    subtle::ConstantTimeEq::ct_eq(token::hash(&code).as_slice(), row.secret_hash.as_slice()).into();
  if !matches {
    repository::count_attempt(&mut tx, &row.id).await?;
    let left = max_attempts - row.attempts - 1;
    if left <= 0 {
      repository::consume(&mut tx, &row.id).await?;
    }
    tx.commit().await?;
    return Err(if left <= 0 {
      used_up()
    } else {
      HttpError::bad_request(
        CODE_INVALID,
        &format!(
          "That code is wrong. {left} {} left.",
          if left == 1 { "try" } else { "tries" }
        ),
      )
    });
  }
  repository::consume(&mut tx, &row.id).await?;
  Ok((tx, row))
}

fn used_up() -> HttpError {
  HttpError::bad_request(
    CODE_INVALID,
    "That code is used up after too many wrong tries. Ask for a new one.",
  )
}

fn disabled() -> HttpError {
  HttpError::forbidden(
    ACCOUNT_DISABLED,
    "This account is disabled. Contact an administrator.",
  )
}

/// `POST /auth/verification/send`. The answer is the same whether or not
/// the email has an account.
pub async fn send(
  state: &AppState,
  request: SendCodeRequest,
) -> Result<(), HttpError> {
  let email = validate::email(&request.email)?;
  if !matches!(request.purpose, Purpose::EmailVerify | Purpose::Login) {
    return Err(HttpError::new(
      StatusCode::UNPROCESSABLE_ENTITY,
      REQUEST_INVALID,
      "Use /auth/password/forgot for password resets and /auth/email/change for email changes.",
    ));
  }
  check_send_limits(state, request.purpose, &email).await?;
  let user = users::find_by_email(state.db.pool(), &email).await?;
  match (request.purpose, user) {
    (Purpose::EmailVerify, Some(user)) if user.is_active() && !user.is_verified() => {
      issue(state, request.purpose, target_for(&user)).await?;
    }
    (Purpose::Login, Some(user)) if user.is_active() => {
      issue(state, request.purpose, target_for(&user)).await?;
    }
    (Purpose::Login, None) => {
      let signup = settings::service::signup(state.db.pool()).await?;
      if signup.enabled && signup.passwordless_signup {
        issue(
          state,
          request.purpose,
          CodeTarget {
            email: &email,
            user_id: None,
            display_name: None,
            current_email: None,
          },
        )
        .await?;
      }
    }
    _ => {}
  }
  Ok(())
}

fn target_for(user: &UserRow) -> CodeTarget<'_> {
  CodeTarget {
    email: &user.email,
    user_id: Some(&user.id),
    display_name: user.display_name.as_deref(),
    current_email: None,
  }
}

/// What confirming a code returns.
pub enum Confirmed {
  /// Email verification and sign-in: the user is signed in.
  SignedIn(AuthTokens),
  /// Email change: the updated account.
  EmailChanged(User),
}

/// `POST /auth/verification/confirm`.
pub async fn confirm(
  state: &AppState,
  request: ConfirmCodeRequest,
  user_agent: Option<&str>,
) -> Result<Confirmed, HttpError> {
  let email = validate::email(&request.email)?;
  match request.purpose {
    Purpose::EmailVerify | Purpose::Login => {
      let (mut tx, _row) = consume(state, request.purpose, &email, &request.code).await?;
      let user = match users::find_by_email(&mut *tx, &email).await? {
        Some(user) => user,
        None if request.purpose == Purpose::Login => {
          create_passwordless(state, &mut tx, &email).await?
        }
        None => {
          return Err(HttpError::bad_request(
            CODE_INVALID,
            "That code is wrong or has expired. Ask for a new one.",
          ));
        }
      };
      if !user.is_active() {
        return Err(disabled());
      }
      if !user.is_verified() {
        users::mark_verified(&mut *tx, &user.id).await?;
        audit::service::record(
          &mut tx,
          audit::service::Event::user(&user.id, &user.email, &user.role, "user.email_verified"),
        )
        .await?;
      }
      let tokens =
        sessions::service::start(state, &mut tx, &user, SignInMethod::Otp, user_agent).await?;
      tx.commit().await?;
      Ok(Confirmed::SignedIn(tokens))
    }
    Purpose::EmailChange => {
      let (mut tx, row) = consume(state, request.purpose, &email, &request.code).await?;
      let user_id = row.user_id.ok_or_else(HttpError::internal)?;
      let user = users::find_by_id_for_update(&mut tx, &user_id)
        .await?
        .ok_or_else(|| {
          HttpError::bad_request(
            CODE_INVALID,
            "That code is wrong or has expired. Ask for a new one.",
          )
        })?;
      if !user.is_active() {
        return Err(disabled());
      }
      let new_email = row.new_email.unwrap_or(row.email);
      let updated = match users::set_email(&mut *tx, &user.id, &new_email).await {
        Ok(updated) => updated,
        Err(error) if users::is_email_taken(&error) => {
          return Err(HttpError::conflict(
            EMAIL_TAKEN,
            "Another account already uses this email.",
          ));
        }
        Err(error) => return Err(error.into()),
      };
      audit::service::record(
        &mut tx,
        audit::service::Event::user(&user.id, &new_email, &user.role, "user.email_changed")
          .metadata(serde_json::json!({ "from": user.email, "to": new_email })),
      )
      .await?;
      tx.commit().await?;
      let mut values =
        email_templates::service::base_values(state, &user.email, user.display_name.as_deref())
          .await?;
      values.insert("new_email", new_email.clone());
      email_templates::service::send(state, "email_changed", &user.email, values).await?;
      Ok(Confirmed::EmailChanged(updated.to_user()))
    }
    Purpose::PasswordReset => Err(HttpError::new(
      StatusCode::UNPROCESSABLE_ENTITY,
      REQUEST_INVALID,
      "Reset a password with /auth/password/reset.",
    )),
  }
}

/// A member account for a first sign-in by code, when settings allow it.
async fn create_passwordless(
  state: &AppState,
  tx: &mut PgConnection,
  email: &str,
) -> Result<UserRow, HttpError> {
  let signup = settings::service::signup(state.db.pool()).await?;
  if !(signup.enabled && signup.passwordless_signup) {
    return Err(HttpError::bad_request(
      CODE_INVALID,
      "That code is wrong or has expired. Ask for a new one.",
    ));
  }
  let id = token::public_id(USER_ID_PREFIX);
  let empty = serde_json::json!({});
  let user = users::insert(
    tx,
    &users::NewUser {
      id: &id,
      email,
      password_hash: None,
      display_name: None,
      role: Role::Member,
      email_verified: true,
      public_metadata: &empty,
      private_metadata: &empty,
    },
  )
  .await?;
  audit::service::record(
    tx,
    audit::service::Event::user(&user.id, &user.email, &user.role, "user.signed_up")
      .metadata(serde_json::json!({ "method": "otp" })),
  )
  .await?;
  Ok(user)
}
