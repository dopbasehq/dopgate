use anyhow::Result;
use zeroize::Zeroizing;

use super::{init::password_from_stdin, instance_overrides, load_config};
use crate::{
  cli::{AdminCommand, ResetPasswordArgs, output},
  config::redact_database_url,
  modules::admins,
  server::prepare_instance,
  services::password,
};

pub async fn run(
  command: AdminCommand,
  json: bool,
) -> Result<i32> {
  match command {
    AdminCommand::ResetPassword(args) => reset_password(args, json).await,
  }
}

/// Reset the password of root or an admin. Whoever can reach the database
/// can do this, the same as `init`.
async fn reset_password(
  args: ResetPasswordArgs,
  json: bool,
) -> Result<i32> {
  // Read before connecting, so a broken pipe fails without touching the
  // database. DOPGATE_ROOT_PASSWORD is ignored on purpose: it often stays
  // set from the first start, and a reset that reused it would change
  // nothing.
  let chosen = args.password_stdin;
  let new_password = Zeroizing::new(if chosen {
    password_from_stdin()?
  } else {
    password::generate()
  });
  let config = load_config(&instance_overrides(args.instance))?;
  if !json {
    output::print_error(&format!(
      "Instance: {} (schema {})",
      redact_database_url(&config.database_url),
      config.database_schema
    ));
  }
  let db = prepare_instance(&config).await?;
  let result = admins::service::reset_password(&db, &args.email, &new_password).await;
  db.close().await;
  let reset = result?;
  if json {
    let mut data = serde_json::json!({
      "adminId": reset.admin_id,
      "email": reset.email,
      "role": reset.role.as_str(),
      "sessionsEnded": reset.sessions_ended,
    });
    if !chosen {
      data["password"] = serde_json::Value::String(new_password.to_string());
    }
    output::print_json(&serde_json::json!({ "success": true, "data": data }));
    return Ok(0);
  }
  output::print_success(&format!("Password reset for {}.", reset.email));
  if !chosen {
    output::print_info(&format!(
      "\nNew password, shown once:\n\n  {}\n\nSign in with it, then change it on the console's Account page.",
      new_password.as_str()
    ));
  }
  output::print_info(&format!(
    "{} console session{} ended.",
    reset.sessions_ended,
    if reset.sessions_ended == 1 { "" } else { "s" }
  ));
  if reset.disabled {
    output::print_info("This admin is disabled, so it still can't sign in until root enables it.");
  }
  Ok(0)
}
