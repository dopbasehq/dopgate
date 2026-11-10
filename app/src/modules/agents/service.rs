//! Agents: accounts for bots and AI agents, each owned by an admin or a
//! user. Owners make and change their agents; admins can also turn off,
//! turn on, or delete any agent, but only the owner edits one or
//! regenerates its token. Users make agents only after a password or code
//! sign-in, and only while `selfService.agents` is on.

use axum::http::StatusCode;
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use chrono::{DateTime, Utc};

use super::{
  capabilities,
  model::*,
  repository::{self, AgentChanges, AgentRow},
};
use crate::{
  constants::{
    errors::{
      AGENT_NAME_TAKEN, AUTHORIZATION_DENIED, FEATURE_DISABLED, LIMIT_REACHED, NOT_FOUND,
      REQUEST_INVALID,
    },
    tokens::{AGENT_ID_PREFIX, AGENT_TOKEN_PREFIX},
  },
  http::HttpError,
  models::{AuthIdentity, UserStatus},
  modules::{audit, settings},
  services::token,
  state::AppState,
};

const NAME_MAX_CHARS: usize = 64;
const DESCRIPTION_MAX_CHARS: usize = 280;

/// Who an agent is made for.
#[derive(Clone, Copy)]
pub enum Owner<'a> {
  Admin(&'a str),
  User(&'a str),
}

fn not_found() -> HttpError {
  HttpError::not_found(NOT_FOUND, "No agent has this ID.")
}

fn unprocessable(message: &str) -> HttpError {
  HttpError::new(StatusCode::UNPROCESSABLE_ENTITY, REQUEST_INVALID, message)
}

fn feature_off() -> HttpError {
  HttpError::forbidden(
    FEATURE_DISABLED,
    "Agents for users are turned off. Ask an admin to turn them on.",
  )
}

/// 1 to 64 lowercase letters, digits, and dashes.
pub fn clean_name(raw: &str) -> Result<String, HttpError> {
  let name = raw.trim();
  let ok = !name.is_empty()
    && name.chars().count() <= NAME_MAX_CHARS
    && name
      .chars()
      .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
  if !ok {
    return Err(unprocessable(
      "The name must be 1 to 64 lowercase letters, digits, and dashes.",
    ));
  }
  Ok(name.to_owned())
}

/// `Some(None)` clears the description.
fn clean_description(raw: Option<String>) -> Result<Option<Option<String>>, HttpError> {
  let Some(raw) = raw else {
    return Ok(None);
  };
  let value = raw.trim();
  if value.is_empty() {
    return Ok(Some(None));
  }
  if value.chars().count() > DESCRIPTION_MAX_CHARS || value.chars().any(char::is_control) {
    return Err(unprocessable(
      "The description must be one line of at most 280 characters.",
    ));
  }
  Ok(Some(Some(value.to_owned())))
}

fn is_name_taken(error: &sqlx::Error) -> bool {
  error
    .as_database_error()
    .is_some_and(|database| database.is_unique_violation())
}

fn name_taken() -> HttpError {
  HttpError::conflict(
    AGENT_NAME_TAKEN,
    "This owner already has an agent with this name.",
  )
}

/// A new token and what is stored of it.
fn new_token() -> Result<(String, Vec<u8>, String), HttpError> {
  let secret = token::generate(AGENT_TOKEN_PREFIX).map_err(|_| HttpError::internal())?;
  let last_four: String = secret[secret.len() - 4..].to_owned();
  let hash = token::hash(&secret);
  Ok((secret, hash, last_four))
}

pub async fn find(
  state: &AppState,
  id: &str,
) -> Result<AgentRow, HttpError> {
  repository::find_by_id(state.db.pool(), id)
    .await?
    .ok_or_else(not_found)
}

/// One of a user's own agents. Another owner's agent looks like none.
pub async fn find_own(
  state: &AppState,
  user_id: &str,
  id: &str,
) -> Result<AgentRow, HttpError> {
  let row = find(state, id).await?;
  if row.owner_user_id.as_deref() != Some(user_id) {
    return Err(not_found());
  }
  Ok(row)
}

/// Only the owner edits an agent or regenerates its token.
pub fn require_owner(
  actor: &AuthIdentity,
  row: &AgentRow,
) -> Result<(), HttpError> {
  let owns = match actor {
    AuthIdentity::Admin { admin_id, .. } => row.owner_admin_id.as_deref() == Some(admin_id),
    AuthIdentity::User { user_id, .. } => row.owner_user_id.as_deref() == Some(user_id),
    _ => false,
  };
  if owns {
    Ok(())
  } else {
    Err(HttpError::forbidden(
      AUTHORIZATION_DENIED,
      "Only the agent's owner can change it or regenerate its token.",
    ))
  }
}

/// User endpoints that create or change agents need the setting on.
pub async fn require_self_service(state: &AppState) -> Result<(), HttpError> {
  if settings::service::self_service(state.db.pool())
    .await?
    .agents
  {
    Ok(())
  } else {
    Err(feature_off())
  }
}

fn encode_cursor(row: &AgentRow) -> String {
  URL_SAFE_NO_PAD.encode(format!("{}|{}", row.created_at.to_rfc3339(), row.id))
}

fn decode_cursor(value: &str) -> Result<(DateTime<Utc>, String), HttpError> {
  let invalid = || HttpError::bad_request(REQUEST_INVALID, "The cursor is invalid.");
  let bytes = URL_SAFE_NO_PAD.decode(value).map_err(|_| invalid())?;
  let text = String::from_utf8(bytes).map_err(|_| invalid())?;
  let (time, id) = text.split_once('|').ok_or_else(invalid)?;
  let time = DateTime::parse_from_rfc3339(time)
    .map_err(|_| invalid())?
    .with_timezone(&Utc);
  Ok((time, id.to_owned()))
}

pub async fn list(
  state: &AppState,
  query: AgentQuery,
) -> Result<AgentPage, HttpError> {
  let limit = query.limit.unwrap_or(50).clamp(1, 200);
  let cursor = query.cursor.as_deref().map(decode_cursor).transpose()?;
  let search = query
    .search
    .as_deref()
    .map(str::trim)
    .filter(|search| !search.is_empty());
  let mut rows = repository::list(
    state.db.pool(),
    &repository::ListFilter {
      owner: query.owner.as_deref(),
      status: query.status,
      search,
      before: cursor.as_ref().map(|(time, id)| (*time, id.as_str())),
      limit: i64::from(limit) + 1,
    },
  )
  .await?;
  let next_cursor = if rows.len() > limit as usize {
    rows.truncate(limit as usize);
    rows.last().map(encode_cursor)
  } else {
    None
  };
  Ok(AgentPage {
    items: rows.iter().map(AgentRow::to_agent).collect(),
    next_cursor,
  })
}

pub async fn create(
  state: &AppState,
  actor: &AuthIdentity,
  owner: Owner<'_>,
  request: CreateAgentRequest,
) -> Result<AgentWithToken, HttpError> {
  let name = clean_name(&request.name)?;
  let description = clean_description(request.description)?.flatten();
  let capabilities = capabilities::check(
    request
      .capabilities
      .unwrap_or_else(|| serde_json::json!({})),
  )?;
  let (secret, hash, last_four) = new_token()?;
  let id = token::public_id(AGENT_ID_PREFIX);
  let pool = state.db.pool();
  let mut tx = pool.begin().await?;
  if let Owner::User(user_id) = owner {
    let rules = settings::service::self_service(pool).await?;
    if !rules.agents {
      return Err(feature_off());
    }
    // Lock the user so two requests can't both slip under the limit.
    sqlx::query("SELECT 1 FROM users WHERE id = $1 FOR UPDATE")
      .bind(user_id)
      .execute(&mut *tx)
      .await?;
    if repository::count_for_user(&mut *tx, user_id).await? >= i64::from(rules.max_agents_per_user)
    {
      return Err(HttpError::conflict(
        LIMIT_REACHED,
        &format!(
          "You already have {} agents. Delete one first.",
          rules.max_agents_per_user
        ),
      ));
    }
  }
  let (owner_admin_id, owner_user_id) = match owner {
    Owner::Admin(id) => (Some(id), None),
    Owner::User(id) => (None, Some(id)),
  };
  match repository::insert(
    &mut *tx,
    &repository::NewAgent {
      id: &id,
      owner_admin_id,
      owner_user_id,
      name: &name,
      description: description.as_deref(),
      capabilities: &capabilities,
      token_hash: &hash,
      last_four: &last_four,
    },
  )
  .await
  {
    Ok(()) => {}
    Err(error) if is_name_taken(&error) => return Err(name_taken()),
    Err(error) => return Err(error.into()),
  }
  audit::service::record(
    &mut tx,
    audit::service::Event::by(actor, "agent.created")
      .resource("agent", Some(&id))
      .metadata(serde_json::json!({ "name": name })),
  )
  .await?;
  let row = repository::find_by_id(&mut *tx, &id)
    .await?
    .ok_or_else(HttpError::internal)?;
  tx.commit().await?;
  Ok(AgentWithToken {
    token: secret,
    agent: row.to_agent(),
  })
}

/// Change an agent's name, description, or capabilities. The caller has
/// checked that the actor owns it.
pub async fn update(
  state: &AppState,
  actor: &AuthIdentity,
  row: &AgentRow,
  request: UpdateAgentRequest,
) -> Result<Agent, HttpError> {
  let changes = AgentChanges {
    name: request.name.as_deref().map(clean_name).transpose()?,
    description: clean_description(request.description)?,
    capabilities: request.capabilities.map(capabilities::check).transpose()?,
  };
  let mut fields = Vec::new();
  for (field, changed) in [
    ("name", changes.name.is_some()),
    ("description", changes.description.is_some()),
    ("capabilities", changes.capabilities.is_some()),
  ] {
    if changed {
      fields.push(field);
    }
  }
  let mut tx = state.db.pool().begin().await?;
  match repository::update(&mut *tx, &row.id, &changes).await {
    Ok(()) => {}
    Err(error) if is_name_taken(&error) => return Err(name_taken()),
    Err(error) => return Err(error.into()),
  }
  audit::service::record(
    &mut tx,
    audit::service::Event::by(actor, "agent.updated")
      .resource("agent", Some(&row.id))
      .metadata(serde_json::json!({ "fields": fields })),
  )
  .await?;
  let updated = repository::find_by_id(&mut *tx, &row.id)
    .await?
    .ok_or_else(not_found)?;
  tx.commit().await?;
  Ok(updated.to_agent())
}

/// Give the agent a new token. The old one stops working at once.
pub async fn regenerate(
  state: &AppState,
  actor: &AuthIdentity,
  row: &AgentRow,
) -> Result<AgentWithToken, HttpError> {
  let (secret, hash, last_four) = new_token()?;
  let mut tx = state.db.pool().begin().await?;
  repository::set_token(&mut *tx, &row.id, &hash, &last_four).await?;
  audit::service::record(
    &mut tx,
    audit::service::Event::by(actor, "agent.token_regenerated")
      .resource("agent", Some(&row.id))
      .metadata(serde_json::json!({ "name": row.name })),
  )
  .await?;
  let updated = repository::find_by_id(&mut *tx, &row.id)
    .await?
    .ok_or_else(not_found)?;
  tx.commit().await?;
  Ok(AgentWithToken {
    token: secret,
    agent: updated.to_agent(),
  })
}

pub async fn set_status(
  state: &AppState,
  actor: &AuthIdentity,
  row: &AgentRow,
  status: UserStatus,
) -> Result<Agent, HttpError> {
  let mut tx = state.db.pool().begin().await?;
  repository::set_status(&mut *tx, &row.id, status).await?;
  let action = match status {
    UserStatus::Active => "agent.enabled",
    UserStatus::Disabled => "agent.disabled",
  };
  audit::service::record(
    &mut tx,
    audit::service::Event::by(actor, action)
      .resource("agent", Some(&row.id))
      .metadata(serde_json::json!({ "name": row.name, "ownerId": row.owner_id() })),
  )
  .await?;
  let updated = repository::find_by_id(&mut *tx, &row.id)
    .await?
    .ok_or_else(not_found)?;
  tx.commit().await?;
  Ok(updated.to_agent())
}

pub async fn delete(
  state: &AppState,
  actor: &AuthIdentity,
  row: &AgentRow,
) -> Result<(), HttpError> {
  let mut tx = state.db.pool().begin().await?;
  if !repository::delete(&mut *tx, &row.id).await? {
    return Err(not_found());
  }
  audit::service::record(
    &mut tx,
    audit::service::Event::by(actor, "agent.deleted")
      .resource("agent", Some(&row.id))
      .metadata(serde_json::json!({ "name": row.name, "ownerId": row.owner_id() })),
  )
  .await?;
  tx.commit().await?;
  Ok(())
}
