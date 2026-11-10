//! Sessions: one per sign-in on a device, for admins in the console and for
//! your app's users alike. A session issues short-lived access tokens and
//! single-use refresh tokens. Reusing a refresh token ends the session,
//! because it means someone copied it. The realm picks the tables, the
//! cookie, and the token the caller builds from the grant.

use axum::http::{HeaderValue, StatusCode, header::SET_COOKIE};
use chrono::{Duration, Utc};
use serde::Serialize;
use sqlx::PgConnection;

use super::{model::*, repository};
use crate::{
  constants::{
    api,
    errors::{ACCOUNT_DISABLED, NOT_FOUND, TOKEN_INVALID},
    tokens::{
      CONSOLE_REFRESH_COOKIE, REFRESH_COOKIE, REFRESH_TOKEN_ID_PREFIX, REFRESH_TOKEN_PREFIX,
      SESSION_ID_PREFIX,
    },
  },
  extractors::{RequestContext, SessionMode},
  http::{HttpError, HttpResponse},
  models::Realm,
  modules::{
    accounts::repository::{self as accounts, AccountRow},
    audit, settings,
  },
  services::{client_ip, token},
  state::AppState,
};

fn invalid_refresh() -> HttpError {
  HttpError::unauthorized(TOKEN_INVALID, "Your session has ended. Sign in again.")
}

fn disabled() -> HttpError {
  HttpError::forbidden(
    ACCOUNT_DISABLED,
    "This account is disabled. Contact an administrator.",
  )
}

/// A started or refreshed session. The caller turns it into the access
/// token its realm uses.
pub struct Grant {
  pub session_id: String,
  pub refresh_token: String,
  pub access_minutes: u32,
}

/// Start a session for an account that just proved who it is. Runs inside
/// the caller's transaction so the sign-in, the session, and its audit event
/// commit together. `actor_type` is what the audit log records: `user`, or
/// the admin's role.
pub async fn start(
  state: &AppState,
  tx: &mut PgConnection,
  realm: Realm,
  account: &AccountRow,
  actor_type: &str,
  method: SignInMethod,
  user_agent: Option<&str>,
) -> Result<Grant, HttpError> {
  let lifetimes = settings::service::tokens(state.db.pool()).await?;
  let now = Utc::now();
  let session_id = token::public_id(SESSION_ID_PREFIX);
  let idle = now + Duration::days(i64::from(lifetimes.refresh_token_idle_days));
  let absolute = now + Duration::days(i64::from(lifetimes.session_absolute_days));
  let ip_address = client_ip::current().map(|address| address.to_string());
  repository::insert(
    tx,
    realm,
    &repository::NewSession {
      id: &session_id,
      account_id: &account.id,
      method: method.as_str(),
      ip_address: ip_address.as_deref(),
      user_agent,
      idle_expires_at: idle,
      absolute_expires_at: absolute,
    },
  )
  .await?;
  let refresh_token = new_refresh_token(tx, realm, &session_id, idle.min(absolute)).await?;
  accounts::record_sign_in(&mut *tx, realm, &account.id).await?;
  let action = format!("{}.signed_in", realm.resource());
  audit::service::record(
    tx,
    audit::service::Event::account(realm, &account.id, &account.email, actor_type, &action)
      .metadata(serde_json::json!({ "method": method.as_str(), "sessionId": session_id })),
  )
  .await?;
  Ok(Grant {
    session_id,
    refresh_token,
    access_minutes: lifetimes.access_token_minutes,
  })
}

async fn new_refresh_token(
  tx: &mut PgConnection,
  realm: Realm,
  session_id: &str,
  expires_at: chrono::DateTime<Utc>,
) -> Result<String, HttpError> {
  let refresh_token = token::generate(REFRESH_TOKEN_PREFIX).map_err(|_| HttpError::internal())?;
  repository::insert_refresh_token(
    tx,
    realm,
    &token::public_id(REFRESH_TOKEN_ID_PREFIX),
    session_id,
    &token::hash(&refresh_token),
    expires_at,
  )
  .await?;
  Ok(refresh_token)
}

/// Trade a refresh token for a new one. Returns the account, so the caller
/// can build its access token.
pub async fn refresh(
  state: &AppState,
  realm: Realm,
  refresh_token: &str,
) -> Result<(AccountRow, Grant), HttpError> {
  let lifetimes = settings::service::tokens(state.db.pool()).await?;
  let mut tx = state.db.pool().begin().await?;
  let Some(found) =
    repository::find_refresh_token(&mut tx, realm, &token::hash(refresh_token)).await?
  else {
    return Err(invalid_refresh());
  };
  let now = Utc::now();
  if found.used_at.is_some() {
    if found.revoked_at.is_none() {
      repository::revoke(
        &mut *tx,
        realm,
        &found.session_id,
        &found.account_id,
        "refresh_token_reused",
      )
      .await?;
      audit::service::record(
        &mut tx,
        audit::service::Event::anonymous("refresh", "session.refresh_reused")
          .resource("session", Some(&found.session_id))
          .metadata(serde_json::json!({ "accountId": found.account_id })),
      )
      .await?;
      tx.commit().await?;
    }
    return Err(invalid_refresh());
  }
  if found.revoked_at.is_some() || found.expires_at <= now || found.absolute_expires_at <= now {
    return Err(invalid_refresh());
  }
  let account = accounts::find_by_id(&mut *tx, realm, &found.account_id)
    .await?
    .ok_or_else(invalid_refresh)?;
  if !account.is_active() {
    return Err(disabled());
  }
  repository::mark_used(&mut tx, realm, &found.token_id).await?;
  let idle = (now + Duration::days(i64::from(lifetimes.refresh_token_idle_days)))
    .min(found.absolute_expires_at);
  repository::touch(&mut tx, realm, &found.session_id, idle).await?;
  let refresh_token = new_refresh_token(&mut tx, realm, &found.session_id, idle).await?;
  tx.commit().await?;
  Ok((
    account,
    Grant {
      session_id: found.session_id,
      refresh_token,
      access_minutes: lifetimes.access_token_minutes,
    },
  ))
}

