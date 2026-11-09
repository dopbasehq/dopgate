//! Access tokens: signing and verification.
//!
//! Access tokens are ES256 JWTs signed with the active key in
//! `signing_keys`. Your backend verifies them offline against the JWKS.
//! Inside Dopgate, verification also checks the session and the account,
//! so a revoked session or a disabled account stops working here at once.

use jsonwebtoken::{Algorithm, Header, Validation, decode, decode_header, encode};

use crate::{
  constants::errors::{ACCOUNT_DISABLED, TOKEN_INVALID},
  http::HttpError,
  models::{AccessClaims, Role},
  state::AppState,
};

/// Sign `claims` with the active key.
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

fn invalid() -> HttpError {
  HttpError::unauthorized(
    TOKEN_INVALID,
    "Your session has expired or the token is invalid. Sign in again.",
  )
}

/// Verify an access token and return its claims, refreshed from the
/// database: the role and email are the account's current ones.
pub async fn verify(
  state: &AppState,
  token: &str,
) -> Result<AccessClaims, HttpError> {
  let header = decode_header(token).map_err(|_| invalid())?;
  if header.alg != Algorithm::ES256 {
    return Err(invalid());
  }
  let kid = header.kid.ok_or_else(invalid)?;
  let key = state
    .keys
    .verifying_key(state.db.pool(), &kid)
    .await
    .ok_or_else(invalid)?;
  let mut rules = Validation::new(Algorithm::ES256);
  rules.set_issuer(&[state.config.issuer()]);
  rules.validate_aud = false;
  rules.leeway = 30;
  let mut claims = decode::<AccessClaims>(token, &key, &rules)
    .map_err(|_| invalid())?
    .claims;

  let row: Option<(String, String, String, bool)> = sqlx::query_as(
    "SELECT u.email, u.role, u.status, u.email_verified_at IS NOT NULL \
     FROM sessions s JOIN users u ON u.id = s.user_id \
     WHERE s.id = $1 AND s.user_id = $2 AND s.revoked_at IS NULL AND s.absolute_expires_at > now()",
  )
  .bind(&claims.sid)
  .bind(&claims.sub)
  .fetch_optional(state.db.pool())
  .await?;
  let (email, role, status, verified) = row.ok_or_else(invalid)?;
  if status != "active" {
    return Err(HttpError::forbidden(
      ACCOUNT_DISABLED,
      "This account is disabled. Contact an administrator.",
    ));
  }
  claims.email = email;
  claims.role = Role::parse(&role).ok_or_else(HttpError::internal)?;
  claims.email_verified = verified;
  Ok(claims)
}
