//! Sessions: one per sign-in on a device. A session issues short-lived
//! access tokens and single-use refresh tokens. Reusing a refresh token ends
//! the session, because it means someone copied it.

use axum::http::{HeaderValue, StatusCode, header::SET_COOKIE};
use chrono::{Duration, Utc};
use sqlx::PgConnection;

use super::{model::*, repository};
use crate::{
  constants::{
    api,
    errors::{ACCOUNT_DISABLED, NOT_FOUND, TOKEN_INVALID},
    tokens::{REFRESH_COOKIE, REFRESH_TOKEN_ID_PREFIX, REFRESH_TOKEN_PREFIX, SESSION_ID_PREFIX},
  },
  extractors::{RequestContext, SessionMode},
  http::{HttpError, HttpResponse},
  models::AccessClaims,
  modules::{
    audit,
    auth::model::AuthTokens,
    settings,
    users::repository::{self as users, UserRow},
  },
  services::{client_ip, jwt, token},
  state::AppState,
};

fn invalid_refresh() -> HttpError {
  HttpError::unauthorized(TOKEN_INVALID, "Your session has ended. Sign in again.")
}

/// Start a session for a user who just proved who they are, and sign them
/// in. Runs inside the caller's transaction so the sign-in, the session,
/// and its audit event commit together.
pub async fn start(
  state: &AppState,
  tx: &mut PgConnection,
  user: &UserRow,
  method: SignInMethod,
  user_agent: Option<&str>,
) -> Result<AuthTokens, HttpError> {
  let lifetimes = settings::service::tokens(state.db.pool()).await?;
  let now = Utc::now();
  let session_id = token::public_id(SESSION_ID_PREFIX);
  let idle = now + Duration::days(i64::from(lifetimes.refresh_token_idle_days));
  let absolute = now + Duration::days(i64::from(lifetimes.session_absolute_days));
  let ip_address = client_ip::current().map(|address| address.to_string());
  repository::insert(
    tx,
    &repository::NewSession {
      id: &session_id,
      user_id: &user.id,
      method: method.as_str(),
      ip_address: ip_address.as_deref(),
      user_agent,
      idle_expires_at: idle,
      absolute_expires_at: absolute,
    },
  )
  .await?;
  let refresh_token = new_refresh_token(tx, &session_id, idle.min(absolute)).await?;
  users::record_sign_in(&mut *tx, &user.id).await?;
  audit::service::record(
    tx,
    audit::service::Event::user(&user.id, &user.email, &user.role, "user.signed_in")
      .metadata(serde_json::json!({ "method": method.as_str(), "sessionId": session_id })),
  )
  .await?;
  let user = users::find_by_id(&mut *tx, &user.id)
    .await?
    .ok_or_else(HttpError::internal)?;
  issue(
    state,
    &user,
    &session_id,
    refresh_token,
    lifetimes.access_token_minutes,
  )
  .await
}

async fn new_refresh_token(
  tx: &mut PgConnection,
  session_id: &str,
  expires_at: chrono::DateTime<Utc>,
) -> Result<String, HttpError> {
  let refresh_token = token::generate(REFRESH_TOKEN_PREFIX).map_err(|_| HttpError::internal())?;
  repository::insert_refresh_token(
    tx,
    &token::public_id(REFRESH_TOKEN_ID_PREFIX),
    session_id,
    &token::hash(&refresh_token),
    expires_at,
  )
  .await?;
  Ok(refresh_token)
}

async fn issue(
  state: &AppState,
  user: &UserRow,
  session_id: &str,
  refresh_token: String,
  access_minutes: u32,
) -> Result<AuthTokens, HttpError> {
  let now = Utc::now();
  let expires_in = i64::from(access_minutes) * 60;
  let claims = AccessClaims {
    iss: state.config.issuer().to_owned(),
    sub: user.id.clone(),
    exp: now.timestamp() + expires_in,
    iat: now.timestamp(),
    sid: session_id.to_owned(),
    email: user.email.clone(),
    email_verified: user.is_verified(),
    role: user.role(),
  };
  Ok(AuthTokens {
    access_token: jwt::sign(state, &claims).await?,
    token_type: "Bearer".into(),
    expires_in,
    refresh_token: Some(refresh_token),
    user: user.to_user(),
  })
}

