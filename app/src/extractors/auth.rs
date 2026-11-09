use axum::{
  extract::FromRequestParts,
  http::{header::AUTHORIZATION, request::Parts},
};

use crate::{
  constants::errors::{AUTHENTICATION_INVALID, AUTHENTICATION_REQUIRED, AUTHORIZATION_DENIED},
  http::HttpError,
  models::{AuthIdentity, Role, UserVia},
  services::{
    authz,
    jwt::{self, Verified},
    token,
  },
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

/// Any authenticated caller: an admin with a console token, a user with an
/// app token, or the main app's backend with the service key.
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
    Ok(match jwt::verify(state, token).await? {
      Verified::App(claims) => Self::User {
        via: match (claims.tid, claims.sid) {
          (Some(tid), _) => UserVia::PersonalToken(tid),
          (None, Some(sid)) => UserVia::Session(sid),
          (None, None) => {
            return Err(HttpError::unauthorized(
              crate::constants::errors::TOKEN_INVALID,
              "The token is not a valid access token.",
            ));
          }
        },
        user_id: claims.sub,
        email: claims.email,
      },
      Verified::Console(claims) => Self::Admin {
        admin_id: claims.sub,
        email: claims.email,
        role: claims.role,
        session_id: claims.sid,
      },
    })
  }
}

/// The refusal for an admin or the service key on a user endpoint.
fn not_a_user(identity: &AuthIdentity) -> HttpError {
  match identity {
    AuthIdentity::Admin { .. } => HttpError::forbidden(
      AUTHORIZATION_DENIED,
      "Admins have no app account. Use the console endpoints under /console.",
    ),
    _ => HttpError::forbidden(
      AUTHORIZATION_DENIED,
      "The service key has no account. Use a user's access token.",
    ),
  }
}

/// A user of your app, signed in with a password or a code. A token from a
/// personal token is refused, so a leaked one can't change the account or
/// make more tokens. Admins and the service key have no app account.
pub struct UserIdentity {
  pub user_id: String,
  pub email: String,
  pub session_id: String,
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
        via: UserVia::Session(session_id),
      } => Ok(Self {
        user_id,
        email,
        session_id,
      }),
      AuthIdentity::User {
        via: UserVia::PersonalToken(_),
        ..
      } => Err(HttpError::forbidden(
        AUTHORIZATION_DENIED,
        "Sign in with a password or a code to do this. A personal token can't.",
      )),
      other => Err(not_a_user(&other)),
    }
  }
}

/// A user of your app, signed in any way, personal tokens included. For
/// reading and updating the profile.
pub struct AnyUserIdentity {
  pub user_id: String,
  pub email: String,
  pub via: UserVia,
}

impl FromRequestParts<AppState> for AnyUserIdentity {
  type Rejection = HttpError;

  async fn from_request_parts(
    parts: &mut Parts,
    state: &AppState,
  ) -> Result<Self, Self::Rejection> {
    match AuthIdentity::from_request_parts(parts, state).await? {
      AuthIdentity::User {
        user_id,
        email,
        via,
      } => Ok(Self {
        user_id,
        email,
        via,
      }),
      other => Err(not_a_user(&other)),
    }
  }
}

/// An admin signed in to the console. Users and the service key are
/// refused.
pub struct ConsoleIdentity {
  pub admin_id: String,
  pub email: String,
  pub role: Role,
  pub session_id: String,
}

impl ConsoleIdentity {
  pub fn identity(&self) -> AuthIdentity {
    AuthIdentity::Admin {
      admin_id: self.admin_id.clone(),
      email: self.email.clone(),
      role: self.role,
      session_id: self.session_id.clone(),
    }
  }
}

impl FromRequestParts<AppState> for ConsoleIdentity {
  type Rejection = HttpError;

  async fn from_request_parts(
    parts: &mut Parts,
    state: &AppState,
  ) -> Result<Self, Self::Rejection> {
    match AuthIdentity::from_request_parts(parts, state).await? {
      AuthIdentity::Admin {
        admin_id,
        email,
        role,
        session_id,
      } => Ok(Self {
        admin_id,
        email,
        role,
        session_id,
      }),
      _ => Err(HttpError::forbidden(
        AUTHORIZATION_DENIED,
        "Only admins signed in to the console can do this.",
      )),
    }
  }
}

/// A caller allowed to use the admin API: an admin, or the service key.
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
