//! Trading a personal token for an access token.

use chrono::Utc;

use super::model::*;
use crate::{
  constants::{
    errors::{ACCOUNT_DISABLED, TOKEN_EXPIRED, TOKEN_INVALID},
    tokens::PERSONAL_TOKEN_PREFIX,
  },
  http::HttpError,
  models::{AccessClaims, TokenKind},
  modules::{audit, personal_tokens::repository as personal_tokens, settings, users},
  services::{jwt, limits, token},
  state::AppState,
};

fn rejected() -> HttpError {
  HttpError::unauthorized(TOKEN_INVALID, "The token is wrong or was revoked.")
}

/// Record a token that matched nothing. Only the prefix and the last four
/// characters are kept, never the token.
async fn record_rejection(
  state: &AppState,
  kind: &str,
  presented: &str,
) {
  let last_four: String = presented
    .chars()
    .rev()
    .take(4)
    .collect::<Vec<_>>()
    .into_iter()
    .rev()
    .collect();
  audit::service::record_now(
    state.db.pool(),
    audit::service::Event::anonymous("token", "token.rejected")
      .metadata(serde_json::json!({ "kind": kind, "lastFour": last_four })),
  )
  .await;
}

pub async fn trade(
  state: &AppState,
  request: TradeTokenRequest,
) -> Result<TradedToken, HttpError> {
  limits::per_address(state).await?;
  let presented = request.token.trim();
  if presented.starts_with(PERSONAL_TOKEN_PREFIX) {
    return personal(state, presented).await;
  }
  record_rejection(state, "unknown", presented).await;
  Err(rejected())
}

async fn personal(
  state: &AppState,
  presented: &str,
) -> Result<TradedToken, HttpError> {
  let pool = state.db.pool();
  let Some(row) = personal_tokens::find_by_hash(pool, &token::hash(presented)).await? else {
    record_rejection(state, "personal", presented).await;
    return Err(rejected());
  };
  if row.is_expired() {
    return Err(HttpError::unauthorized(
      TOKEN_EXPIRED,
      "This personal token has expired. Make a new one.",
    ));
  }
  let user = users::repository::find_by_id(pool, &row.user_id)
    .await?
    .ok_or_else(rejected)?;
  if !user.is_active() {
    return Err(HttpError::forbidden(
      ACCOUNT_DISABLED,
      "This account is disabled. Contact an administrator.",
    ));
  }
  personal_tokens::touch(pool, &row.id).await?;
  let lifetimes = settings::service::tokens(pool).await?;
  let now = Utc::now();
  let expires_in = i64::from(lifetimes.access_token_minutes) * 60;
  let claims = AccessClaims {
    iss: state.config.issuer().to_owned(),
    sub: user.id.clone(),
    exp: now.timestamp() + expires_in,
    iat: now.timestamp(),
    sid: None,
    kind: TokenKind::Human,
    via: Some("pat".into()),
    tid: Some(row.id),
    email: user.email.clone(),
    email_verified: user.is_verified(),
  };
  Ok(TradedToken {
    access_token: jwt::sign(state, &claims).await?,
    token_type: "Bearer".into(),
    expires_in,
  })
}
