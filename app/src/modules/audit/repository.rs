use super::model::AuditEvent;
use sqlx::PgPool;

pub async fn list(
  pool: &PgPool,
  before: Option<(&str, &str)>,
  limit: u32,
  action: Option<&str>,
  actor: Option<&str>,
) -> Result<Vec<AuditEvent>, sqlx::Error> {
  let (time, id) = before.unwrap_or(("9999-12-31T23:59:59Z", "~"));
  sqlx::query_as(
    "SELECT id,actor_type,actor_id,actor_label,action,resource_type,resource_id,ip_address,metadata::jsonb AS metadata,created_at,seq,prev_hash,record_hash \
     FROM audit_events \
     WHERE (created_at < $1 OR (created_at = $1 AND id < $2)) \
       AND ($3::TEXT IS NULL OR action = $3) \
       AND ($4::TEXT IS NULL OR actor_id = $4 OR actor_label = $4) \
     ORDER BY created_at DESC, id DESC LIMIT $5",
  )
  .bind(time)
  .bind(id)
  .bind(action)
  .bind(actor)
  .bind(i64::from(limit))
  .fetch_all(pool)
  .await
}
