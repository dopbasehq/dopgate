use anyhow::Result;

use super::{instance_overrides, load_config};
use crate::cli::{KeysCommand, output};

pub async fn run(
  command: KeysCommand,
  json: bool,
) -> Result<i32> {
  match command {
    KeysCommand::Rotate(instance) => {
      let mut config = load_config(&instance_overrides(instance))?;
      // Root setup belongs to `serve` and `init`, where its password is shown.
      config.root_email = None;
      let state = crate::server::build_state(config).await?;
      let key = crate::modules::keys::service::rotate(&state, None)
        .await
        .map_err(|error| anyhow::anyhow!("{error}"))?;
      state.db.close().await;
      if json {
        output::print_json(&serde_json::json!({ "success": true, "data": key }));
      } else {
        output::print_success(&format!(
          "New signing key {}. The previous key verifies its tokens for one more day.",
          key.id
        ));
      }
      Ok(0)
    }
  }
}
