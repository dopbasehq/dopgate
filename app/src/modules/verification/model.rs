use serde::Deserialize;
use utoipa::ToSchema;

pub use crate::services::otp::Purpose;

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SendCodeRequest {
  pub email: String,
  /// `email_verify` or `login`. Password resets use
  /// `/auth/password/forgot`, email changes `/auth/email/change`.
  pub purpose: Purpose,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmCodeRequest {
  /// The address the code was sent to. For `email_change`, the new address.
  pub email: String,
  /// `email_verify`, `login`, or `email_change`.
  pub purpose: Purpose,
  /// The 6-digit code. Spaces and dashes are ignored.
  pub code: String,
}
