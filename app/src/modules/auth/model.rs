use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::models::User;

/// What the sign-in screen of your app should offer.
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AuthMethods {
  pub signup_enabled: bool,
  pub password: bool,
  /// Passwordless sign-in with an emailed code.
  pub email_otp: bool,
  /// Passwordless sign-in with an emailed link.
  pub email_link: bool,
  /// Enabled single sign-on providers, by ID.
  pub sso_providers: Vec<String>,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SignupRequest {
  pub email: String,
  pub password: String,
  pub display_name: Option<String>,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct LoginRequest {
  pub email: String,
  pub password: String,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RefreshRequest {
  pub refresh_token: String,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct LogoutRequest {
  /// End the session this refresh token belongs to. Without it, the
  /// session of the access token ends.
  pub refresh_token: Option<String>,
  /// End every session of the account.
  #[serde(default)]
  pub all_sessions: bool,
}

/// What a successful sign-in returns.
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AuthTokens {
  /// A short-lived JWT. Send it as `Authorization: Bearer <token>`.
  pub access_token: String,
  /// Always `Bearer`.
  pub token_type: String,
  /// Seconds until the access token expires.
  pub expires_in: i64,
  /// Exchange it at `/auth/refresh` for new tokens. Each use returns a new
  /// refresh token and retires the old one.
  pub refresh_token: String,
  pub user: User,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProfileRequest {
  pub display_name: Option<String>,
  pub avatar_url: Option<String>,
  /// Replaces the account's public metadata.
  pub public_metadata: Option<serde_json::Value>,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChangePasswordRequest {
  pub current_password: String,
  pub new_password: String,
}
