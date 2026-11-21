use sqlx::PgPool;

/// Whether setup has created the root account.
pub async fn is_initialized(pool: &PgPool) -> Result<bool, sqlx::Error> {
  sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM admins WHERE role = 'root')")
    .fetch_one(pool)
    .await
}
