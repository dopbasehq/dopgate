use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapStatus {
  /// True once the root account exists.
  pub initialized: bool,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateRootRequest {
  /// The one-time token the server prints at startup while no root
  /// account exists.
  pub setup_token: String,
  pub email: String,
  pub password: String,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RootCreated {
  pub user_id: String,
  pub email: String,
}
