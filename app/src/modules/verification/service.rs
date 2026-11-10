//! Emailed codes: sending them, and confirming them for email verification,
//! sign-in without a password, and email changes. Password resets use the
//! same codes through the recovery module, and the console uses them for
//! admins. `issue` and `consume` take the realm; `send` and `confirm` are the
//! app's endpoints.

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
  models::{Realm, User},
  modules::{
    accounts::repository::{self as accounts, AccountRow},
    audit,
    auth::model::AuthTokens,
    email_templates,
    sessions::{self, model::SignInMethod},
    settings,
    users::repository as users,
  },
  services::{client_ip, limits, otp, token},
  state::AppState,
  utils::validate,
};

/// Who a code is for.
pub struct CodeTarget<'a> {
  /// Where the code goes.
  pub email: &'a str,
  pub account_id: Option<&'a str>,
  pub display_name: Option<&'a str>,
  /// For email changes: the account's current address, for the message.
  pub current_email: Option<&'a str>,
}

/// The per-email limits on sending codes: a short wait between codes of the
/// same kind, and a cap per hour. They apply whether or not the email has an
/// account, so the answer never tells the two apart.
pub async fn check_send_limits(
  state: &AppState,
  realm: Realm,
  purpose: Purpose,
  email: &str,
) -> Result<(), HttpError> {
  let config = settings::service::limits(state.db.pool()).await?;
  if config.code_resend_seconds > 0 {
    let key = format!("code:resend:{}:{}:{email}", realm.key(), purpose.as_str());
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
      &format!("code:hour:{}:{email}", realm.key()),
      config.codes_per_hour,
      Duration::from_secs(3600),
    )
    .await
    .map_err(|limited| HttpError::rate_limited(limited.retry_after))
}

