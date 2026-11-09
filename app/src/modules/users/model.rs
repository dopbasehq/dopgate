use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

use crate::models::{User, UserStatus};

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
#[serde(rename_all = "camelCase")]
pub struct UserQuery {
  /// Match on email or display name.
  pub search: Option<String>,
  pub status: Option<UserStatus>,
  /// The `nextCursor` of the previous page.
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
  /// JSON only admins and the service key can read and change.
  pub private_metadata: serde_json::Value,
  /// Set while the account is locked after wrong passwords.
  pub locked_until: Option<DateTime<Utc>>,
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
  /// Leave out to create an account that signs in with an emailed code.
  pub password: Option<String>,
  pub display_name: Option<String>,
  /// Mark the email as verified without sending a message.
  #[serde(default)]
  pub email_verified: bool,
  pub public_metadata: Option<serde_json::Value>,
  pub private_metadata: Option<serde_json::Value>,
}

/// Fields left out stay as they are. An empty string clears `displayName`
/// or `avatarUrl`.
#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateUserRequest {
  pub display_name: Option<String>,
  pub avatar_url: Option<String>,
  pub email_verified: Option<bool>,
  /// Replaces the whole object.
  pub public_metadata: Option<serde_json::Value>,
  /// Replaces the whole object.
  pub private_metadata: Option<serde_json::Value>,
}
