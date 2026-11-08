//! Email verification and passwordless sign-in. Planned (phase 3).

use super::model::*;
use crate::{http::HttpError, state::AppState};

pub async fn send(
  _state: &AppState,
  _client_key: Option<String>,
  _request: SendVerificationRequest,
) -> Result<(), HttpError> {
  Err(HttpError::not_implemented())
}

pub async fn confirm(
  _state: &AppState,
  _client_key: Option<String>,
  _request: ConfirmVerificationRequest,
) -> Result<VerificationResult, HttpError> {
  Err(HttpError::not_implemented())
}
