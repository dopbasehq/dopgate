use axum::{
  extract::FromRequestParts,
  http::{header::AUTHORIZATION, request::Parts},
};

use crate::{
  constants::errors::{AUTHENTICATION_INVALID, AUTHENTICATION_REQUIRED, AUTHORIZATION_DENIED},
  http::HttpError,
  models::AuthIdentity,
  services::{authz, jwt, token},
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

/// Any authenticated caller: a user with an access token, or the main app's
/// backend with the service key.
impl FromRequestParts<AppState> for AuthIdentity {
  type Rejection = HttpError;

  async fn from_request_parts(
    parts: &mut Parts,
    state: &AppState,
  ) -> Result<Self, Self::Rejection> {
    let token = bearer(parts)?;
    // A JWT has three dot-separated parts; the service key never contains a
    // dot only by accident, so anything else is compared with the key.
    if token.matches('.').count() != 2 {
      return match &state.config.service_key {
        Some(key) if token::constant_time_eq(key, token) => Ok(Self::Service),
        _ => Err(HttpError::unauthorized(
          AUTHENTICATION_INVALID,
          "The token is not a valid access token or service key.",
        )),
      };
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

/// A signed-in user. The service key is refused: it has no account.
pub struct UserIdentity {
  pub user_id: String,
  pub email: String,
  pub role: crate::models::Role,
  pub session_id: String,
}

impl UserIdentity {
  pub fn identity(&self) -> AuthIdentity {
    AuthIdentity::User {
      user_id: self.user_id.clone(),
      email: self.email.clone(),
      role: self.role,
      session_id: self.session_id.clone(),
    }
  }
}

impl FromRequestParts<AppState> for UserIdentity {
  type Rejection = HttpError;

  async fn from_request_parts(
    parts: &mut Parts,
    state: &AppState,
  ) -> Result<Self, Self::Rejection> {
    match AuthIdentity::from_request_parts(parts, state).await? {
      AuthIdentity::User {
        user_id,
        email,
        role,
        session_id,
      } => Ok(Self {
        user_id,
        email,
        role,
        session_id,
      }),
      AuthIdentity::Service => Err(HttpError::forbidden(
        AUTHORIZATION_DENIED,
        "The service key has no account. Use a user's access token.",
      )),
    }
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
