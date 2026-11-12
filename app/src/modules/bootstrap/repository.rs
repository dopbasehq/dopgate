use sqlx::PgConnection;

/// Insert the root account into `admins`. The partial unique index on
/// `admins(role)` refuses a second root. The email counts as verified:
/// whoever runs the server chose it.
pub async fn insert_root(
  connection: &mut PgConnection,
  id: &str,
  email: &str,
  password_hash: &str,
) -> Result<(), sqlx::Error> {
  sqlx::query(
    "INSERT INTO admins(id,email,email_verified_at,password_hash,role,status,created_at,updated_at) VALUES($1,$2,now(),$3,'root','active',now(),now())",
  )
  .bind(id)
  .bind(email)
  .bind(password_hash)
  .execute(connection)
  .await
  .map(|_| ())
}
