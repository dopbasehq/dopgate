use app::{
  modules::audit::model::AnchorStatus,
  services::{
    audit_chain::{self, AuditEntry, Retention},
    db::DbClient,
  },
};
use tempfile::TempDir;

async fn database(directory: &TempDir) -> DbClient {
  let url = app::config::sqlite_url(&directory.path().join("test.db"));
  let db = DbClient::connect(&url).await.unwrap();
  db.migrate().await.unwrap();
  db
}

async fn append(
  db: &DbClient,
  id: &str,
  created_at: &str,
) {
  let mut tx = db.pool().begin_with("BEGIN IMMEDIATE").await.unwrap();
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

async fn chain_of_three(directory: &TempDir) -> DbClient {
  let db = database(directory).await;
  let now = chrono::Utc::now();
  for (index, id) in ["aud_1", "aud_2", "aud_3"].iter().enumerate() {
    let at = (now + chrono::Duration::seconds(index as i64)).to_rfc3339();
    append(&db, id, &at).await;
  }
  db
}

#[tokio::test]
async fn intact_chain_verifies() {
  let directory = TempDir::new().unwrap();
  let db = chain_of_three(&directory).await;
  let report = audit_chain::verify(db.pool()).await.unwrap();
  assert!(report.ok);
  assert_eq!(report.records, 3);
  assert_eq!(report.head_seq, Some(3));
  assert!(report.broken.is_none());
}

#[tokio::test]
async fn sealed_records_cannot_be_updated() {
  let directory = TempDir::new().unwrap();
  let db = chain_of_three(&directory).await;
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
  let directory = TempDir::new().unwrap();
  let db = chain_of_three(&directory).await;
  sqlx::query("DROP TRIGGER audit_events_sealed_immutable")
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
  let directory = TempDir::new().unwrap();
  let db = chain_of_three(&directory).await;
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
  let directory = TempDir::new().unwrap();
  let db = chain_of_three(&directory).await;
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
async fn retention_archives_old_records_and_keeps_the_chain_whole() {
  let directory = TempDir::new().unwrap();
  let db = database(&directory).await;
  let old = (chrono::Utc::now() - chrono::Duration::days(400)).to_rfc3339();
  append(&db, "aud_old1", &old).await;
  append(&db, "aud_old2", &old).await;
  append(&db, "aud_new", &chrono::Utc::now().to_rfc3339()).await;

  let archive = directory.path().join("audit-archive");
  let retention = Retention::new(archive.clone(), 365);
  let pruned = audit_chain::apply_retention(db.pool(), &retention)
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

  let archived: usize = std::fs::read_dir(&archive)
    .unwrap()
    .map(|entry| std::fs::read_to_string(entry.unwrap().path()).unwrap())
    .map(|contents| contents.lines().count())
    .sum();
  assert_eq!(archived, 2);

  let report = audit_chain::verify(db.pool()).await.unwrap();
  assert!(report.ok, "{report:?}");
  assert_eq!(report.pruned_seq, Some(2));
}
