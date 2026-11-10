use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::models::Admin;

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AdminList {
  /// Root first, then newest first.
  pub items: Vec<Admin>,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateAdminRequest {
  pub email: String,
  /// Leave out for an admin who signs in with emailed codes.
  pub password: Option<String>,
  pub display_name: Option<String>,
}

/// Fields left out stay as they are. An empty string clears them.
#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAdminRequest {
  pub display_name: Option<String>,
  pub avatar_url: Option<String>,
}
