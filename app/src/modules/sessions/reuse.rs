//! A spent refresh token sent again within a few seconds gets the same
//! answer. Two tabs, two servers or a retry after a dropped connection all
//! send the same token at nearly the same moment, and ending the session for
//! that signs the person out for nothing.
//!
//! Refresh tokens are stored only as hashes, so the token handed out the
//! first time can't be looked up again. When a token is spent, the next one
//! is stored sealed with a key derived from the spent token. Only someone
//! who presents the spent token can open it, and only inside the window.

use chrono::{DateTime, Duration, Utc};

use crate::services::secret_box::SecretBox;

/// Keeps these keys apart from every other use of the secret box.
const PURPOSE: &str = "refresh reuse";

/// Seal `next` so that only `spent` opens it.
pub fn seal(
  spent: &str,
  next: &str,
) -> String {
  SecretBox::new(spent, PURPOSE).seal(next)
}

/// The token issued when `spent` was used, if that was at most
/// `window_seconds` before `now`.
pub fn recover(
  spent: &str,
  sealed: Option<&str>,
  used_at: Option<DateTime<Utc>>,
  now: DateTime<Utc>,
  window_seconds: u32,
) -> Option<String> {
  if window_seconds == 0 || now - used_at? > Duration::seconds(i64::from(window_seconds)) {
    return None;
  }
  SecretBox::new(spent, PURPOSE)
    .open(sealed?)
    .ok()
    .map(|next| next.as_str().to_owned())
}
