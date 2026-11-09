//! One-time codes sent by email.
//!
//! A code is six digits. Only its SHA-256 hash is stored in
//! `verification_tokens`, each row is single-use, and a code is burned after
//! too many wrong guesses.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::constants::limits::VERIFICATION_CODE_DIGITS;

/// What a code proves.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Purpose {
  /// The user owns the email address on their account.
  EmailVerify,
  /// Sign-in without a password.
  Login,
  /// Moving the account to a new email address.
  EmailChange,
  /// Forgot password.
  PasswordReset,
}

impl Purpose {
  pub fn as_str(self) -> &'static str {
    match self {
      Self::EmailVerify => "email_verify",
      Self::Login => "login",
      Self::EmailChange => "email_change",
      Self::PasswordReset => "password_reset",
    }
  }

  /// The email template that carries this code.
  pub fn template(self) -> &'static str {
    match self {
      Self::EmailVerify => "verify_email",
      Self::Login => "login_code",
      Self::EmailChange => "email_change",
      Self::PasswordReset => "password_reset",
    }
  }
}

/// A random code with a leading-zero-safe fixed width, drawn without modulo
/// bias.
pub fn generate_code() -> String {
  let modulus = 10_u32.pow(VERIFICATION_CODE_DIGITS as u32);
  // Rejection sampling keeps every code equally likely.
  let limit = u32::MAX - (u32::MAX % modulus);
  loop {
    let mut bytes = [0_u8; 4];
    getrandom::fill(&mut bytes).expect("the system random number generator failed");
    let value = u32::from_le_bytes(bytes);
    if value < limit {
      return format!(
        "{:0width$}",
        value % modulus,
        width = VERIFICATION_CODE_DIGITS
      );
    }
  }
}

/// Codes are compared without spaces or dashes, so `482 913` works too.
pub fn normalize_code(code: &str) -> String {
  code
    .chars()
    .filter(|character| character.is_ascii_digit())
    .collect()
}
