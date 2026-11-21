//! Password hashing and the password policy.
//!
//! Hashes use Argon2id with the crate defaults and are stored as PHC
//! strings, so the parameters travel with each hash and can be raised later
//! without breaking existing ones.

use std::{num::NonZero, sync::LazyLock, thread};

use argon2::{
  Argon2,
  password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
};
use tokio::{sync::Semaphore, task::JoinError};

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

/// A random password for the root account startup creates: 24 characters
/// from an alphabet without look-alikes, in groups of four.
pub fn generate() -> String {
  const ALPHABET: &[u8] = b"abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let mut bytes = [0_u8; 24];
  getrandom::fill(&mut bytes).expect("the system random number generator failed");
  let characters: Vec<char> = bytes
    .iter()
    .map(|byte| ALPHABET[usize::from(*byte) % ALPHABET.len()] as char)
    .collect();
  characters
    .chunks(4)
    .map(|chunk| chunk.iter().collect::<String>())
    .collect::<Vec<_>>()
    .join("-")
}

/// How many hashes may run at once: one per CPU the process may use. Every
/// hash holds 19 MiB while it runs, and more of them than CPUs would only
/// take turns on the same cores. A burst of sign-ins waits here in line
/// and costs memory for the ones that are running, not for all of them.
///
/// Shared by every request that hashes or checks a password, so a static.
/// Nothing closes it.
static HASHING: LazyLock<Semaphore> = LazyLock::new(|| Semaphore::new(hashing_slots()));

/// The number of hashes that run at the same time.
pub fn hashing_slots() -> usize {
  thread::available_parallelism().map_or(1, NonZero::get)
}

/// Run `work` on a blocking thread once a hashing slot is free: Argon2
/// takes tens of milliseconds of CPU and would stall the async workers.
async fn on_hashing_thread<T: Send + 'static>(
  work: impl FnOnce() -> T + Send + 'static
) -> Result<T, JoinError> {
  // Acquiring fails only on a closed semaphore, and this one never closes.
  // If it ever did, the hash would run without a slot instead of failing.
  let slot = HASHING.acquire().await;
  tokio::task::spawn_blocking(move || {
    // The slot moves into the thread, so it stays taken until the hash is
    // done even when the request that asked for it has gone away.
    let _slot = slot;
    work()
  })
  .await
}

/// Hash on a blocking thread, in a hashing slot.
pub async fn hash_async(password: String) -> anyhow::Result<String> {
  on_hashing_thread(move || hash(&password)).await?
}

/// Verify on a blocking thread, in a hashing slot like [`hash_async`].
pub async fn verify_async(
  password: String,
  stored: String,
) -> bool {
  match on_hashing_thread(move || verify(&password, &stored)).await {
    Ok(matches) => matches,
    // The hashing thread panicked or was cancelled. The password is refused,
    // and the log says it was not a wrong guess.
    Err(error) => {
      tracing::error!(%error, "password verification did not finish");
      false
    }
  }
}

/// Check the policy with an admin-configured minimum length.
pub fn check_policy_with(
  password: &str,
  min_length: usize,
) -> Result<(), PolicyViolation> {
  if password.chars().count() < min_length.max(PASSWORD_MIN_LENGTH) {
    return Err(PolicyViolation(format!(
      "Use at least {} characters.",
      min_length.max(PASSWORD_MIN_LENGTH)
    )));
  }
  check_policy(password)
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
