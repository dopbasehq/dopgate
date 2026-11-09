use app::services::db::MIGRATOR;

use crate::support;

async fn tables_in(
  pool: &sqlx::PgPool,
  schema: &str,
) -> Vec<String> {
  sqlx::query_scalar(
    "SELECT table_name::TEXT FROM information_schema.tables WHERE table_schema = $1 AND table_name <> '_sqlx_migrations' ORDER BY 1",
  )
  .bind(schema)
  .fetch_all(pool)
  .await
  .unwrap()
}

/// Every down migration reverses its up migration, so the whole set can be
/// rolled back to nothing and applied again.
#[tokio::test]
async fn migrations_apply_roll_back_and_reapply() {
  let (db, guard) = support::database().await;
  assert!(!tables_in(db.pool(), &guard.0).await.is_empty());
  MIGRATOR.undo(db.pool(), 0).await.unwrap();
  assert_eq!(
    tables_in(db.pool(), &guard.0).await,
    Vec::<String>::new(),
    "down migrations left tables behind"
  );
  db.migrate().await.unwrap();
}

/// Every table, sqlx's bookkeeping included, lands in dopgate's schema, so
/// an app sharing the database never sees them in `public`.
#[tokio::test]
async fn migrations_stay_inside_the_schema() {
  let (db, guard) = support::database().await;
  let outside: i64 = sqlx::query_scalar(
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('users','sessions','audit_events')",
  )
  .fetch_one(db.pool())
  .await
  .unwrap();
  assert_eq!(outside, 0);
  let bookkeeping: i64 = sqlx::query_scalar(
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = $1 AND table_name = '_sqlx_migrations'",
  )
  .bind(&guard.0)
  .fetch_one(db.pool())
  .await
  .unwrap();
  assert_eq!(bookkeeping, 1);
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
