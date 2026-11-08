//! Token signing keys. Planned (phase 2).

use super::model::*;
use crate::{http::HttpError, models::AuthIdentity, state::AppState};

pub async fn jwks(_state: &AppState) -> Result<Jwks, HttpError> {
  Err(HttpError::not_implemented())
}

pub async fn list(_state: &AppState) -> Result<Vec<SigningKeyResponse>, HttpError> {
  Err(HttpError::not_implemented())
}

pub async fn rotate(
  _state: &AppState,
  _actor: &AuthIdentity,
) -> Result<SigningKeyResponse, HttpError> {
  Err(HttpError::not_implemented())
}
