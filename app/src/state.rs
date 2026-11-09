use std::sync::Arc;

use tokio::sync::RwLock;

use crate::{
  config::ServerConfig,
  services::{
    db::DbClient, keys::KeyStore, limits::Limits, oidc::OidcCache, rate_limit::RateLimiter,
  },
};

#[derive(Clone)]
pub struct AppState {
  pub config: Arc<ServerConfig>,
  pub db: DbClient,
  pub setup: Arc<RwLock<SetupState>>,
  /// Locks out an address after repeated wrong setup tokens.
  pub rate_limiter: RateLimiter,
  /// Per-address and per-email request limits for sign-in, sign-up, and
  /// emailed codes.
  pub limits: Limits,
  /// The keys that sign and verify access tokens.
  pub keys: KeyStore,
  pub oidc: OidcCache,
  pub started_at: std::time::Instant,
}

/// First-run setup. While no root account exists the server holds a
/// one-time token that `POST /bootstrap/root` must present.
#[derive(Default)]
pub struct SetupState {
  pub token: Option<String>,
}
