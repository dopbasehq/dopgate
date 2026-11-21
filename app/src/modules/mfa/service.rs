//! Authenticator app (TOTP) second factor. Planned (phase 8).

use super::model::*;
use crate::{
  http::HttpError, models::AuthIdentity, modules::auth::model::AuthTokens, state::AppState,
};

pub async fn enroll(
  _state: &AppState,
  _identity: &AuthIdentity,
) -> Result<TotpEnrollment, HttpError> {
  Err(HttpError::not_implemented())
}

pub async fn verify(
  _state: &AppState,
  _identity: &AuthIdentity,
  _request: TotpCodeRequest,
) -> Result<RecoveryCodes, HttpError> {
  Err(HttpError::not_implemented())
}

pub async fn remove(
  _state: &AppState,
  _identity: &AuthIdentity,
  _request: TotpCodeRequest,
) -> Result<(), HttpError> {
  Err(HttpError::not_implemented())
}

pub async fn challenge(
  _state: &AppState,
  _request: MfaChallengeRequest,
) -> Result<AuthTokens, HttpError> {
  Err(HttpError::not_implemented())
}
