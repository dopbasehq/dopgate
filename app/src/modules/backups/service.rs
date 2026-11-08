//! Backup, restore, export, and import. Planned (phase 7).

use super::model::*;
use crate::{http::HttpError, models::AuthIdentity, state::AppState};

pub async fn list(_state: &AppState) -> Result<Vec<BackupResponse>, HttpError> {
  Err(HttpError::not_implemented())
}

pub async fn create(
  _state: &AppState,
  _actor: &AuthIdentity,
) -> Result<BackupResponse, HttpError> {
  Err(HttpError::not_implemented())
}

pub async fn download(
  _state: &AppState,
  _key: &str,
) -> Result<Vec<u8>, HttpError> {
  Err(HttpError::not_implemented())
}

pub async fn delete(
  _state: &AppState,
  _actor: &AuthIdentity,
  _key: &str,
) -> Result<(), HttpError> {
  Err(HttpError::not_implemented())
}

pub async fn restore(
  _state: &AppState,
  _actor: &AuthIdentity,
  _key: &str,
) -> Result<(), HttpError> {
  Err(HttpError::not_implemented())
}

pub async fn export(
  _state: &AppState,
  _actor: &AuthIdentity,
  _query: ExportQuery,
) -> Result<Vec<u8>, HttpError> {
  Err(HttpError::not_implemented())
}

pub async fn import(
  _state: &AppState,
  _actor: &AuthIdentity,
  _request: ImportRequest,
) -> Result<ImportResult, HttpError> {
  Err(HttpError::not_implemented())
}
