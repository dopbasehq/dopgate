use serde::Deserialize;
use utoipa::ToSchema;

use crate::services::otp::Method;

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ForgotPasswordRequest {
  pub email: String,
  /// Send a code to type in, or a link to click. Default: link.
  pub method: Option<Method>,
  /// Where the link leads. Must be one of the client's redirect URLs.
  pub redirect_url: Option<String>,
}

/// Prove the reset with the emailed code or the token from the link.
#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ResetPasswordRequest {
  /// Required with `code`.
  pub email: Option<String>,
  pub code: Option<String>,
  pub token: Option<String>,
  pub new_password: String,
}
