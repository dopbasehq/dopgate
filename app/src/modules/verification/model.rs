use serde::{Deserialize, Serialize};
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

/// What sending a code returns. The answer is the same whether or not a code
/// went out.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CodeSent {
  /// Seconds before this email can be sent another code. 0 means right away.
  pub retry_after: u64,
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
