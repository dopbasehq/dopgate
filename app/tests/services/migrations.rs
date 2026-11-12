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

/// An instance from before the split keeps working: root and admins move
/// from `users` to `admins` with their passwords, members stay, the setting
/// an admin saved still names them, and rolling back puts everyone where
/// they were.
#[tokio::test]
async fn the_admin_split_moves_existing_accounts() {
  let (db, _guard) = support::database().await;
  let pool = db.pool();
  MIGRATOR.undo(pool, 20261109080010).await.unwrap();
  for (id, email, role) in [
    ("usr_root", "root@example.com", "root"),
    ("usr_ana", "ana@example.com", "admin"),
    ("usr_ada", "ada@example.com", "member"),
  ] {
    sqlx::query(
      "INSERT INTO users(id,email,password_hash,role,status,created_at,updated_at) VALUES($1,$2,'hash',$3,'active',now(),now())",
    )
    .bind(id)
    .bind(email)
    .bind(role)
    .execute(pool)
    .await
    .unwrap();
  }
  sqlx::query(
    "INSERT INTO settings(key,value,updated_at,updated_by) VALUES('test','{}',now(),'usr_ana')",
  )
  .execute(pool)
  .await
  .unwrap();
  db.migrate().await.unwrap();

  let admins: Vec<(String, String, Option<String>)> =
    sqlx::query_as("SELECT id, role, password_hash FROM admins ORDER BY id")
      .fetch_all(pool)
      .await
      .unwrap();
  assert_eq!(
    admins,
    [
      (
        "adm_ana".to_owned(),
        "admin".to_owned(),
        Some("hash".to_owned())
      ),
      (
        "adm_root".to_owned(),
        "root".to_owned(),
        Some("hash".to_owned())
      ),
    ]
  );
  let users: Vec<String> = sqlx::query_scalar("SELECT id FROM users")
    .fetch_all(pool)
    .await
    .unwrap();
  assert_eq!(users, ["usr_ada"]);
  assert_eq!(saved_by(pool).await.as_deref(), Some("adm_ana"));

  MIGRATOR.undo(pool, 20261109080010).await.unwrap();
  let restored: Vec<(String, String)> = sqlx::query_as("SELECT id, role FROM users ORDER BY id")
    .fetch_all(pool)
    .await
    .unwrap();
  assert_eq!(
    restored,
    [
      ("usr_ada".to_owned(), "member".to_owned()),
      ("usr_ana".to_owned(), "admin".to_owned()),
      ("usr_root".to_owned(), "root".to_owned()),
    ]
  );
  assert_eq!(saved_by(pool).await.as_deref(), Some("usr_ana"));
}

async fn saved_by(pool: &sqlx::PgPool) -> Option<String> {
  sqlx::query_scalar("SELECT updated_by FROM settings WHERE key = 'test'")
    .fetch_one(pool)
    .await
    .unwrap()
}

/// After the split an admin and a user can share an email, which `users`
/// can't hold. Rolling back stops with an error instead of dropping one.
#[tokio::test]
async fn rolling_back_the_admin_split_refuses_to_drop_a_shared_email() {
  let (db, _guard) = support::database().await;
  let pool = db.pool();
  for statement in [
    "INSERT INTO admins(id,email,role,status,created_at,updated_at) VALUES('adm_ana','ana@example.com','admin','active',now(),now())",
    "INSERT INTO users(id,email,status,created_at,updated_at) VALUES('usr_ana','ana@example.com','active',now(),now())",
  ] {
    sqlx::query(statement).execute(pool).await.unwrap();
  }
  let error = MIGRATOR.undo(pool, 20261109080010).await.unwrap_err();
  assert!(error.to_string().contains("cannot roll back"), "{error}");
  let admins: i64 = sqlx::query_scalar("SELECT count(*) FROM admins")
    .fetch_one(pool)
    .await
    .unwrap();
  assert_eq!(admins, 1);
}
