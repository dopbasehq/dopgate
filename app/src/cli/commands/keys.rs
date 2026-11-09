use anyhow::Result;

use super::planned;
use crate::cli::KeysCommand;

/// Key rotation arrives with access tokens.
pub async fn run(
  command: KeysCommand,
  json: bool,
) -> Result<i32> {
  let name = match command {
    KeysCommand::Rotate(_) => "keys rotate",
  };
  Ok(planned(name, json))
}
