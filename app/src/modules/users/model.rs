use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

use crate::models::{Role, User, UserStatus};

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
#[serde(rename_all = "camelCase")]
pub struct UserQuery {
  /// Match on email or display name.
  pub search: Option<String>,
  pub role: Option<Role>,
  pub status: Option<UserStatus>,
  pub cursor: Option<String>,
  /// 1 to 200. Default: 50.
  pub limit: Option<u32>,
}

/// A user as admins see it.
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AdminUser {
  #[serde(flatten)]
  pub user: User,
  /// JSON only admins can read and change.
  pub private_metadata: serde_json::Value,
  /// Set while the account is locked after failed sign-ins.
  pub locked_until: Option<String>,
  /// Linked single sign-on providers, by ID.
  pub sso_providers: Vec<String>,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UserPage {
  pub items: Vec<AdminUser>,
  pub next_cursor: Option<String>,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateUserRequest {
  pub email: String,
  /// Leave out to create an account that signs in with a code, a link, or
  /// single sign-on.
  pub password: Option<String>,
  /// `admin` or `member`. Default: `member`.
  pub role: Option<Role>,
  pub display_name: Option<String>,
  /// Mark the email as verified without sending a message.
  #[serde(default)]
  pub email_verified: bool,
  pub public_metadata: Option<serde_json::Value>,
  pub private_metadata: Option<serde_json::Value>,
}

/// Fields left out stay as they are.
#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateUserRequest {
  pub email: Option<String>,
  pub password: Option<String>,
  pub role: Option<Role>,
  pub status: Option<UserStatus>,
  pub display_name: Option<String>,
  pub email_verified: Option<bool>,
  pub public_metadata: Option<serde_json::Value>,
  pub private_metadata: Option<serde_json::Value>,
}
