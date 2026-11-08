use std::io::Read;

use anyhow::{Context, Result, bail};
use zeroize::Zeroizing;

use super::{instance_overrides, load_config};
use crate::{
  cli::{CliCancelled, InitArgs, output},
  constants::config::{ENV_ROOT_EMAIL, ENV_ROOT_PASSWORD},
  modules::bootstrap,
  server::{InstanceLock, is_initialized, prepare_instance},
};

/// Create the root account without starting the server.
pub async fn run(
  args: InitArgs,
  json: bool,
) -> Result<i32> {
  let config = load_config(&instance_overrides(args.instance))?;
  let _lock = InstanceLock::acquire(&config.database_url)?;
  let (db, _crypto) = prepare_instance(&config).await?;
  if is_initialized(db.pool()).await? {
    bail!(
      "this instance already has a root account ({})",
      config.data_dir.display()
    );
  }
  let email = match args.email.or_else(|| std::env::var(ENV_ROOT_EMAIL).ok()) {
    Some(email) => email,
    None => prompt(inquire::Text::new("Root email:").prompt())?,
  };
  let password = Zeroizing::new(read_password(args.password_stdin)?);
  let user_id = bootstrap::service::create_root(&db, &email, &password).await?;
  let email = crate::utils::email::normalize(&email).unwrap_or(email);
  config.ensure_reference_files()?;
  db.close().await;
  if json {
    output::print_json(&serde_json::json!({
      "success": true,
      "data": { "userId": user_id, "email": email, "dataDir": config.data_dir },
    }));
  } else {
    output::print_success(&format!("Root account created for {email}."));
    output::print_info(&format!(
      "Data directory: {}\nStart the server with `dopgate serve`.",
      config.data_dir.display()
    ));
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
  prompt(
    inquire::Password::new("Root password:")
      .with_display_mode(inquire::PasswordDisplayMode::Masked)
      .prompt(),
  )
}

fn prompt<T>(result: Result<T, inquire::InquireError>) -> Result<T> {
  result.map_err(|error| match error {
    inquire::InquireError::OperationCanceled | inquire::InquireError::OperationInterrupted => {
      anyhow::Error::new(CliCancelled)
    }
    other => anyhow::Error::new(other),
  })
}
