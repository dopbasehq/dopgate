pub mod backup;
pub mod init;
pub mod keys;
pub mod serve;
pub mod users;

use crate::{
  cli::output,
  config::{ServerConfig, ServerOverrides},
};

use super::InstanceArgs;

/// Exit code for commands that are planned but not built yet.
pub const EXIT_NOT_IMPLEMENTED: i32 = 2;

pub(crate) fn instance_overrides(instance: InstanceArgs) -> ServerOverrides {
  ServerOverrides {
    data_dir: instance.data_dir,
    config_path: instance.config,
    master_key_path: instance.master_key,
    ..Default::default()
  }
}

pub(crate) fn load_config(overrides: &ServerOverrides) -> anyhow::Result<ServerConfig> {
  ServerConfig::load(overrides)
}

/// Report a planned command and return its exit code.
pub(crate) fn planned(
  command: &str,
  json: bool,
) -> i32 {
  if json {
    output::print_error_json(&serde_json::json!({
      "success": false,
      "error": { "NOT_IMPLEMENTED": format!("`dopgate {command}` is planned and not built yet.") }
    }));
  } else {
    output::print_error(&format!(
      "`dopgate {command}` is planned and not built yet. The roadmap in the docs says when it lands."
    ));
  }
  EXIT_NOT_IMPLEMENTED
}