/// Trade a refresh token for new tokens.
pub async fn refresh(
  state: &AppState,
  refresh_token: &str,
) -> Result<AuthTokens, HttpError> {
  let lifetimes = settings::service::tokens(state.db.pool()).await?;
  let mut tx = state.db.pool().begin().await?;
  let Some(found) = repository::find_refresh_token(&mut tx, &token::hash(refresh_token)).await?
  else {
    return Err(invalid_refresh());
  };
  let now = Utc::now();
  if found.used_at.is_some() {
    if found.revoked_at.is_none() {
      repository::revoke(
        &mut *tx,
        &found.session_id,
        &found.user_id,
        "refresh_token_reused",
      )
      .await?;
      audit::service::record(
        &mut tx,
        audit::service::Event::anonymous("refresh", "session.refresh_reused")
          .resource("session", Some(&found.session_id))
          .metadata(serde_json::json!({ "userId": found.user_id })),
      )
      .await?;
      tx.commit().await?;
    }
    return Err(invalid_refresh());
  }
  if found.revoked_at.is_some() || found.expires_at <= now || found.absolute_expires_at <= now {
    return Err(invalid_refresh());
  }
  let user = users::find_by_id(&mut *tx, &found.user_id)
    .await?
    .ok_or_else(invalid_refresh)?;
  if !user.is_active() {
    return Err(HttpError::forbidden(
      ACCOUNT_DISABLED,
      "This account is disabled. Contact an administrator.",
    ));
  }
  repository::mark_used(&mut tx, &found.token_id).await?;
  let idle = (now + Duration::days(i64::from(lifetimes.refresh_token_idle_days)))
    .min(found.absolute_expires_at);
  repository::touch(&mut tx, &found.session_id, idle).await?;
  let refresh_token = new_refresh_token(&mut tx, &found.session_id, idle).await?;
  tx.commit().await?;
  issue(
    state,
    &user,
    &found.session_id,
    refresh_token,
    lifetimes.access_token_minutes,
  )
  .await
}

/// The response for a sign-in or refresh. In cookie mode the refresh token
/// moves into an HttpOnly cookie and leaves the body.
pub async fn deliver(
  state: &AppState,
  context: &RequestContext,
  mut tokens: AuthTokens,
  message: &str,
  status: StatusCode,
) -> Result<HttpResponse<AuthTokens>, HttpError> {
  if context.session_mode == SessionMode::Body {
    return Ok(HttpResponse::new(message, status, Some(tokens)));
  }
  let lifetimes = settings::service::tokens(state.db.pool()).await?;
  let max_age = i64::from(lifetimes.refresh_token_idle_days) * 24 * 60 * 60;
  let value = tokens.refresh_token.take().unwrap_or_default();
  let cookie = cookie(state, &value, max_age);
  Ok(HttpResponse::new(message, status, Some(tokens)).with_header(SET_COOKIE, cookie))
}

/// The header that removes the console's refresh cookie.
pub fn clear_cookie(state: &AppState) -> (axum::http::HeaderName, HeaderValue) {
  (SET_COOKIE, cookie(state, "", 0))
}

fn cookie(
  state: &AppState,
  value: &str,
  max_age: i64,
) -> HeaderValue {
  let secure = if state.config.public_url_is_https() {
    "; Secure"
  } else {
    ""
  };
  HeaderValue::from_str(&format!(
    "{REFRESH_COOKIE}={value}; HttpOnly; SameSite=Strict; Path={}; Max-Age={max_age}{secure}",
    api::auth::COOKIE_PATH
  ))
  .unwrap_or_else(|_| HeaderValue::from_static(""))
}

pub async fn list(
  state: &AppState,
  user_id: &str,
  current: Option<&str>,
) -> Result<Vec<SessionResponse>, HttpError> {
  Ok(repository::list_active(state.db.pool(), user_id, current).await?)
}

/// End one of the caller's sessions.
pub async fn revoke_own(
  state: &AppState,
  user_id: &str,
  email: &str,
  role: &str,
  session_id: &str,
) -> Result<(), HttpError> {
  let mut tx = state.db.pool().begin().await?;
  if !repository::revoke(&mut *tx, session_id, user_id, "signed_out").await? {
    return Err(HttpError::not_found(
      NOT_FOUND,
      "No such session on this account.",
    ));
  }
  audit::service::record(
    &mut tx,
    audit::service::Event::user(user_id, email, role, "session.revoked")
      .resource("session", Some(session_id)),
  )
  .await?;
  tx.commit().await?;
  Ok(())
}

/// End every session of a user, optionally keeping one.
pub async fn revoke_all(
  tx: &mut PgConnection,
  user_id: &str,
  keep: Option<&str>,
  reason: &str,
) -> Result<u64, HttpError> {
  Ok(repository::revoke_all(tx, user_id, keep, reason).await?)
}

/// End the session of a signed-in user.
pub async fn revoke_current(
  tx: &mut PgConnection,
  user_id: &str,
  session_id: &str,
) -> Result<(), HttpError> {
  repository::revoke(tx, session_id, user_id, "signed_out").await?;
  Ok(())
}

/// Look up the session a refresh token belongs to, without using it.
pub async fn session_of_refresh_token(
  state: &AppState,
  refresh_token: &str,
) -> Result<Option<(String, String)>, HttpError> {
  Ok(
    sqlx::query_as(
      "SELECT s.id, s.user_id FROM refresh_tokens r JOIN sessions s ON s.id = r.session_id WHERE r.token_hash = $1",
    )
    .bind(token::hash(refresh_token))
    .fetch_optional(state.db.pool())
    .await?,
  )
}
