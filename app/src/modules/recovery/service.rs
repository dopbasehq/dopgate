//! Forgot and reset password. Planned (phase 3).

use super::model::*;
use crate::{http::HttpError, state::AppState};

pub async fn forgot(
  _state: &AppState,
  _client_key: Option<String>,
  _request: ForgotPasswordRequest,
) -> Result<(), HttpError> {
  Err(HttpError::not_implemented())
}

pub async fn reset(
  _state: &AppState,
  _request: ResetPasswordRequest,
) -> Result<(), HttpError> {
  Err(HttpError::not_implemented())
}
