use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

/// An encrypted backup file in the data directory.
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BackupResponse {
  /// The file name, used as the key in backup URLs.
  pub key: String,
  pub size_bytes: u64,
  pub created_at: String,
}

#[derive(Clone, Copy, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum ExportFormat {
  Json,
  Csv,
}

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
#[serde(rename_all = "camelCase")]
pub struct ExportQuery {
  /// Default: json.
  pub format: Option<ExportFormat>,
  /// Include password hashes so the users can sign in after an import
  /// elsewhere. Only root may ask for them.
  #[serde(default)]
  pub include_password_hashes: bool,
}

/// A batch of users to create.
#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ImportRequest {
  pub users: Vec<ImportUser>,
  /// Skip emails that already have an account instead of failing.
  #[serde(default)]
  pub skip_existing: bool,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ImportUser {
  pub email: String,
  #[serde(default)]
  pub email_verified: bool,
  pub display_name: Option<String>,
  /// An Argon2 PHC string kept as is. Other hash formats come later.
  pub password_hash: Option<String>,
  pub public_metadata: Option<serde_json::Value>,
  pub private_metadata: Option<serde_json::Value>,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
  pub created: u64,
  pub skipped: u64,
}
