//! One-time codes and verification links.
//!
//! Planned (phase 3). A code is a short number sent by email; a link carries
//! a long random token. Only hashes are stored in `verification_tokens`,
//! each row is single-use, and a code is burned after
//! `VERIFICATION_MAX_ATTEMPTS` wrong guesses.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// What a verification proves.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Purpose {
  /// The user owns the email address on their account.
  EmailVerify,
  /// Passwordless sign-in.
  Login,
  /// Moving the account to a new email address.
  EmailChange,
  /// Forgot password.
  PasswordReset,
}

/// How the user receives the proof.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Method {
  /// A numeric code the user types into your app.
  Otp,
  /// A link the user clicks.
  Link,
}
