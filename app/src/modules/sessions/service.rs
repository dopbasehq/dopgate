//! The signed-in user's sessions. Planned (phase 2).

use super::model::*;
use crate::{http::HttpError, models::AuthIdentity, state::AppState};

pub async fn list(
  _state: &AppState,
  _identity: &AuthIdentity,
) -> Result<Vec<SessionResponse>, HttpError> {
  Err(HttpError::not_implemented())
}

pub async fn revoke(
  _state: &AppState,
  _identity: &AuthIdentity,
  _session_id: &str,
) -> Result<(), HttpError> {
  Err(HttpError::not_implemented())
}
