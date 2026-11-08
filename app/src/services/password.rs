//! Password hashing and the password policy.
//!
//! Hashes use Argon2id with the crate defaults and are stored as PHC
//! strings, so the parameters travel with each hash and can be raised later
//! without breaking existing ones.

use argon2::{
  Argon2,
  password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
};

use crate::constants::limits::{PASSWORD_MAX_BYTES, PASSWORD_MIN_LENGTH};

/// Why a password was refused. The message is safe to show to the user.
#[derive(Debug, PartialEq, Eq)]
pub struct PolicyViolation(pub String);

/// Check a new password against the policy before it is hashed.
pub fn check_policy(password: &str) -> Result<(), PolicyViolation> {
  if password.chars().count() < PASSWORD_MIN_LENGTH {
    return Err(PolicyViolation(format!(
      "Use at least {PASSWORD_MIN_LENGTH} characters."
    )));
  }
  if password.len() > PASSWORD_MAX_BYTES {
    return Err(PolicyViolation(format!(
      "Use at most {PASSWORD_MAX_BYTES} bytes."
    )));
  }
  Ok(())
}

pub fn hash(password: &str) -> anyhow::Result<String> {
  let mut salt = [0_u8; 16];
  getrandom::fill(&mut salt)?;
  let salt = SaltString::encode_b64(&salt)
    .map_err(|error| anyhow::anyhow!("password salt encoding failed: {error}"))?;
  Argon2::default()
    .hash_password(password.as_bytes(), &salt)
    .map(|hash| hash.to_string())
    .map_err(|error| anyhow::anyhow!("password hashing failed: {error}"))
}

/// True when `password` matches the stored PHC string. A malformed hash
/// never matches.
pub fn verify(
  password: &str,
  stored: &str,
) -> bool {
  if password.len() > PASSWORD_MAX_BYTES {
    return false;
  }
  PasswordHash::new(stored).is_ok_and(|parsed| {
    Argon2::default()
      .verify_password(password.as_bytes(), &parsed)
      .is_ok()
  })
}
