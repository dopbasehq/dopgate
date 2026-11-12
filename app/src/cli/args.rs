use std::path::PathBuf;

use clap::{Args, Parser, Subcommand};

#[derive(Debug, Parser)]
#[command(
  name = "dopgate",
  version,
  about = "Authentication you host yourself",
  long_about = "Dopgate signs users up and in, verifies email addresses, resets passwords, and issues JWTs.\nOne binary next to your app, with its tables in a PostgreSQL schema."
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
  /// Manage the keys that sign access tokens.
  #[command(subcommand)]
  Keys(KeysCommand),
  /// Check that a server on this machine answers. For container health
  /// checks: exits 0 when healthy, 1 otherwise.
  Healthcheck(HealthcheckArgs),
}

/// Which database the instance uses.
#[derive(Debug, Args)]
pub struct InstanceArgs {
  /// PostgreSQL URL. Default: DOPGATE_DATABASE_URL.
  #[arg(long, value_name = "URL")]
  pub database_url: Option<String>,
  /// Optional TOML configuration file. Default: DOPGATE_CONFIG.
  #[arg(long, value_name = "PATH")]
  pub config: Option<PathBuf>,
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
  /// Serve the admin console at /.
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
pub enum KeysCommand {
  /// Start signing with a new key. The old one stays in the JWKS until its
  /// tokens expire.
  Rotate(InstanceArgs),
}

#[derive(Debug, Args)]
pub struct HealthcheckArgs {
  /// Port the server listens on. Default: DOPGATE_PORT, or 8850.
  #[arg(long)]
  pub port: Option<u16>,
}
