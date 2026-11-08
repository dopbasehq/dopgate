use std::path::PathBuf;

use clap::{Args, Parser, Subcommand};

#[derive(Debug, Parser)]
#[command(
  name = "dopgate",
  version,
  about = "Authentication you host yourself",
  long_about = "dopgate signs users up and in, verifies email addresses, resets passwords, and issues JWTs.\nOne binary, one SQLite file."
)]
pub struct Cli {
  /// Print results and errors as JSON.
  #[arg(long, global = true)]
  pub json: bool,
  #[command(subcommand)]
  pub command: Command,
}

#[derive(Debug, Subcommand)]
pub enum Command {
  /// Start the server.
  Serve(ServeArgs),
  /// Create the root account on a new instance.
  Init(InitArgs),
  /// Back up and restore the instance (planned).
  #[command(subcommand)]
  Backup(BackupCommand),
  /// Export and import users (planned).
  #[command(subcommand)]
  Users(UsersCommand),
  /// Manage the keys that sign access tokens (planned).
  #[command(subcommand)]
  Keys(KeysCommand),
}

/// Where the instance keeps its files.
#[derive(Debug, Args)]
pub struct InstanceArgs {
  /// Data directory. Default: ~/.dopgate, or DOPGATE_DATA_DIR.
  #[arg(long, value_name = "PATH")]
  pub data_dir: Option<PathBuf>,
  /// Server configuration file. Default: server.toml in the data directory.
  #[arg(long, value_name = "PATH")]
  pub config: Option<PathBuf>,
  /// Master key file. Default: master.key in the data directory.
  #[arg(long, value_name = "PATH")]
  pub master_key: Option<PathBuf>,
}

#[derive(Debug, Args)]
pub struct ServeArgs {
  #[command(flatten)]
  pub instance: InstanceArgs,
  /// Port to listen on. Default: 8850.
  #[arg(long)]
  pub port: Option<u16>,
  /// Interface to listen on, such as 127.0.0.1 or 0.0.0.0.
  #[arg(long)]
  pub host: Option<String>,
  /// The URL apps and users reach this server on.
  #[arg(long, value_name = "URL")]
  pub public_url: Option<String>,
  /// Serve Swagger UI at /api/docs.
  #[arg(long, value_name = "BOOL")]
  pub docs: Option<bool>,
  /// Serve the Admin UI.
  #[arg(long, value_name = "BOOL")]
  pub web_ui: Option<bool>,
}

#[derive(Debug, Args)]
pub struct InitArgs {
  #[command(flatten)]
  pub instance: InstanceArgs,
  /// Root account email. Default: DOPGATE_ROOT_EMAIL, or a prompt.
  #[arg(long)]
  pub email: Option<String>,
  /// Read the password from standard input instead of prompting.
  /// DOPGATE_ROOT_PASSWORD also works.
  #[arg(long)]
  pub password_stdin: bool,
}

#[derive(Debug, Subcommand)]
pub enum BackupCommand {
  /// Write an encrypted backup to the data directory.
  Create,
  /// Restore a backup file.
  Restore {
    /// Backup file to restore.
    file: PathBuf,
  },
}

#[derive(Debug, Subcommand)]
pub enum UsersCommand {
  /// Write every user to a JSON or CSV file.
  Export {
    /// Output file.
    file: PathBuf,
  },
  /// Create users from a JSON or CSV file.
  Import {
    /// Input file.
    file: PathBuf,
  },
}

#[derive(Debug, Subcommand)]
pub enum KeysCommand {
  /// Start signing with a new key. The old one stays in the JWKS until its
  /// tokens expire.
  Rotate,
}
