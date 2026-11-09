//! Owns `agents`.

use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::{PgExecutor, PgPool};

use super::model::{Agent, AgentOwner, OwnerKind};
use crate::models::UserStatus;

/// Every agent row comes with its owner's email and status.
const SELECT: &str = "SELECT a.id, a.owner_admin_id, a.owner_user_id, a.name, a.description, a.capabilities, \
  a.last_four, a.status, a.last_used_at, a.created_at, a.updated_at, \
  COALESCE(ad.email, u.email) AS owner_email, COALESCE(ad.status, u.status) AS owner_status \
  FROM agents a LEFT JOIN admins ad ON ad.id = a.owner_admin_id LEFT JOIN users u ON u.id = a.owner_user_id";

#[derive(Clone, Debug, sqlx::FromRow)]
pub struct AgentRow {
  pub id: String,
  pub owner_admin_id: Option<String>,
  pub owner_user_id: Option<String>,
  pub name: String,
  pub description: Option<String>,
  pub capabilities: Value,
  pub last_four: String,
  pub status: String,
  pub last_used_at: Option<DateTime<Utc>>,
  pub created_at: DateTime<Utc>,
  pub updated_at: DateTime<Utc>,
  pub owner_email: String,
  pub owner_status: String,
}

impl AgentRow {
  pub fn owner_id(&self) -> &str {
    self
      .owner_admin_id
      .as_deref()
      .or(self.owner_user_id.as_deref())
      .unwrap_or_default()
  }

  pub fn is_active(&self) -> bool {
    self.status == "active"
  }

  pub fn owner_is_active(&self) -> bool {
    self.owner_status == "active"
  }

  pub fn to_agent(&self) -> Agent {
    Agent {
      id: self.id.clone(),
      name: self.name.clone(),
      description: self.description.clone(),
      owner: AgentOwner {
        id: self.owner_id().to_owned(),
        kind: if self.owner_admin_id.is_some() {
          OwnerKind::Admin
        } else {
          OwnerKind::User
        },
        email: self.owner_email.clone(),
      },
      capabilities: self.capabilities.clone(),
      status: if self.is_active() {
        UserStatus::Active
      } else {
        UserStatus::Disabled
      },
      last_four: self.last_four.clone(),
      last_used_at: self.last_used_at,
      created_at: self.created_at,
      updated_at: self.updated_at,
    }
  }
}

pub struct NewAgent<'a> {
  pub id: &'a str,
  pub owner_admin_id: Option<&'a str>,
  pub owner_user_id: Option<&'a str>,
  pub name: &'a str,
  pub description: Option<&'a str>,
  pub capabilities: &'a Value,
  pub token_hash: &'a [u8],
  pub last_four: &'a str,
}

/// Insert an agent. A name its owner already uses surfaces as a unique
/// violation.
pub async fn insert(
  executor: impl PgExecutor<'_>,
  agent: &NewAgent<'_>,
) -> Result<(), sqlx::Error> {
  sqlx::query(
    "INSERT INTO agents(id,owner_admin_id,owner_user_id,name,description,capabilities,token_hash,last_four,status,created_at,updated_at) \
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,'active',now(),now())",
  )
  .bind(agent.id)
  .bind(agent.owner_admin_id)
  .bind(agent.owner_user_id)
  .bind(agent.name)
  .bind(agent.description)
  .bind(agent.capabilities)
  .bind(agent.token_hash)
  .bind(agent.last_four)
  .execute(executor)
  .await
  .map(|_| ())
}

pub async fn find_by_id(
  executor: impl PgExecutor<'_>,
  id: &str,
) -> Result<Option<AgentRow>, sqlx::Error> {
  sqlx::query_as(&format!("{SELECT} WHERE a.id = $1"))
    .bind(id)
    .fetch_optional(executor)
    .await
}

pub async fn find_by_hash(
  pool: &PgPool,
  token_hash: &[u8],
) -> Result<Option<AgentRow>, sqlx::Error> {
  sqlx::query_as(&format!("{SELECT} WHERE a.token_hash = $1"))
    .bind(token_hash)
    .fetch_optional(pool)
    .await
}

