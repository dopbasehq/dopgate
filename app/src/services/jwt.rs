//! Access tokens: signing, verification, and the public key set.
//!
//! Planned (phase 2). Access tokens will be ES256 JWTs signed with the
//! active key in `signing_keys`, whose private half is encrypted with the
//! master key. Retired keys stay in the JWKS until every token they signed
//! has expired, so apps that verify offline keep working across rotations.

use crate::{http::HttpError, models::AccessClaims, state::AppState};

/// Verify an access token and return its claims.
pub async fn verify(
  _state: &AppState,
  _token: &str,
) -> Result<AccessClaims, HttpError> {
  Err(HttpError::not_implemented())
}
