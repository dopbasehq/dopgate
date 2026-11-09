pub mod healthcheck;
pub mod init;
pub mod keys;
pub mod serve;

use crate::config::{ServerConfig, ServerOverrides};

use super::InstanceArgs;

pub(crate) fn instance_overrides(instance: InstanceArgs) -> ServerOverrides {
  ServerOverrides {
    database_url: instance.database_url,
    config_path: instance.config,
    ..Default::default()
  }
}

pub(crate) fn load_config(overrides: &ServerOverrides) -> anyhow::Result<ServerConfig> {
  ServerConfig::load(overrides)
}