/// A sign-in response whose refresh token can move into a cookie.
pub trait CarriesRefresh {
  fn take_refresh_token(&mut self) -> Option<String>;
}

/// The response for a sign-in or refresh. In cookie mode the refresh token
/// moves into an HttpOnly cookie and leaves the body.
pub async fn deliver<T: CarriesRefresh + Serialize>(
  state: &AppState,
  context: &RequestContext,
  realm: Realm,
  mut tokens: T,
  message: &str,
  status: StatusCode,
) -> Result<HttpResponse<T>, HttpError> {
  if context.session_mode == SessionMode::Body {
    return Ok(HttpResponse::new(message, status, Some(tokens)));
  }
  let lifetimes = settings::service::tokens(state.db.pool()).await?;
  let max_age = i64::from(lifetimes.refresh_token_idle_days) * 24 * 60 * 60;
  let value = tokens.take_refresh_token().unwrap_or_default();
  let cookie = cookie(state, realm, &value, max_age);
  Ok(HttpResponse::new(message, status, Some(tokens)).with_header(SET_COOKIE, cookie))
}

/// The header that removes a refresh cookie.
pub fn clear_cookie(
  state: &AppState,
  realm: Realm,
) -> (axum::http::HeaderName, HeaderValue) {
  (SET_COOKIE, cookie(state, realm, "", 0))
}

fn cookie(
  state: &AppState,
  realm: Realm,
  value: &str,
  max_age: i64,
) -> HeaderValue {
  let secure = if state.config.public_url_is_https() {
    "; Secure"
  } else {
    ""
  };
  let (name, path) = match realm {
    Realm::Console => (CONSOLE_REFRESH_COOKIE, api::console::COOKIE_PATH),
    Realm::App => (REFRESH_COOKIE, api::auth::COOKIE_PATH),
  };
  HeaderValue::from_str(&format!(
    "{name}={value}; HttpOnly; SameSite=Strict; Path={path}; Max-Age={max_age}{secure}"
  ))
  .unwrap_or_else(|_| HeaderValue::from_static(""))
}

pub async fn list(
  state: &AppState,
  realm: Realm,
  account_id: &str,
  current: Option<&str>,
) -> Result<Vec<SessionResponse>, HttpError> {
  Ok(repository::list_active(state.db.pool(), realm, account_id, current).await?)
}

/// End one of the caller's sessions.
pub async fn revoke_own(
  state: &AppState,
  realm: Realm,
  account_id: &str,
  email: &str,
  actor_type: &str,
  session_id: &str,
) -> Result<(), HttpError> {
  let mut tx = state.db.pool().begin().await?;
  if !repository::revoke(&mut *tx, realm, session_id, account_id, "signed_out").await? {
    return Err(HttpError::not_found(
      NOT_FOUND,
      "No such session on this account.",
    ));
  }
  audit::service::record(
    &mut tx,
    audit::service::Event::account(realm, account_id, email, actor_type, "session.revoked")
      .resource("session", Some(session_id)),
  )
  .await?;
  tx.commit().await?;
  Ok(())
}

/// End every session of an account, optionally keeping one.
pub async fn revoke_all(
  tx: &mut PgConnection,
  realm: Realm,
  account_id: &str,
  keep: Option<&str>,
  reason: &str,
) -> Result<u64, HttpError> {
  Ok(repository::revoke_all(tx, realm, account_id, keep, reason).await?)
}

/// End the session of a signed-in account.
pub async fn revoke_current(
  tx: &mut PgConnection,
  realm: Realm,
  account_id: &str,
  session_id: &str,
) -> Result<(), HttpError> {
  repository::revoke(tx, realm, session_id, account_id, "signed_out").await?;
  Ok(())
}

/// Look up the session a refresh token belongs to, without using it.
/// Returns the session ID and the account ID.
pub async fn session_of_refresh_token(
  state: &AppState,
  realm: Realm,
  refresh_token: &str,
) -> Result<Option<(String, String)>, HttpError> {
  Ok(
    repository::session_of_refresh_token(state.db.pool(), realm, &token::hash(refresh_token))
      .await?,
  )
}
