use sqlx::SqliteConnection;

/// Insert the root account. The partial unique index on `users(role)`
/// refuses a second root.
pub async fn insert_root(
  connection: &mut SqliteConnection,
  id: &str,
  email: &str,
  password_hash: &str,
  now: &str,
) -> Result<(), sqlx::Error> {
  sqlx::query(
    "INSERT INTO users(id,email,email_verified_at,password_hash,role,status,created_at,updated_at) VALUES(?,?,NULL,?,'root','active',?,?)",
  )
  .bind(id)
  .bind(email)
  .bind(password_hash)
  .bind(now)
  .bind(now)
  .execute(connection)
  .await
  .map(|_| ())
}
