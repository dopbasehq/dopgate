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

/// Exit code for commands that are planned but not built yet.
pub const EXIT_NOT_IMPLEMENTED: i32 = 2;

/// Report a planned command and return its exit code.
pub(crate) fn planned(
  command: &str,
  json: bool,
) -> i32 {
  if json {
    crate::cli::output::print_error_json(&serde_json::json!({
      "success": false,
      "error": { "NOT_IMPLEMENTED": format!("`dopgate {command}` is planned and not built yet.") }
    }));
  } else {
    crate::cli::output::print_error(&format!(
      "`dopgate {command}` is planned and not built yet. The roadmap in the docs says when it lands."
    ));
  }
  EXIT_NOT_IMPLEMENTED
}
