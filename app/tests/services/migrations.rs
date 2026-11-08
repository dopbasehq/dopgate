use app::services::db::{DbClient, MIGRATOR};
use tempfile::TempDir;

/// Every down migration reverses its up migration, so the whole set can be
/// rolled back to nothing and applied again.
#[tokio::test]
async fn migrations_apply_roll_back_and_reapply() {
  let directory = TempDir::new().unwrap();
  let url = app::config::sqlite_url(&directory.path().join("test.db"));
  let db = DbClient::connect(&url).await.unwrap();
  db.migrate().await.unwrap();
  MIGRATOR.undo(db.pool(), 0).await.unwrap();
  let tables: i64 = sqlx::query_scalar(
    "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_sqlx%' ESCAPE '\\' AND name NOT LIKE 'sqlite%'",
  )
  .fetch_one(db.pool())
  .await
  .unwrap();
  assert_eq!(tables, 0, "down migrations left tables behind");
  db.migrate().await.unwrap();
}

/// Versions are 14-digit UTC timestamps, unique, with a down file for every
/// up file, as migrations/README.md requires.
#[test]
fn migration_files_follow_the_naming_rules() {
  let mut ups = Vec::new();
  let mut downs = Vec::new();
  for entry in std::fs::read_dir(concat!(env!("CARGO_MANIFEST_DIR"), "/migrations")).unwrap() {
    let name = entry.unwrap().file_name().into_string().unwrap();
    if name == "README.md" {
      continue;
    }
    let (version, rest) = name.split_once('_').unwrap();
    assert_eq!(version.len(), 14, "{name}");
    assert!(version.bytes().all(|byte| byte.is_ascii_digit()), "{name}");
    if let Some(stem) = rest.strip_suffix(".up.sql") {
      ups.push((version.to_owned(), stem.to_owned()));
    } else if let Some(stem) = rest.strip_suffix(".down.sql") {
      downs.push((version.to_owned(), stem.to_owned()));
    } else {
      panic!("unexpected file {name}");
    }
  }
  ups.sort();
  downs.sort();
  assert_eq!(ups, downs);
  let mut versions: Vec<_> = ups.iter().map(|(version, _)| version).collect();
  versions.dedup();
  assert_eq!(versions.len(), ups.len(), "duplicate versions");
}
