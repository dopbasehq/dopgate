//! Checks a new password against passwords known from data breaches.
//!
//! The list is Pwned Passwords, asked through its range API. This server
//! hashes the password with SHA-1 and sends the first five characters of
//! the hash. The answer is every hash on the list that starts with those
//! five, and the comparison happens here. The password, and the rest of its
//! hash, never leave this server.
//!
//! The check never stands in the way of a sign-up: when the list can't be
//! reached in time, the password is accepted and a warning is logged.

use std::{sync::Arc, time::Duration};

use sha1::{Digest, Sha1};

/// Where the list is asked by default.
pub const DEFAULT_URL: &str = "https://api.pwnedpasswords.com";
/// How long one lookup may take before the password is let through.
const TIMEOUT: Duration = Duration::from_secs(2);
/// How many characters of the hash are sent.
const PREFIX_LENGTH: usize = 5;

#[derive(Clone)]
pub struct LeakedPasswords {
  http: reqwest::Client,
  /// Shared, so cloning the app state for a request copies no text.
  base: Option<Arc<str>>,
}

impl LeakedPasswords {
  /// `base_url` is where the range API lives. `None` turns the lookup off,
  /// whatever the settings say. Fails when the HTTP client can't be built,
  /// such as when the TLS backend doesn't start.
  pub fn new(base_url: Option<&str>) -> Result<Self, reqwest::Error> {
    let http = reqwest::Client::builder()
      .timeout(TIMEOUT)
      .user_agent("dopgate")
      .build()?;
    Ok(Self {
      http,
      base: base_url.map(|url| Arc::from(url.trim_end_matches('/'))),
    })
  }

  /// Whether `password` is on the list. An unreachable list answers `false`.
  pub async fn contains(
    &self,
    password: &str,
  ) -> bool {
    let Some(base) = &self.base else {
      return false;
    };
    let hash = hex::encode_upper(Sha1::digest(password.as_bytes()));
    let (prefix, suffix) = hash.split_at(PREFIX_LENGTH);
    match self.range(base, prefix).await {
      Ok(range) => listed(&range, suffix),
      Err(reason) => {
        tracing::warn!(%reason, "could not ask the leaked password list; the password was accepted");
        false
      }
    }
  }

  async fn range(
    &self,
    base: &str,
    prefix: &str,
  ) -> Result<String, String> {
    let response = self
      .http
      .get(format!("{base}/range/{prefix}"))
      // Asks for a padded answer, so its size says nothing about the prefix.
      .header("Add-Padding", "true")
      .send()
      .await
      .map_err(|error| error.without_url().to_string())?;
    if !response.status().is_success() {
      return Err(format!("the list answered {}", response.status()));
    }
    response
      .text()
      .await
      .map_err(|error| error.without_url().to_string())
  }
}

/// Whether a range answer lists `suffix`, the rest of a hash after its
/// first five characters. Each line is `SUFFIX:COUNT`. Padding lines have a
/// count of 0 and match nothing.
pub fn listed(
  range: &str,
  suffix: &str,
) -> bool {
  range
    .lines()
    .filter_map(|line| line.trim().split_once(':'))
    .any(|(listed, count)| {
      listed.eq_ignore_ascii_case(suffix) && count.trim().parse::<u64>().is_ok_and(|seen| seen > 0)
    })
}
