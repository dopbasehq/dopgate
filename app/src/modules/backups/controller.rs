use super::{error::BackupsError, model::*, service};
use crate::{
  extractors::{AdminIdentity, RootIdentity},
  http::{HttpResponse, HttpResponseFormat},
  state::AppState,
};
use axum::{
  Json,
  extract::{Path, Query, State},
};

/// List backups
#[utoipa::path(
  get,
  path = crate::constants::api::backups::COLLECTION,
  tag = "backups",
  security(("bearerAuth" = [])),
  responses(
    (status = 200, description = "Backups fetched", body = inline(HttpResponseFormat<Vec<BackupResponse>>)),
    (status = 401, description = "Authentication is required", body = crate::http::ErrorBody),
    (status = 403, description = "Only root may manage backups", body = crate::http::ErrorBody),
    (status = 501, description = "Not built yet", body = crate::http::ErrorBody),
  ),
)]
pub async fn list(
  State(state): State<AppState>,
  RootIdentity(_actor): RootIdentity,
) -> Result<HttpResponse<Vec<BackupResponse>>, BackupsError> {
  Ok(HttpResponse::ok(
    service::list(&state).await?,
    "BACKUPS_FETCHED",
  ))
}

/// Create a backup
///
/// Write a consistent copy of the database, encrypted with the master key,
/// to the data directory.
#[utoipa::path(
  post,
  path = crate::constants::api::backups::COLLECTION,
  tag = "backups",
  security(("bearerAuth" = [])),
  responses(
    (status = 201, description = "Backup created", body = inline(HttpResponseFormat<BackupResponse>)),
    (status = 401, description = "Authentication is required", body = crate::http::ErrorBody),
    (status = 403, description = "Only root may manage backups", body = crate::http::ErrorBody),
    (status = 501, description = "Not built yet", body = crate::http::ErrorBody),
  ),
)]
pub async fn create(
  State(state): State<AppState>,
  RootIdentity(actor): RootIdentity,
) -> Result<HttpResponse<BackupResponse>, BackupsError> {
  Ok(HttpResponse::created(
    service::create(&state, &actor).await?,
    "BACKUP_CREATED",
  ))
}

/// Download a backup
#[utoipa::path(
  get,
  path = crate::constants::api::backups::ITEM,
  tag = "backups",
  security(("bearerAuth" = [])),
  params(("key" = String, Path, description = "Backup file name")),
  responses(
    (status = 200, description = "The encrypted backup file", content_type = "application/octet-stream", body = Vec<u8>),
    (status = 401, description = "Authentication is required", body = crate::http::ErrorBody),
    (status = 403, description = "Only root may manage backups", body = crate::http::ErrorBody),
    (status = 404, description = "No such backup", body = crate::http::ErrorBody),
    (status = 501, description = "Not built yet", body = crate::http::ErrorBody),
  ),
)]
pub async fn download(
  State(state): State<AppState>,
  RootIdentity(_actor): RootIdentity,
  Path(key): Path<String>,
) -> Result<Vec<u8>, BackupsError> {
  service::download(&state, &key).await
}

/// Delete a backup
#[utoipa::path(
  delete,
  path = crate::constants::api::backups::ITEM,
  tag = "backups",
  security(("bearerAuth" = [])),
  params(("key" = String, Path, description = "Backup file name")),
  responses(
    (status = 200, description = "Backup deleted", body = inline(HttpResponseFormat<serde_json::Value>)),
    (status = 401, description = "Authentication is required", body = crate::http::ErrorBody),
    (status = 403, description = "Only root may manage backups", body = crate::http::ErrorBody),
    (status = 404, description = "No such backup", body = crate::http::ErrorBody),
    (status = 501, description = "Not built yet", body = crate::http::ErrorBody),
  ),
)]
pub async fn delete(
  State(state): State<AppState>,
  RootIdentity(actor): RootIdentity,
  Path(key): Path<String>,
) -> Result<HttpResponse<serde_json::Value>, BackupsError> {
  service::delete(&state, &actor, &key).await?;
  Ok(HttpResponse::done("BACKUP_DELETED"))
}

/// Restore a backup
///
/// Replace the database with the backup. API requests get a 503 while it
/// runs, and every session ends.
#[utoipa::path(
  post,
  path = crate::constants::api::backups::RESTORE,
  tag = "backups",
  security(("bearerAuth" = [])),
  params(("key" = String, Path, description = "Backup file name")),
  responses(
    (status = 200, description = "Backup restored", body = inline(HttpResponseFormat<serde_json::Value>)),
    (status = 401, description = "Authentication is required", body = crate::http::ErrorBody),
    (status = 403, description = "Only root may restore backups", body = crate::http::ErrorBody),
    (status = 404, description = "No such backup", body = crate::http::ErrorBody),
    (status = 501, description = "Not built yet", body = crate::http::ErrorBody),
  ),
)]
pub async fn restore(
  State(state): State<AppState>,
  RootIdentity(actor): RootIdentity,
  Path(key): Path<String>,
) -> Result<HttpResponse<serde_json::Value>, BackupsError> {
  service::restore(&state, &actor, &key).await?;
  Ok(HttpResponse::done("BACKUP_RESTORED"))
}

/// Export users
///
/// Download every user as JSON or CSV.
#[utoipa::path(
  get,
  path = crate::constants::api::backups::EXPORT,
  tag = "backups",
  security(("bearerAuth" = [])),
  params(ExportQuery),
  responses(
    (status = 200, description = "The export file", content_type = "application/octet-stream", body = Vec<u8>),
    (status = 401, description = "Authentication is required", body = crate::http::ErrorBody),
    (status = 403, description = "Only root and admins may export users", body = crate::http::ErrorBody),
    (status = 501, description = "Not built yet", body = crate::http::ErrorBody),
  ),
)]
pub async fn export(
  State(state): State<AppState>,
  AdminIdentity(actor): AdminIdentity,
  Query(query): Query<ExportQuery>,
) -> Result<Vec<u8>, BackupsError> {
  service::export(&state, &actor, query).await
}

/// Import users
///
/// Create users in bulk, for example when moving from another auth service.
#[utoipa::path(
  post,
  path = crate::constants::api::backups::IMPORT,
  tag = "backups",
  security(("bearerAuth" = [])),
  request_body = ImportRequest,
  responses(
    (status = 200, description = "Users imported", body = inline(HttpResponseFormat<ImportResult>)),
    (status = 400, description = "A user was refused", body = crate::http::ErrorBody),
    (status = 401, description = "Authentication is required", body = crate::http::ErrorBody),
    (status = 403, description = "Only root and admins may import users", body = crate::http::ErrorBody),
    (status = 501, description = "Not built yet", body = crate::http::ErrorBody),
  ),
)]
pub async fn import(
  State(state): State<AppState>,
  AdminIdentity(actor): AdminIdentity,
  Json(request): Json<ImportRequest>,
) -> Result<HttpResponse<ImportResult>, BackupsError> {
  Ok(HttpResponse::ok(
    service::import(&state, &actor, request).await?,
    "USERS_IMPORTED",
  ))
}
