use anyhow::Result;

use crate::{
  cli::HealthcheckArgs,
  constants::{
    api,
    config::{DEFAULT_PORT, ENV_PORT},
  },
};

/// GET the health endpoint on 127.0.0.1. Exit code 0 when it answers 200.
pub async fn run(args: HealthcheckArgs) -> Result<i32> {
  let port = args
    .port
    .or_else(|| std::env::var(ENV_PORT).ok()?.parse().ok())
    .unwrap_or(DEFAULT_PORT);
  let url = format!("http://127.0.0.1:{port}{}", api::health::ROOT);
  let healthy = reqwest::Client::builder()
    .timeout(std::time::Duration::from_secs(3))
    .build()?
    .get(&url)
    .send()
    .await
    .is_ok_and(|response| response.status().is_success());
  Ok(if healthy { 0 } else { 1 })
}
