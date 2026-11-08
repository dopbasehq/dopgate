//! App clients and their keys. Planned (phase 5).

use super::model::*;
use crate::{http::HttpError, models::AuthIdentity, state::AppState};

pub async fn list(_state: &AppState) -> Result<Vec<ClientResponse>, HttpError> {
  Err(HttpError::not_implemented())
}

pub async fn get(
  _state: &AppState,
  _id: &str,
) -> Result<ClientResponse, HttpError> {
  Err(HttpError::not_implemented())
}

pub async fn create(
  _state: &AppState,
  _actor: &AuthIdentity,
  _request: CreateClientRequest,
) -> Result<ClientWithSecret, HttpError> {
  Err(HttpError::not_implemented())
}

pub async fn update(
  _state: &AppState,
  _actor: &AuthIdentity,
  _id: &str,
  _request: UpdateClientRequest,
) -> Result<ClientResponse, HttpError> {
  Err(HttpError::not_implemented())
}

pub async fn delete(
  _state: &AppState,
  _actor: &AuthIdentity,
  _id: &str,
) -> Result<(), HttpError> {
  Err(HttpError::not_implemented())
}

pub async fn rotate_secret(
  _state: &AppState,
  _actor: &AuthIdentity,
  _id: &str,
) -> Result<ClientWithSecret, HttpError> {
  Err(HttpError::not_implemented())
}
