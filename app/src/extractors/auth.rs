use axum::{
  extract::FromRequestParts,
  http::{header::AUTHORIZATION, request::Parts},
};

use crate::{
  constants::{
    errors::{AUTHENTICATION_INVALID, AUTHENTICATION_REQUIRED},
    tokens::SECRET_KEY_PREFIX,
  },
  http::HttpError,
  models::AuthIdentity,
  services::{authz, jwt},
  state::AppState,
};

/// The bearer token, or a 401 when the header is missing or malformed.
fn bearer(parts: &Parts) -> Result<&str, HttpError> {
  let header = parts
    .headers
    .get(AUTHORIZATION)
    .ok_or_else(|| HttpError::unauthorized(AUTHENTICATION_REQUIRED, "Sign in to continue."))?;
  // The scheme name is case-insensitive (RFC 9110, section 11.1).
  header
    .to_str()
    .ok()
    .and_then(|value| value.split_once(' '))
    .filter(|(scheme, _)| scheme.eq_ignore_ascii_case("bearer"))
    .map(|(_, token)| token.trim())
    .filter(|token| !token.is_empty())
    .ok_or_else(|| {
      HttpError::unauthorized(
        AUTHENTICATION_INVALID,
        "Use an Authorization header of the form `Bearer <token>`.",
      )
    })
}

/// Any authenticated caller: a user with an access token, or a backend
/// with a client secret key.
impl FromRequestParts<AppState> for AuthIdentity {
  type Rejection = HttpError;

  async fn from_request_parts(
    parts: &mut Parts,
    state: &AppState,
  ) -> Result<Self, Self::Rejection> {
    let token = bearer(parts)?;
    if token.starts_with(SECRET_KEY_PREFIX) {
      // Client secret keys arrive with the clients module.
      return Err(HttpError::not_implemented());
    }
    let claims = jwt::verify(state, token).await?;
    Ok(Self::User {
      user_id: claims.sub,
      email: claims.email,
      role: claims.role,
      session_id: claims.sid,
    })
  }
}

/// A caller allowed to use the admin API.
pub struct AdminIdentity(pub AuthIdentity);

impl FromRequestParts<AppState> for AdminIdentity {
  type Rejection = HttpError;

  async fn from_request_parts(
    parts: &mut Parts,
    state: &AppState,
  ) -> Result<Self, Self::Rejection> {
    let identity = AuthIdentity::from_request_parts(parts, state).await?;
    authz::require_admin(&identity)?;
    Ok(Self(identity))
  }
}

/// The root account, for instance-level operations.
pub struct RootIdentity(pub AuthIdentity);

impl FromRequestParts<AppState> for RootIdentity {
  type Rejection = HttpError;

  async fn from_request_parts(
    parts: &mut Parts,
    state: &AppState,
  ) -> Result<Self, Self::Rejection> {
    let identity = AuthIdentity::from_request_parts(parts, state).await?;
    authz::require_root(&identity)?;
    Ok(Self(identity))
  }
}
