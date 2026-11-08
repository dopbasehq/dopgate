use anyhow::Result;

use super::planned;
use crate::cli::KeysCommand;

pub fn run(
  command: KeysCommand,
  json: bool,
) -> Result<i32> {
  let name = match command {
    KeysCommand::Rotate => "keys rotate",
  };
  Ok(planned(name, json))
}