pub async fn count_for_user(
  executor: impl PgExecutor<'_>,
  user_id: &str,
) -> Result<i64, sqlx::Error> {
  sqlx::query_scalar("SELECT COUNT(*) FROM agents WHERE owner_user_id = $1")
    .bind(user_id)
    .fetch_one(executor)
    .await
}

pub struct ListFilter<'a> {
  /// An admin or user ID.
  pub owner: Option<&'a str>,
  pub status: Option<UserStatus>,
  /// Matches the name.
  pub search: Option<&'a str>,
  /// Rows strictly older than this (created_at, id).
  pub before: Option<(DateTime<Utc>, &'a str)>,
  pub limit: i64,
}

/// Agents newest first.
pub async fn list(
  pool: &PgPool,
  filter: &ListFilter<'_>,
) -> Result<Vec<AgentRow>, sqlx::Error> {
  let pattern = filter.search.map(|search| {
    format!(
      "%{}%",
      search
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
    )
  });
  let (before_time, before_id) = match filter.before {
    Some((time, id)) => (Some(time), Some(id)),
    None => (None, None),
  };
  sqlx::query_as(&format!(
    "{SELECT} \
     WHERE ($1::TEXT IS NULL OR a.owner_admin_id = $1 OR a.owner_user_id = $1) \
       AND ($2::TEXT IS NULL OR a.status = $2) \
       AND ($3::TEXT IS NULL OR a.name ILIKE $3) \
       AND ($4::TIMESTAMPTZ IS NULL OR (a.created_at, a.id) < ($4, $5)) \
     ORDER BY a.created_at DESC, a.id DESC LIMIT $6"
  ))
  .bind(filter.owner)
  .bind(filter.status.map(UserStatus::as_str))
  .bind(pattern)
  .bind(before_time)
  .bind(before_id)
  .bind(filter.limit)
  .fetch_all(pool)
  .await
}

/// `None` leaves a field as it is; `Some(None)` clears the description.
#[derive(Default)]
pub struct AgentChanges {
  pub name: Option<String>,
  pub description: Option<Option<String>>,
  pub capabilities: Option<Value>,
}

pub async fn update(
  executor: impl PgExecutor<'_>,
  id: &str,
  changes: &AgentChanges,
) -> Result<(), sqlx::Error> {
  sqlx::query(
    "UPDATE agents SET \
       name = COALESCE($2, name), \
       description = CASE WHEN $3 THEN $4 ELSE description END, \
       capabilities = COALESCE($5, capabilities), \
       updated_at = now() \
     WHERE id = $1",
  )
  .bind(id)
  .bind(changes.name.as_deref())
  .bind(changes.description.is_some())
  .bind(changes.description.clone().flatten())
  .bind(changes.capabilities.as_ref())
  .execute(executor)
  .await
  .map(|_| ())
}

pub async fn set_token(
  executor: impl PgExecutor<'_>,
  id: &str,
  token_hash: &[u8],
  last_four: &str,
) -> Result<(), sqlx::Error> {
  sqlx::query("UPDATE agents SET token_hash = $2, last_four = $3, updated_at = now() WHERE id = $1")
    .bind(id)
    .bind(token_hash)
    .bind(last_four)
    .execute(executor)
    .await
    .map(|_| ())
}

pub async fn set_status(
  executor: impl PgExecutor<'_>,
  id: &str,
  status: UserStatus,
) -> Result<(), sqlx::Error> {
  sqlx::query("UPDATE agents SET status = $2, updated_at = now() WHERE id = $1")
    .bind(id)
    .bind(status.as_str())
    .execute(executor)
    .await
    .map(|_| ())
}

pub async fn delete(
  executor: impl PgExecutor<'_>,
  id: &str,
) -> Result<bool, sqlx::Error> {
  sqlx::query("DELETE FROM agents WHERE id = $1")
    .bind(id)
    .execute(executor)
    .await
    .map(|result| result.rows_affected() > 0)
}

/// Note a use, at most once a minute, so a busy agent doesn't write on every
/// trade.
pub async fn touch(
  pool: &PgPool,
  id: &str,
) -> Result<(), sqlx::Error> {
  sqlx::query(
    "UPDATE agents SET last_used_at = now() \
     WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')",
  )
  .bind(id)
  .execute(pool)
  .await
  .map(|_| ())
}
