use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::{
  modules::auth::model::AuthTokens,
  services::otp::{Method, Purpose},
};

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SendVerificationRequest {
  pub email: String,
  /// `email_verify`, `login` (passwordless sign-in), or `email_change`.
  /// Password resets use `/auth/password/forgot`.
  pub purpose: Purpose,
  pub method: Method,
  /// Where a link leads. Must be one of the client's redirect URLs.
  pub redirect_url: Option<String>,
}

/// Prove the email with the code or the token from the link.
#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmVerificationRequest {
  pub purpose: Purpose,
  /// Required with `code`.
  pub email: Option<String>,
  pub code: Option<String>,
  pub token: Option<String>,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct VerificationResult {
  pub email: String,
  pub purpose: Purpose,
  /// Set for `login`: the user is now signed in.
  pub tokens: Option<AuthTokens>,
}
