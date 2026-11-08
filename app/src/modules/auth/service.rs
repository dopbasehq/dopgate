//! Sign-up, sign-in, and the signed-in account. Planned (phase 1 and 2).

use super::model::*;
use crate::{
  http::HttpError,
  models::{AuthIdentity, User},
  state::AppState,
};

pub async fn methods(_state: &AppState) -> Result<AuthMethods, HttpError> {
  Err(HttpError::not_implemented())
}

pub async fn signup(
  _state: &AppState,
  _client_key: Option<String>,
  _request: SignupRequest,
) -> Result<AuthTokens, HttpError> {
  Err(HttpError::not_implemented())
}

pub async fn login(
  _state: &AppState,
  _client_key: Option<String>,
  _request: LoginRequest,
) -> Result<AuthTokens, HttpError> {
  Err(HttpError::not_implemented())
}

pub async fn refresh(
  _state: &AppState,
  _request: RefreshRequest,
) -> Result<AuthTokens, HttpError> {
  Err(HttpError::not_implemented())
}

pub async fn logout(
  _state: &AppState,
  _identity: &AuthIdentity,
  _request: LogoutRequest,
) -> Result<(), HttpError> {
  Err(HttpError::not_implemented())
}

pub async fn me(
  _state: &AppState,
  _identity: &AuthIdentity,
) -> Result<User, HttpError> {
  Err(HttpError::not_implemented())
}

pub async fn update_me(
  _state: &AppState,
  _identity: &AuthIdentity,
  _request: UpdateProfileRequest,
) -> Result<User, HttpError> {
  Err(HttpError::not_implemented())
}

pub async fn change_password(
  _state: &AppState,
  _identity: &AuthIdentity,
  _request: ChangePasswordRequest,
) -> Result<(), HttpError> {
  Err(HttpError::not_implemented())
}