/// Create a code, replacing any earlier one, and email it.
pub async fn issue(
  state: &AppState,
  realm: Realm,
  purpose: Purpose,
  target: CodeTarget<'_>,
) -> Result<(), HttpError> {
  let config = settings::service::limits(state.db.pool()).await?;
  let code = otp::generate_code();
  let ip_address = client_ip::current().map(|address| address.to_string());
  let mut tx = state.db.pool().begin().await?;
  repository::replace(
    &mut tx,
    realm,
    &repository::NewCode {
      id: &token::public_id(VERIFICATION_ID_PREFIX),
      account_id: target.account_id,
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
  realm: Realm,
  purpose: Purpose,
  email: &str,
  code: &str,
) -> Result<(Transaction<'static, Postgres>, repository::CodeRow), HttpError> {
  let config = settings::service::limits(state.db.pool()).await?;
  let mut tx = state.db.pool().begin().await?;
  let Some(row) = repository::latest(&mut tx, realm, email, purpose.as_str()).await? else {
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
    repository::count_attempt(&mut tx, realm, &row.id).await?;
    let left = max_attempts - row.attempts - 1;
    if left <= 0 {
      repository::consume(&mut tx, realm, &row.id).await?;
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
  repository::consume(&mut tx, realm, &row.id).await?;
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
  limits::per_address(state).await?;
  let email = validate::email(&request.email)?;
  if !matches!(request.purpose, Purpose::EmailVerify | Purpose::Login) {
    return Err(HttpError::new(
      StatusCode::UNPROCESSABLE_ENTITY,
      REQUEST_INVALID,
      "Use /auth/password/forgot for password resets and /auth/email/change for email changes.",
    ));
  }
  check_send_limits(state, Realm::App, request.purpose, &email).await?;
  let user = accounts::find_by_email(state.db.pool(), Realm::App, &email).await?;
  match (request.purpose, user) {
    (Purpose::EmailVerify, Some(user)) if user.is_active() && !user.is_verified() => {
      issue(state, Realm::App, request.purpose, target_for(&user)).await?;
    }
    (Purpose::Login, Some(user)) if user.is_active() => {
      issue(state, Realm::App, request.purpose, target_for(&user)).await?;
    }
    (Purpose::Login, None) => {
      let signup = settings::service::signup(state.db.pool()).await?;
      if signup.enabled && signup.passwordless_signup {
        issue(
          state,
          Realm::App,
          request.purpose,
          CodeTarget {
            email: &email,
            account_id: None,
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

pub fn target_for(account: &AccountRow) -> CodeTarget<'_> {
  CodeTarget {
    email: &account.email,
    account_id: Some(&account.id),
    display_name: account.display_name.as_deref(),
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
  limits::per_address(state).await?;
  let email = validate::email(&request.email)?;
  match request.purpose {
    Purpose::EmailVerify | Purpose::Login => {
      let (mut tx, _row) =
        consume(state, Realm::App, request.purpose, &email, &request.code).await?;
      let user = match accounts::find_by_email(&mut *tx, Realm::App, &email).await? {
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
        accounts::mark_verified(&mut *tx, Realm::App, &user.id).await?;
        audit::service::record(
          &mut tx,
          audit::service::Event::user(&user.id, &user.email, "user.email_verified"),
        )
        .await?;
      }
      let grant = sessions::service::start(
        state,
        &mut tx,
        Realm::App,
        &user,
        "user",
        SignInMethod::Otp,
        user_agent,
      )
      .await?;
      tx.commit().await?;
      Ok(Confirmed::SignedIn(
        crate::modules::auth::service::app_tokens(state, &user.id, grant).await?,
      ))
    }
    Purpose::EmailChange => {
      let user_id = confirm_email_change(state, Realm::App, &email, &request.code).await?;
      let user = users::find_by_id(state.db.pool(), &user_id)
        .await?
        .ok_or_else(HttpError::internal)?;
      Ok(Confirmed::EmailChanged(user.to_user()))
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
) -> Result<AccountRow, HttpError> {
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
      email_verified: true,
      public_metadata: &empty,
      private_metadata: &empty,
    },
  )
  .await?;
  audit::service::record(
    tx,
    audit::service::Event::user(&user.id, &user.email, "user.signed_up")
      .metadata(serde_json::json!({ "method": "otp" })),
  )
  .await?;
  accounts::find_by_id(&mut *tx, Realm::App, &user.id)
    .await?
    .ok_or_else(HttpError::internal)
}

/// Move an admin or a user to the address an email-change code was sent
/// to. Returns the account ID. A notice goes to the old address.
pub async fn confirm_email_change(
  state: &AppState,
  realm: Realm,
  email: &str,
  code: &str,
) -> Result<String, HttpError> {
  let (mut tx, row) = consume(state, realm, Purpose::EmailChange, email, code).await?;
  let account_id = row.account_id.ok_or_else(HttpError::internal)?;
  let account = accounts::find_by_id_for_update(&mut tx, realm, &account_id)
    .await?
    .ok_or_else(|| {
      HttpError::bad_request(
        CODE_INVALID,
        "That code is wrong or has expired. Ask for a new one.",
      )
    })?;
  if !account.is_active() {
    return Err(disabled());
  }
  let new_email = row.new_email.unwrap_or(row.email);
  match accounts::set_email(&mut *tx, realm, &account.id, &new_email).await {
    Ok(()) => {}
    Err(error) if accounts::is_email_taken(&error) => {
      return Err(HttpError::conflict(
        EMAIL_TAKEN,
        "Another account already uses this email.",
      ));
    }
    Err(error) => return Err(error.into()),
  }
  let actor_type = actor_type_of(&mut tx, realm, &account.id).await?;
  let action = format!("{}.email_changed", realm.resource());
  audit::service::record(
    &mut tx,
    audit::service::Event::account(realm, &account.id, &new_email, &actor_type, &action)
      .metadata(serde_json::json!({ "from": account.email, "to": new_email })),
  )
  .await?;
  tx.commit().await?;
  let mut values =
    email_templates::service::base_values(state, &account.email, account.display_name.as_deref())
      .await?;
  values.insert("new_email", new_email.clone());
  email_templates::service::send(state, "email_changed", &account.email, values).await?;
  Ok(account.id)
}

/// What the audit log calls an account: `user`, or the admin's role.
pub async fn actor_type_of(
  connection: &mut PgConnection,
  realm: Realm,
  account_id: &str,
) -> Result<String, HttpError> {
  Ok(match realm {
    Realm::App => "user".to_owned(),
    Realm::Console => crate::modules::admins::repository::find_by_id(&mut *connection, account_id)
      .await?
      .map_or_else(
        || "admin".to_owned(),
        |admin| admin.role().as_str().to_owned(),
      ),
  })
}
