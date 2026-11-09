use serde::Deserialize;
use utoipa::ToSchema;

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ForgotPasswordRequest {
  pub email: String,
}

/// Prove the reset with the emailed code.
#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ResetPasswordRequest {
  pub email: String,
  /// The 6-digit code from the email.
  pub code: String,
  pub new_password: String,
}
