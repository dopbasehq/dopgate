use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// What an admin may do. Stored in `admins.role`.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Role {
  /// The instance owner, created at setup. Exactly one exists.
  Root,
  /// Manages users and settings.
  Admin,
}

impl Role {
  pub fn as_str(self) -> &'static str {
    match self {
      Self::Root => "root",
      Self::Admin => "admin",
    }
  }

  pub fn parse(value: &str) -> Option<Self> {
    match value {
      "root" => Some(Self::Root),
      "admin" => Some(Self::Admin),
      _ => None,
    }
  }
}

/// A stored value that is not one its column may hold. Rows decode `role`
/// and `status` through `TryFrom<String>`, so a value Dopgate doesn't know
/// fails the query that read it and is never taken for a default.
#[derive(Debug)]
pub struct UnknownValue {
  column: &'static str,
  value: String,
}

impl UnknownValue {
  pub fn new(
    column: &'static str,
    value: String,
  ) -> Self {
    Self { column, value }
  }
}

impl std::fmt::Display for UnknownValue {
  fn fmt(
    &self,
    formatter: &mut std::fmt::Formatter<'_>,
  ) -> std::fmt::Result {
    write!(formatter, "unknown {} \"{}\"", self.column, self.value)
  }
}

impl std::error::Error for UnknownValue {}

impl TryFrom<String> for Role {
  type Error = UnknownValue;

  fn try_from(value: String) -> Result<Self, Self::Error> {
    Self::parse(&value).ok_or_else(|| UnknownValue::new("role", value))
  }
}

/// Whether an account may sign in. Stored in `status` on admins and users.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum UserStatus {
  Active,
  /// Sign-in is refused and existing sessions stop refreshing.
  Disabled,
}

impl UserStatus {
  pub fn as_str(self) -> &'static str {
    match self {
      Self::Active => "active",
      Self::Disabled => "disabled",
    }
  }

  pub fn parse(value: &str) -> Option<Self> {
    match value {
      "active" => Some(Self::Active),
      "disabled" => Some(Self::Disabled),
      _ => None,
    }
  }
}

impl TryFrom<String> for UserStatus {
  type Error = UnknownValue;

  fn try_from(value: String) -> Result<Self, Self::Error> {
    Self::parse(&value).ok_or_else(|| UnknownValue::new("status", value))
  }
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

/// Root or an admin, as the console and the admin API return it.
#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Admin {
  /// Admin ID with the `adm_` prefix.
  pub id: String,
  pub email: String,
  pub display_name: Option<String>,
  pub avatar_url: Option<String>,
  pub role: Role,
  pub status: UserStatus,
  /// Whether the admin has a password. One without signs in with emailed
  /// codes.
  pub has_password: bool,
  /// Set while the account is locked after wrong passwords.
  pub locked_until: Option<chrono::DateTime<chrono::Utc>>,
  pub last_sign_in_at: Option<chrono::DateTime<chrono::Utc>>,
  pub created_at: chrono::DateTime<chrono::Utc>,
  pub updated_at: chrono::DateTime<chrono::Utc>,
}
