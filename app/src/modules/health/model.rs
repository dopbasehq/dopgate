use serde::Serialize;
use utoipa::ToSchema;
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct HealthResponse {
  pub product: &'static str,
  pub version: &'static str,
  pub api_version: &'static str,
  /// `ok`, or `degraded` while the database is unreachable.
  pub status: &'static str,
  /// `ok` or `unavailable`.
  pub database: &'static str,
}
