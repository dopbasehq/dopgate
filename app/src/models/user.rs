use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// What an account may do. Stored in `users.role`.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Role {
  /// The instance owner, created at setup. Exactly one exists.
  Root,
  /// Manages members and settings.
  Admin,
  /// An end user of your app.
  Member,
}

impl Role {
  pub fn as_str(self) -> &'static str {
    match self {
      Self::Root => "root",
      Self::Admin => "admin",
      Self::Member => "member",
    }
  }

  pub fn parse(value: &str) -> Option<Self> {
    match value {
      "root" => Some(Self::Root),
      "admin" => Some(Self::Admin),
      "member" => Some(Self::Member),
      _ => None,
    }
  }

  /// Root and admins reach the admin API.
  pub fn is_admin(self) -> bool {
    matches!(self, Self::Root | Self::Admin)
  }
}

/// Whether an account may sign in. Stored in `users.status`.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum UserStatus {
  Active,
  /// Sign-in is refused and existing sessions stop refreshing.
  Disabled,
}

/// A user account as the API returns it. Never includes the password hash
/// or private metadata; the admin API adds those it may show.
#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct User {
  /// User ID with the `usr_` prefix.
  pub id: String,
  pub email: String,
  pub email_verified: bool,
  pub display_name: Option<String>,
  pub avatar_url: Option<String>,
  pub role: Role,
  pub status: UserStatus,
  /// JSON the user can read and change, such as preferences.
  pub user_metadata: serde_json::Value,
  /// JSON your app and admins set; the user can read it but not change it.
  pub public_metadata: serde_json::Value,
  /// Whether the account has a password. Accounts created for sign-in by
  /// emailed code may not.
  pub has_password: bool,
  pub last_sign_in_at: Option<chrono::DateTime<chrono::Utc>>,
  pub created_at: chrono::DateTime<chrono::Utc>,
  pub updated_at: chrono::DateTime<chrono::Utc>,
}
