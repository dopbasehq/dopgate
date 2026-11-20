use std::io::{IsTerminal, Read};

use anyhow::{Context, Result, bail};
use zeroize::Zeroizing;

use super::{instance_overrides, load_config};
use crate::{
  cli::{CliCancelled, InitArgs, output},
  constants::config::{ENV_ROOT_EMAIL, ENV_ROOT_PASSWORD},
  modules::bootstrap,
  server::{is_initialized, prepare_instance},
};

/// Create the root account without starting the server.
pub async fn run(
  args: InitArgs,
  json: bool,
) -> Result<i32> {
  let config = load_config(&instance_overrides(args.instance))?;
  let db = prepare_instance(&config).await?;
  if is_initialized(db.pool()).await? {
    bail!(
      "this instance already has a root account (schema {})",
      db.schema()
    );
  }
  let email = match args.email.or_else(|| std::env::var(ENV_ROOT_EMAIL).ok()) {
    Some(email) => email,
    None => ask(
      "the root email",
      &format!("pass --email or set {ENV_ROOT_EMAIL}"),
      || inquire::Text::new("Root email:").prompt(),
    )?,
  };
  let password = Zeroizing::new(read_password(args.password_stdin)?);
  let admin_id = bootstrap::service::create_root(&db, &email, &password).await?;
  let email = crate::utils::email::normalize(&email).unwrap_or(email);
  let schema = db.schema().to_owned();
  db.close().await;
  if json {
    output::print_json(&serde_json::json!({
      "success": true,
      "data": { "adminId": admin_id, "email": email, "schema": schema },
    }));
  } else {
    output::print_success(&format!("Root account created for {email}."));
    output::print_info("Start the server with `dopgate serve`.");
  }
  Ok(0)
}

fn read_password(from_stdin: bool) -> Result<String> {
  if let Ok(password) = std::env::var(ENV_ROOT_PASSWORD) {
    return Ok(password);
  }
  if from_stdin {
    let mut password = String::new();
    std::io::stdin()
      .read_to_string(&mut password)
      .context("failed to read the password from standard input")?;
    return Ok(password.trim_end_matches(['\r', '\n']).to_owned());
  }
  ask(
    "the root password",
    &format!("pass --password-stdin or set {ENV_ROOT_PASSWORD}"),
    || {
      inquire::Password::new("Root password:")
        .with_display_mode(inquire::PasswordDisplayMode::Masked)
        .prompt()
    },
  )
}

/// Prompts on the terminal, or fails at once when standard input isn't one.
/// Without the check, inquire falls back to /dev/tty where it exists, so a
/// script run from a shell on macOS would draw a prompt nobody can answer
/// and fail with a vague input-reader error.
fn ask<T>(
  what: &str,
  instead: &str,
  prompt: impl FnOnce() -> Result<T, inquire::InquireError>,
) -> Result<T> {
  if !std::io::stdin().is_terminal() {
    bail!("no terminal to ask for {what} on: {instead}");
  }
  prompt().map_err(|error| match error {
    inquire::InquireError::OperationCanceled | inquire::InquireError::OperationInterrupted => {
      anyhow::Error::new(CliCancelled)
    }
    other => anyhow::Error::new(other),
  })
}
