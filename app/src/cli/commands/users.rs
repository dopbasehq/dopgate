use anyhow::Result;

use super::planned;
use crate::cli::UsersCommand;

pub fn run(
  command: UsersCommand,
  json: bool,
) -> Result<i32> {
  let name = match command {
    UsersCommand::Export { .. } => "users export",
    UsersCommand::Import { .. } => "users import",
  };
  Ok(planned(name, json))
}
