use super::{model::*, repository};
use crate::{
  constants::{errors::REQUEST_INVALID, tokens::AUDIT_EVENT_ID_PREFIX},
  http::HttpError,
  services::{audit_chain, client_ip, token},
  state::AppState,
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use sqlx::SqliteConnection;

/// One thing that happened, as a module reports it. The audit chain adds
/// the ID, time, client address, and hashes.
pub struct Event<'a> {
  pub actor_type: &'a str,
  pub actor_id: Option<&'a str>,
  /// A readable name for the actor, usually an email.
  pub actor_label: Option<&'a str>,
  /// Dotted name such as `user.signed_in` or `instance.initialized`.
  pub action: &'a str,
  pub resource_type: Option<&'a str>,
  pub resource_id: Option<&'a str>,
  pub metadata: serde_json::Value,
}

/// Append an event to the audit chain. Call it inside the transaction that
/// makes the change, after its first write, so the event and the change
/// commit together.
pub async fn record(
  connection: &mut SqliteConnection,
  event: Event<'_>,
) -> Result<(), sqlx::Error> {
  let ip_address = client_ip::current().map(|address| address.to_string());
  audit_chain::append(
    connection,
    &audit_chain::AuditEntry {
      id: &token::public_id(AUDIT_EVENT_ID_PREFIX),
      actor_type: event.actor_type,
      actor_id: event.actor_id,
      actor_label: event.actor_label,
      action: event.action,
      resource_type: event.resource_type,
      resource_id: event.resource_id,
      ip_address: ip_address.as_deref(),
      metadata: &event.metadata.to_string(),
      created_at: &chrono::Utc::now().to_rfc3339(),
    },
  )
  .await
}

fn decode(value: &str) -> Result<(String, String), HttpError> {
  let bytes = URL_SAFE_NO_PAD
    .decode(value)
    .map_err(|_| HttpError::bad_request(REQUEST_INVALID, "The audit cursor is invalid."))?;
  let value = String::from_utf8(bytes)
    .map_err(|_| HttpError::bad_request(REQUEST_INVALID, "The audit cursor is invalid."))?;
  let (time, id) = value
    .split_once('|')
    .ok_or_else(|| HttpError::bad_request(REQUEST_INVALID, "The audit cursor is invalid."))?;
  Ok((time.into(), id.into()))
}

pub async fn list(
  state: &AppState,
  query: AuditQuery,
) -> Result<AuditPage, HttpError> {
  let limit = query.limit.unwrap_or(50).clamp(1, 200);
  let cursor = query.cursor.as_deref().map(decode).transpose()?;
  let mut items = repository::list(
    state.db.pool(),
    cursor.as_ref().map(|(a, b)| (a.as_str(), b.as_str())),
    limit + 1,
    query.action.as_deref(),
    query.actor.as_deref(),
  )
  .await?;
  let next_cursor = if items.len() > limit as usize {
    items.truncate(limit as usize);
    items
      .last()
      .map(|item| URL_SAFE_NO_PAD.encode(format!("{}|{}", item.created_at, item.id)))
  } else {
    None
  };
  Ok(AuditPage { items, next_cursor })
}

/// Recompute every audit record's hash in sequence order, and compare the
/// log with an outside anchor when one is given.
pub async fn verify(
  state: &AppState,
  query: ChainVerifyQuery,
) -> Result<ChainVerifyReport, HttpError> {
  let anchor = match (query.anchor_seq, query.anchor_hash) {
    (None, None) => None,
    (Some(seq), Some(hash)) if seq > 0 && !hash.is_empty() => {
      Some(audit_chain::Anchor { seq, hash })
    }
    _ => {
      return Err(HttpError::bad_request(
        REQUEST_INVALID,
        "anchorSeq and anchorHash must be given together, with a positive sequence.",
      ));
    }
  };
  let report = audit_chain::verify_against(state.db.pool(), anchor.as_ref()).await?;
  // Every verification also leaves the head in the server log.
  audit_chain::log_checkpoint(state.db.pool()).await;
  Ok(report.into())
}
