//! Owns `email_templates`: the admin overrides.

use chrono::{DateTime, Utc};
use sqlx::{PgExecutor, PgPool};

#[derive(sqlx::FromRow)]
pub struct Override {
  pub name: String,
  pub subject: String,
  pub html: String,
  pub text: String,
  pub updated_at: DateTime<Utc>,
}

pub async fn all(pool: &PgPool) -> Result<Vec<Override>, sqlx::Error> {
  sqlx::query_as("SELECT name, subject, html, text, updated_at FROM email_templates")
    .fetch_all(pool)
    .await
}

pub async fn find(
  executor: impl PgExecutor<'_>,
  name: &str,
) -> Result<Option<Override>, sqlx::Error> {
  sqlx::query_as(
    "SELECT name, subject, html, text, updated_at FROM email_templates WHERE name = $1",
  )
  .bind(name)
  .fetch_optional(executor)
  .await
}

pub async fn upsert(
  executor: impl PgExecutor<'_>,
  name: &str,
  subject: &str,
  html: &str,
  text: &str,
  updated_by: Option<&str>,
) -> Result<(), sqlx::Error> {
  sqlx::query(
    "INSERT INTO email_templates(name,subject,html,text,updated_at,updated_by) VALUES($1,$2,$3,$4,now(),$5) \
     ON CONFLICT(name) DO UPDATE SET subject=excluded.subject, html=excluded.html, text=excluded.text, updated_at=excluded.updated_at, updated_by=excluded.updated_by",
  )
  .bind(name)
  .bind(subject)
  .bind(html)
  .bind(text)
  .bind(updated_by)
  .execute(executor)
  .await
  .map(|_| ())
}

pub async fn delete(
  executor: impl PgExecutor<'_>,
  name: &str,
) -> Result<bool, sqlx::Error> {
  sqlx::query("DELETE FROM email_templates WHERE name = $1")
    .bind(name)
    .execute(executor)
    .await
    .map(|result| result.rows_affected() > 0)
}
