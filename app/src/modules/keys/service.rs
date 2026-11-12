//! The keys that sign access tokens, and rotation.

use super::{model::*, repository};
use crate::{
  http::HttpError, models::AuthIdentity, modules::audit, services::keys, state::AppState,
};

pub async fn jwks(state: &AppState) -> Jwks {
  let set = state.keys.jwks().await;
  Jwks {
    keys: set["keys"].as_array().cloned().unwrap_or_default(),
  }
}

pub async fn list(state: &AppState) -> Result<Vec<SigningKeyResponse>, HttpError> {
  Ok(repository::list(state.db.pool()).await?)
}

/// Make a new active key. The old one keeps verifying the tokens it signed
/// for a day, then leaves the key set. The console secret is replaced at
/// the same time.
pub async fn rotate(
  state: &AppState,
  actor: Option<&AuthIdentity>,
) -> Result<SigningKeyResponse, HttpError> {
  let key = keys::generate().map_err(|error| {
    tracing::error!(%error, "failed to generate a signing key");
    HttpError::internal()
  })?;
  let mut tx = state.db.pool().begin().await?;
  sqlx::query("LOCK TABLE signing_keys IN SHARE ROW EXCLUSIVE MODE")
    .execute(&mut *tx)
    .await?;
  repository::retire_active(&mut tx).await?;
  keys::insert_active(&mut tx, &key).await?;
  keys::rotate_console_key(&mut tx).await?;
  let event = match actor {
    Some(actor) => audit::service::Event::by(actor, "key.rotated"),
    None => audit::service::Event {
      actor_type: "system",
      actor_id: None,
      actor_label: Some("cli"),
      action: "key.rotated",
      resource_type: None,
      resource_id: None,
      metadata: serde_json::json!({}),
    },
  };
  audit::service::record(&mut tx, event.resource("signing_key", Some(&key.id))).await?;
  let created = repository::find(&mut tx, &key.id).await?;
  tx.commit().await?;
  state.keys.reload(state.db.pool()).await.map_err(|error| {
    tracing::error!(%error, "failed to reload signing keys");
    HttpError::internal()
  })?;
  Ok(created)
}
