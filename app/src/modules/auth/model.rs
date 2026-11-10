use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::models::User;

/// What your app's sign-in screen should offer.
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AuthMethods {
  pub signup_enabled: bool,
  /// Email and password.
  pub password: bool,
  /// Sign-in with an emailed code.
  pub email_otp: bool,
  /// Whether sign-in needs a verified email.
  pub email_verification_required: bool,
  pub branding: crate::modules::settings::model::BrandingSettings,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SignupRequest {
  pub email: String,
  pub password: String,
  pub display_name: Option<String>,
}

/// What sign-up returns.
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SignupResult {
  pub user: User,
  /// Sign-in waits for the emailed code to be confirmed.
  pub verification_required: bool,
  /// A verification code went to the email.
  pub verification_sent: bool,
  /// Tokens, when sign-in does not wait for verification. `null` otherwise:
  /// confirm the code with `/auth/verification/confirm` to get them.
  pub tokens: Option<AuthTokens>,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct LoginRequest {
  pub email: String,
  pub password: String,
}

#[derive(Deserialize, ToSchema, Default)]
#[serde(rename_all = "camelCase")]
pub struct RefreshRequest {
  /// The refresh token. The console leaves it out and sends its cookie.
  pub refresh_token: Option<String>,
}

#[derive(Deserialize, ToSchema, Default)]
#[serde(rename_all = "camelCase")]
pub struct LogoutRequest {
  /// End the session this refresh token belongs to. Works without an access
  /// token, so an app can sign out after the access token expired.
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
  /// Trade it at `/auth/refresh` for new tokens. Each use returns a new
  /// refresh token and retires the old one. `null` in cookie mode, where an
  /// HttpOnly cookie carries it.
  pub refresh_token: Option<String>,
  pub user: User,
}

impl crate::modules::sessions::service::CarriesRefresh for AuthTokens {
  fn take_refresh_token(&mut self) -> Option<String> {
    self.refresh_token.take()
  }
}

/// Fields left out stay as they are. An empty string clears `displayName`
/// or `avatarUrl`.
#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProfileRequest {
  pub display_name: Option<String>,
  pub avatar_url: Option<String>,
  /// Replaces the whole object. Your app decides what goes in it.
  pub user_metadata: Option<serde_json::Value>,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChangePasswordRequest {
  /// Required when the account has a password.
  pub current_password: Option<String>,
  pub new_password: String,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChangeEmailRequest {
  pub new_email: String,
  /// The current password. Required when the account has one, so a stolen
  /// access token alone cannot move the account.
  pub password: Option<String>,
}
