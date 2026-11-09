use super::{model::*, repository};
use crate::{
  constants::{errors::REQUEST_INVALID, tokens::AUDIT_EVENT_ID_PREFIX},
  http::HttpError,
  services::{audit_chain, client_ip, token},
  state::AppState,
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use sqlx::PgConnection;

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

impl<'a> Event<'a> {
  /// An event caused by a signed-in user or the service key.
  pub fn by(
    actor: &'a crate::models::AuthIdentity,
    action: &'a str,
  ) -> Self {
    Self {
      actor_type: actor.audit_actor_type(),
      actor_id: actor.actor_id(),
      actor_label: Some(actor.actor_label()),
      action,
      resource_type: None,
      resource_id: None,
      metadata: serde_json::json!({}),
    }
  }

  /// An event caused by an admin or a user acting on their own account,
  /// such as a sign-in, before an identity exists for the request.
  /// `actor_type` is `user`, or the admin's role.
  pub fn account(
    realm: crate::models::Realm,
    account_id: &'a str,
    email: &'a str,
    actor_type: &'a str,
    action: &'a str,
  ) -> Self {
    Self {
      actor_type,
      actor_id: Some(account_id),
      actor_label: Some(email),
      action,
      resource_type: Some(realm.resource()),
      resource_id: Some(account_id),
      metadata: serde_json::json!({}),
    }
  }

  /// An event caused by a user of your app acting on their own account.
  pub fn user(
    user_id: &'a str,
    email: &'a str,
    action: &'a str,
  ) -> Self {
    Self::account(crate::models::Realm::App, user_id, email, "user", action)
  }

  /// An event with no signed-in actor, such as a failed sign-in.
  pub fn anonymous(
    label: &'a str,
    action: &'a str,
  ) -> Self {
    Self {
      actor_type: "anonymous",
      actor_id: None,
      actor_label: Some(label),
      action,
      resource_type: None,
      resource_id: None,
      metadata: serde_json::json!({}),
    }
  }

  pub fn resource(
    mut self,
    kind: &'a str,
    id: Option<&'a str>,
  ) -> Self {
    self.resource_type = Some(kind);
    self.resource_id = id;
    self
  }

  pub fn metadata(
    mut self,
    metadata: serde_json::Value,
  ) -> Self {
    self.metadata = metadata;
    self
  }
}

/// Record an event in its own transaction, for events with no change to
/// commit alongside, such as a failed sign-in. Failures are logged, never
/// returned: a lost audit write must not turn into a confusing API error.
pub async fn record_now(
  pool: &sqlx::PgPool,
  event: Event<'_>,
) {
  let result = async {
    let mut tx = pool.begin().await?;
    record(&mut tx, event).await?;
    tx.commit().await
  }
  .await;
  if let Err(error) = result {
    tracing::error!(%error, "failed to write an audit event");
  }
}

/// Append an event to the audit chain. Call it inside the transaction that
/// makes the change, after its first write, so the event and the change
/// commit together.
pub async fn record(
  connection: &mut PgConnection,
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
      created_at: &audit_chain::timestamp(chrono::Utc::now()),
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
