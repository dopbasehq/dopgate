use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// A new authenticator app secret. Show it as a QR code; it only becomes
/// active after the first code is confirmed.
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TotpEnrollment {
  /// Base32 secret for manual entry.
  pub secret: String,
  /// `otpauth://` URL to render as a QR code.
  pub otpauth_url: String,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TotpCodeRequest {
  /// The six-digit code from the authenticator app, or a recovery code.
  pub code: String,
}

/// Single-use codes for when the authenticator app is lost. Shown once.
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryCodes {
  pub codes: Vec<String>,
}

/// The second step of a sign-in on an account with MFA.
#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MfaChallengeRequest {
  /// The short-lived token the first step returned instead of tokens.
  pub mfa_token: String,
  pub code: String,
}
