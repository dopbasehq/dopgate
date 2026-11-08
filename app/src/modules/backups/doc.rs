use super::{controller, model::*};
use crate::http::{ErrorBody, HttpResponseFormat};
use utoipa::OpenApi;

#[derive(OpenApi)]
#[openapi(
  paths(
    controller::list,
    controller::create,
    controller::download,
    controller::delete,
    controller::restore,
    controller::export,
    controller::import
  ),
  components(schemas(
    BackupResponse,
    ExportFormat,
    ImportRequest,
    ImportUser,
    ImportResult,
    ErrorBody,
    HttpResponseFormat<Vec<BackupResponse>>,
    HttpResponseFormat<BackupResponse>,
    HttpResponseFormat<ImportResult>,
    HttpResponseFormat<serde_json::Value>
  )),
  tags((name = "backups", description = "Admin: backup, restore, export, and import"))
)]
struct BackupsApi;

pub fn build() -> utoipa::openapi::OpenApi {
  BackupsApi::openapi()
}
