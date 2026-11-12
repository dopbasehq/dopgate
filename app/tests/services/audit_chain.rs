use app::{
  modules::audit::model::AnchorStatus,
  services::{
    audit_chain::{self, AuditEntry, Retention},
    db::DbClient,
  },
};

use crate::support::{self, SchemaGuard};

fn at(time: chrono::DateTime<chrono::Utc>) -> String {
  audit_chain::timestamp(time)
}

async fn append(
  db: &DbClient,
  id: &str,
  created_at: &str,
) {
  let mut tx = db.pool().begin().await.unwrap();
  audit_chain::append(
    &mut tx,
    &AuditEntry {
      id,
      actor_type: "system",
      actor_id: None,
      actor_label: Some("test"),
      action: "test.event",
      resource_type: None,
      resource_id: None,
      ip_address: Some("127.0.0.1"),
      metadata: "{}",
      created_at,
    },
  )
  .await
  .unwrap();
  tx.commit().await.unwrap();
}

async fn chain_of_three() -> (DbClient, SchemaGuard) {
  let (db, guard) = support::database().await;
  let now = chrono::Utc::now();
  for (index, id) in ["aud_1", "aud_2", "aud_3"].iter().enumerate() {
    append(&db, id, &at(now + chrono::Duration::seconds(index as i64))).await;
  }
  (db, guard)
}

#[tokio::test]
async fn intact_chain_verifies() {
  let (db, _guard) = chain_of_three().await;
  let report = audit_chain::verify(db.pool()).await.unwrap();
  assert!(report.ok);
  assert_eq!(report.records, 3);
  assert_eq!(report.head_seq, Some(3));
  assert!(report.broken.is_none());
}

#[tokio::test]
async fn sealed_records_cannot_be_updated() {
  let (db, _guard) = chain_of_three().await;
  let error = sqlx::query("UPDATE audit_events SET action='edited' WHERE id='aud_2'")
    .execute(db.pool())
    .await
    .unwrap_err();
  assert!(error.to_string().contains("immutable"));
}

/// Someone with write access can drop the trigger; the hashes still give
/// the edit away.
#[tokio::test]
async fn an_edited_record_breaks_the_chain() {
  let (db, _guard) = chain_of_three().await;
  sqlx::query("DROP TRIGGER audit_events_sealed_immutable ON audit_events")
    .execute(db.pool())
    .await
    .unwrap();
  sqlx::query("UPDATE audit_events SET action='edited' WHERE id='aud_2'")
    .execute(db.pool())
    .await
    .unwrap();
  let report = audit_chain::verify(db.pool()).await.unwrap();
  assert!(!report.ok);
  assert_eq!(report.broken.unwrap().seq, 2);
}

#[tokio::test]
async fn a_deleted_record_breaks_the_chain() {
  let (db, _guard) = chain_of_three().await;
  sqlx::query("DELETE FROM audit_events WHERE id='aud_2'")
    .execute(db.pool())
    .await
    .unwrap();
  let report = audit_chain::verify(db.pool()).await.unwrap();
  assert!(!report.ok);
  assert!(report.broken.is_some());
}

/// Deleting the newest records leaves a chain that verifies on its own; an
/// anchor saved earlier catches it.
#[tokio::test]
async fn an_anchor_catches_deleted_newest_records() {
  let (db, _guard) = chain_of_three().await;
  let before = audit_chain::verify(db.pool()).await.unwrap();
  let anchor = audit_chain::Anchor {
    seq: before.head_seq.unwrap(),
    hash: before.head_hash.unwrap(),
  };
  sqlx::query("DELETE FROM audit_events WHERE id='aud_3'")
    .execute(db.pool())
    .await
    .unwrap();
  assert!(audit_chain::verify(db.pool()).await.unwrap().ok);
  let report = audit_chain::verify_against(db.pool(), Some(&anchor))
    .await
    .unwrap();
  assert!(!report.ok);
  assert_eq!(report.anchor.unwrap().status, AnchorStatus::Missing);
}

#[tokio::test]
async fn retention_removes_old_records_and_keeps_the_chain_whole() {
  let (db, _guard) = support::database().await;
  let old = at(chrono::Utc::now() - chrono::Duration::days(400));
  append(&db, "aud_old1", &old).await;
  append(&db, "aud_old2", &old).await;
  append(&db, "aud_new", &at(chrono::Utc::now())).await;

  let pruned = audit_chain::apply_retention(db.pool(), &Retention::new(365))
    .await
    .unwrap();
  assert_eq!(pruned, 2);

  let remaining: Vec<String> = sqlx::query_scalar("SELECT id FROM audit_events ORDER BY seq")
    .fetch_all(db.pool())
    .await
    .unwrap();
  assert_eq!(remaining[0], "aud_new");
  // Retention records what it removed, as the newest record.
  assert_eq!(remaining.len(), 2);

  let report = audit_chain::verify(db.pool()).await.unwrap();
  assert!(report.ok, "{report:?}");
  assert_eq!(report.pruned_seq, Some(2));
}

/// Moving the anchor forward to hide old records is caught: no
/// `audit.pruned` record vouches for the new position.
#[tokio::test]
async fn a_moved_anchor_fails_verification() {
  let (db, _guard) = chain_of_three().await;
  let hash: String = sqlx::query_scalar("SELECT record_hash FROM audit_events WHERE seq = 2")
    .fetch_one(db.pool())
    .await
    .unwrap();
  sqlx::query("DELETE FROM audit_events WHERE seq <= 2")
    .execute(db.pool())
    .await
    .unwrap();
  sqlx::query(
    "INSERT INTO audit_chain_anchor(id,pruned_seq,pruned_hash,pruned_at) VALUES('chain',2,$1,'x')",
  )
  .bind(hash)
  .execute(db.pool())
  .await
  .unwrap();
  let report = audit_chain::verify(db.pool()).await.unwrap();
  assert!(!report.ok);
}

/// Appends from many connections at once still form one chain.
#[tokio::test]
async fn concurrent_appends_form_one_chain() {
  let (db, _guard) = support::database().await;
  let mut tasks = Vec::new();
  for index in 0..20 {
    let db = db.clone();
    tasks.push(tokio::spawn(async move {
      append(&db, &format!("aud_c{index}"), &at(chrono::Utc::now())).await;
    }));
  }
  for task in tasks {
    task.await.unwrap();
  }
  let report = audit_chain::verify(db.pool()).await.unwrap();
  assert!(report.ok, "{report:?}");
  assert_eq!(report.records, 20);
}
