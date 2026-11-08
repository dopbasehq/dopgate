use std::sync::Arc;

use tokio::sync::RwLock;

use crate::{
  config::ServerConfig,
  services::{crypto::CryptoService, db::DbClient, oidc::OidcCache, rate_limit::RateLimiter},
};

#[derive(Clone)]
pub struct AppState {
  pub config: Arc<ServerConfig>,
  pub db: DbClient,
  pub crypto: CryptoService,
  pub setup: Arc<RwLock<SetupState>>,
  pub rate_limiter: RateLimiter,
  pub oidc: OidcCache,
  /// Set while a backup is being restored. API requests get a 503 until it
  /// clears.
  pub maintenance: Arc<std::sync::atomic::AtomicBool>,
  pub started_at: std::time::Instant,
}

/// First-run setup. While no root account exists the server holds a
/// one-time token that `POST /bootstrap/root` must present.
#[derive(Default)]
pub struct SetupState {
  pub token: Option<String>,
}
