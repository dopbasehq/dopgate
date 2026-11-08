//! The `dopgate` command line.

mod args;
pub mod commands;
pub mod output;

pub use args::{
  BackupCommand, Cli, Command, InitArgs, InstanceArgs, KeysCommand, ServeArgs, UsersCommand,
};

use anyhow::Result;
use clap::Parser;

/// The user cancelled an interactive prompt.
#[derive(Debug)]
pub struct CliCancelled;

impl std::fmt::Display for CliCancelled {
  fn fmt(
    &self,
    formatter: &mut std::fmt::Formatter<'_>,
  ) -> std::fmt::Result {
    formatter.write_str("Cancelled.")
  }
}

impl std::error::Error for CliCancelled {}

impl Cli {
  pub fn parse_args() -> Self {
    Self::parse()
  }
}

/// Run a command and return the process exit code.
pub async fn execute(cli: Cli) -> Result<i32> {
  let json = cli.json;
  match cli.command {
    Command::Serve(args) => commands::serve::run(args).await,
    Command::Init(args) => commands::init::run(args, json).await,
    Command::Backup(command) => commands::backup::run(command, json),
    Command::Users(command) => commands::users::run(command, json),
    Command::Keys(command) => commands::keys::run(command, json),
  }
}
