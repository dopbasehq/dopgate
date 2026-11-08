use super::model::AuditEvent;
use sqlx::SqlitePool;

pub async fn list(
  pool: &SqlitePool,
  before: Option<(&str, &str)>,
  limit: u32,
  action: Option<&str>,
  actor: Option<&str>,
) -> Result<Vec<AuditEvent>, sqlx::Error> {
  let (time, id) = before.unwrap_or(("9999-12-31T23:59:59Z", "~"));
  sqlx::query_as("SELECT id,actor_type,actor_id,actor_label,action,resource_type,resource_id,ip_address,json(metadata) AS metadata,created_at,seq,prev_hash,record_hash FROM audit_events WHERE (created_at < ? OR (created_at = ? AND id < ?)) AND (? IS NULL OR action=?) AND (? IS NULL OR actor_id=? OR actor_label=?) ORDER BY created_at DESC,id DESC LIMIT ?")
    .bind(time).bind(time).bind(id).bind(action).bind(action).bind(actor).bind(actor).bind(actor)
    .bind(limit)
    .fetch_all(pool)
    .await
}
