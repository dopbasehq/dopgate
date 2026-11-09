//! Console sign-in and the signed-in admin's account, built on the shared
//! account, session, and code functions with the console realm.

use super::model::*;
use crate::{
  constants::{
    errors::{ACCOUNT_DISABLED, CODE_INVALID, NOT_FOUND},
    tokens::CONSOLE_AUDIENCE,
  },
  extractors::ConsoleIdentity,
  http::HttpError,
  models::{Admin, ConsoleClaims, Realm},
  modules::{
    accounts::repository as accounts,
    admins::repository::{self as admins, AdminChanges},
    audit,
    auth::{self, model::LoginRequest},
    sessions::{self, model::SignInMethod, service::Grant},
    verification::service as verification,
  },
  services::{jwt, limits, otp::Purpose},
  state::AppState,
  utils::validate,
};

/// The console's access token and refresh token for a started or refreshed
/// session.
pub async fn console_tokens(
  state: &AppState,
  admin_id: &str,
  grant: Grant,
) -> Result<ConsoleTokens, HttpError> {
  let admin = admins::find_by_id(state.db.pool(), admin_id)
    .await?
    .ok_or_else(HttpError::internal)?;
  let now = chrono::Utc::now();
  let expires_in = i64::from(grant.access_minutes) * 60;
  let claims = ConsoleClaims {
    iss: state.config.issuer().to_owned(),
    aud: CONSOLE_AUDIENCE.to_owned(),
    sub: admin.id.clone(),
    exp: now.timestamp() + expires_in,
    iat: now.timestamp(),
    sid: grant.session_id,
    role: admin.role(),
    email: admin.email.clone(),
  };
  Ok(ConsoleTokens {
    access_token: jwt::sign_console(state, &claims).await?,
    token_type: "Bearer".into(),
    expires_in,
    refresh_token: Some(grant.refresh_token),
    admin: admin.to_admin(),
  })
}

async fn start(
  state: &AppState,
  account: &accounts::AccountRow,
  method: SignInMethod,
  user_agent: Option<&str>,
  tx: &mut sqlx::PgConnection,
) -> Result<Grant, HttpError> {
  let actor_type = verification::actor_type_of(tx, Realm::Console, &account.id).await?;
  sessions::service::start(
    state,
    tx,
    Realm::Console,
    account,
    &actor_type,
    method,
    user_agent,
  )
  .await
}

/// Sign an admin in with an email and password.
pub async fn login(
  state: &AppState,
  request: LoginRequest,
  user_agent: Option<&str>,
) -> Result<ConsoleTokens, HttpError> {
  let admin =
    auth::service::check_password(state, Realm::Console, &request.email, request.password).await?;
  let mut tx = state.db.pool().begin().await?;
  let grant = start(state, &admin, SignInMethod::Password, user_agent, &mut tx).await?;
  tx.commit().await?;
  console_tokens(state, &admin.id, grant).await
}

/// Email a sign-in code to an admin. The answer is the same whether or not
/// an admin uses the email.
pub async fn send_code(
  state: &AppState,
  request: ConsoleSendCodeRequest,
) -> Result<(), HttpError> {
  limits::per_address(state).await?;
  let email = validate::email(&request.email)?;
  verification::check_send_limits(state, Realm::Console, Purpose::Login, &email).await?;
  if let Some(admin) = accounts::find_by_email(state.db.pool(), Realm::Console, &email).await?
    && admin.is_active()
  {
    verification::issue(
      state,
      Realm::Console,
      Purpose::Login,
      verification::target_for(&admin),
    )
    .await?;
  }
  Ok(())
}

/// What confirming a console code returns.
pub enum Confirmed {
  SignedIn(ConsoleTokens),
  EmailChanged(Admin),
}

pub async fn confirm_code(
  state: &AppState,
  request: ConsoleConfirmCodeRequest,
  user_agent: Option<&str>,
) -> Result<Confirmed, HttpError> {
  limits::per_address(state).await?;
  let email = validate::email(&request.email)?;
  match request.purpose {
    ConsoleCodePurpose::Login => {
      let (mut tx, _row) =
        verification::consume(state, Realm::Console, Purpose::Login, &email, &request.code).await?;
      let admin = accounts::find_by_email(&mut *tx, Realm::Console, &email)
        .await?
        .ok_or_else(|| {
          HttpError::bad_request(
            CODE_INVALID,
            "That code is wrong or has expired. Ask for a new one.",
          )
        })?;
      if !admin.is_active() {
        return Err(HttpError::forbidden(
          ACCOUNT_DISABLED,
          "This account is disabled. Contact an administrator.",
        ));
      }
      accounts::mark_verified(&mut *tx, Realm::Console, &admin.id).await?;
      let grant = start(state, &admin, SignInMethod::Otp, user_agent, &mut tx).await?;
      tx.commit().await?;
      Ok(Confirmed::SignedIn(
        console_tokens(state, &admin.id, grant).await?,
      ))
    }
    ConsoleCodePurpose::EmailChange => {
      let admin_id =
        verification::confirm_email_change(state, Realm::Console, &email, &request.code).await?;
      Ok(Confirmed::EmailChanged(me_by_id(state, &admin_id).await?))
    }
  }
}

async fn me_by_id(
  state: &AppState,
  admin_id: &str,
) -> Result<Admin, HttpError> {
  Ok(
    admins::find_by_id(state.db.pool(), admin_id)
      .await?
      .ok_or_else(|| HttpError::not_found(NOT_FOUND, "This account no longer exists."))?
      .to_admin(),
  )
}

pub async fn me(
  state: &AppState,
  admin: &ConsoleIdentity,
) -> Result<Admin, HttpError> {
  me_by_id(state, &admin.admin_id).await
}

pub async fn update_me(
  state: &AppState,
  admin: &ConsoleIdentity,
  request: UpdateConsoleProfileRequest,
) -> Result<Admin, HttpError> {
  let changes = AdminChanges {
    display_name: validate::display_name(request.display_name)?,
    avatar_url: validate::avatar_url(request.avatar_url)?,
  };
  let mut tx = state.db.pool().begin().await?;
  let updated = admins::update_profile(&mut *tx, &admin.admin_id, &changes).await?;
  audit::service::record(
    &mut tx,
    audit::service::Event::account(
      Realm::Console,
      &updated.id,
      &updated.email,
      admin.role.as_str(),
      "admin.profile_updated",
    ),
  )
  .await?;
  tx.commit().await?;
  Ok(updated.to_admin())
}
