//! OpenID Connect provider endpoints. Planned (phase 9).

use super::model::*;
use crate::{http::HttpError, models::AuthIdentity, state::AppState};

pub async fn discovery(_state: &AppState) -> Result<serde_json::Value, HttpError> {
  Err(HttpError::not_implemented())
}

pub async fn authorize(
  _state: &AppState,
  _query: AuthorizeQuery,
) -> Result<String, HttpError> {
  Err(HttpError::not_implemented())
}

pub async fn token(
  _state: &AppState,
  _request: TokenRequest,
) -> Result<TokenResponse, HttpError> {
  Err(HttpError::not_implemented())
}

pub async fn userinfo(
  _state: &AppState,
  _identity: &AuthIdentity,
) -> Result<serde_json::Value, HttpError> {
  Err(HttpError::not_implemented())
}
