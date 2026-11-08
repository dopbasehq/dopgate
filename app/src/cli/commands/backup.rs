use anyhow::Result;

use super::planned;
use crate::cli::BackupCommand;

pub fn run(
  command: BackupCommand,
  json: bool,
) -> Result<i32> {
  let name = match command {
    BackupCommand::Create => "backup create",
    BackupCommand::Restore { .. } => "backup restore",
  };
  Ok(planned(name, json))
}
