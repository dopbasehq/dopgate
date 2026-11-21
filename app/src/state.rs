use std::sync::Arc;

use tokio::sync::Mutex;

use crate::{
  config::ServerConfig,
  services::{
    db::DbClient, keys::KeyStore, leaked_passwords::LeakedPasswords, limits::Limits,
    oidc::OidcCache, rate_limit::RateLimiter,
  },
};

#[derive(Clone)]
pub struct AppState {
  pub config: Arc<ServerConfig>,
  pub db: DbClient,
  /// The one-time setup token. Shared by every `POST /bootstrap/root`, which
  /// checks the token and clears it as one step, so a mutex. It is an async
  /// one because that request holds it while it creates root: a second
  /// request with the same token waits, then finds the token gone.
  pub setup: Arc<Mutex<SetupState>>,
  /// Locks out an address after repeated wrong setup tokens.
  pub rate_limiter: RateLimiter,
  /// Per-address and per-email request limits for sign-in, sign-up, and
  /// emailed codes.
  pub limits: Limits,
  /// The keys that sign and verify access tokens.
  pub keys: KeyStore,
  pub oidc: OidcCache,
  /// Looks new passwords up in a list of passwords known from breaches.
  pub leaked_passwords: LeakedPasswords,
  pub started_at: std::time::Instant,
}

/// First-run setup. While no root account exists the server holds a
/// one-time token that `POST /bootstrap/root` must present.
#[derive(Default)]
pub struct SetupState {
  pub token: Option<String>,
}
