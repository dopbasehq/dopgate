//! Admin user management. Planned (phase 1).

use super::model::*;
use crate::{http::HttpError, models::AuthIdentity, state::AppState};

pub async fn list(
  _state: &AppState,
  _query: UserQuery,
) -> Result<UserPage, HttpError> {
  Err(HttpError::not_implemented())
}

pub async fn get(
  _state: &AppState,
  _id: &str,
) -> Result<AdminUser, HttpError> {
  Err(HttpError::not_implemented())
}

pub async fn create(
  _state: &AppState,
  _actor: &AuthIdentity,
  _request: CreateUserRequest,
) -> Result<AdminUser, HttpError> {
  Err(HttpError::not_implemented())
}

pub async fn update(
  _state: &AppState,
  _actor: &AuthIdentity,
  _id: &str,
  _request: UpdateUserRequest,
) -> Result<AdminUser, HttpError> {
  Err(HttpError::not_implemented())
}

pub async fn delete(
  _state: &AppState,
  _actor: &AuthIdentity,
  _id: &str,
) -> Result<(), HttpError> {
  Err(HttpError::not_implemented())
}

pub async fn revoke_sessions(
  _state: &AppState,
  _actor: &AuthIdentity,
  _id: &str,
) -> Result<(), HttpError> {
  Err(HttpError::not_implemented())
}
