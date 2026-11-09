//! Access tokens: signing and verification.
//!
//! App access tokens are ES256 JWTs signed with the active key in
//! `signing_keys`. Your backend verifies them offline against the JWKS.
//! Console access tokens are HS256 JWTs signed with a secret that never
//! leaves Dopgate, so no backend can accept an admin's token. Inside
//! Dopgate, verification also checks the session and the account, so a
//! revoked session or a disabled account stops working here at once.

use jsonwebtoken::{
  Algorithm, DecodingKey, EncodingKey, Header, Validation, decode, decode_header, encode,
};

use crate::{
  constants::{
    errors::{ACCOUNT_DISABLED, TOKEN_INVALID},
    tokens::CONSOLE_AUDIENCE,
  },
  http::HttpError,
  models::{AccessClaims, ConsoleClaims, Realm},
  modules::{admins, sessions::repository as sessions},
  state::AppState,
};

/// Sign app `claims` with the active key.
pub async fn sign(
  state: &AppState,
  claims: &AccessClaims,
) -> Result<String, HttpError> {
  let (kid, key) = state.keys.signing_key().await.ok_or_else(|| {
    tracing::error!("no active signing key");
    HttpError::internal()
  })?;
  let mut header = Header::new(Algorithm::ES256);
  header.kid = Some(kid);
  encode(&header, claims, &key).map_err(|error| {
    tracing::error!(%error, "failed to sign an access token");
    HttpError::internal()
  })
}

/// Sign console `claims` with the internal console secret.
pub async fn sign_console(
  state: &AppState,
  claims: &ConsoleClaims,
) -> Result<String, HttpError> {
  let (kid, secret) = state.keys.console_key().await.ok_or_else(|| {
    tracing::error!("no active console key");
    HttpError::internal()
  })?;
  let mut header = Header::new(Algorithm::HS256);
  header.kid = Some(kid);
  encode(&header, claims, &EncodingKey::from_secret(&secret)).map_err(|error| {
    tracing::error!(%error, "failed to sign a console token");
    HttpError::internal()
  })
}

fn invalid() -> HttpError {
  HttpError::unauthorized(
    TOKEN_INVALID,
    "Your session has expired or the token is invalid. Sign in again.",
  )
}

fn disabled() -> HttpError {
  HttpError::forbidden(
    ACCOUNT_DISABLED,
    "This account is disabled. Contact an administrator.",
  )
}

/// A verified access token.
pub enum Verified {
  /// A user of your app.
  App(AccessClaims),
  /// An admin in the console.
  Console(ConsoleClaims),
}

/// Verify an access token of either kind and return its claims, refreshed
/// from the database: the email (and an admin's role) are the account's
/// current ones.
pub async fn verify(
  state: &AppState,
  token: &str,
) -> Result<Verified, HttpError> {
  let header = decode_header(token).map_err(|_| invalid())?;
  let kid = header.kid.ok_or_else(invalid)?;
  match header.alg {
    Algorithm::ES256 => verify_app(state, token, &kid).await.map(Verified::App),
    Algorithm::HS256 => verify_console(state, token, &kid)
      .await
      .map(Verified::Console),
    _ => Err(invalid()),
  }
}

async fn verify_app(
  state: &AppState,
  token: &str,
  kid: &str,
) -> Result<AccessClaims, HttpError> {
  let key = state
    .keys
    .verifying_key(state.db.pool(), kid)
    .await
    .ok_or_else(invalid)?;
  let mut rules = Validation::new(Algorithm::ES256);
  rules.set_issuer(&[state.config.issuer()]);
  rules.validate_aud = false;
  rules.leeway = 30;
  let mut claims = decode::<AccessClaims>(token, &key, &rules)
    .map_err(|_| invalid())?
    .claims;
  let (email, status, verified) =
    sessions::live_account(state.db.pool(), Realm::App, &claims.sid, &claims.sub)
      .await?
      .ok_or_else(invalid)?;
  if status != "active" {
    return Err(disabled());
  }
  claims.email = email;
  claims.email_verified = verified;
  Ok(claims)
}

async fn verify_console(
  state: &AppState,
  token: &str,
  kid: &str,
) -> Result<ConsoleClaims, HttpError> {
  let secret = state
    .keys
    .console_secret(state.db.pool(), kid)
    .await
    .ok_or_else(invalid)?;
  let mut rules = Validation::new(Algorithm::HS256);
  rules.set_issuer(&[state.config.issuer()]);
  rules.set_audience(&[CONSOLE_AUDIENCE]);
  rules.leeway = 30;
  let mut claims = decode::<ConsoleClaims>(token, &DecodingKey::from_secret(&secret), &rules)
    .map_err(|_| invalid())?
    .claims;
  let (_, status, _) =
    sessions::live_account(state.db.pool(), Realm::Console, &claims.sid, &claims.sub)
      .await?
      .ok_or_else(invalid)?;
  if status != "active" {
    return Err(disabled());
  }
  let admin = admins::repository::find_by_id(state.db.pool(), &claims.sub)
    .await?
    .ok_or_else(invalid)?;
  claims.email = admin.email.clone();
  claims.role = admin.role();
  Ok(claims)
}
