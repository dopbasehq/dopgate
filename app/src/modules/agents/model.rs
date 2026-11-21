use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

use crate::models::UserStatus;

/// Whether an agent belongs to an admin or to a user.
#[derive(Clone, Copy, Debug, Serialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum OwnerKind {
  Admin,
  User,
}

#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentOwner {
  /// `adm_` or `usr_`.
  pub id: String,
  pub kind: OwnerKind,
  pub email: String,
}

/// An agent. Its token is never shown again after it is made.
#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Agent {
  /// Agent ID with the `agt_` prefix.
  pub id: String,
  pub name: String,
  pub description: Option<String>,
  pub owner: AgentOwner,
  /// Flat key-value pairs your app interprets.
  #[schema(value_type = Object)]
  pub capabilities: serde_json::Value,
  pub status: UserStatus,
  /// The token's last four characters.
  pub last_four: String,
  pub last_used_at: Option<DateTime<Utc>>,
  pub created_at: DateTime<Utc>,
  pub updated_at: DateTime<Utc>,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentPage {
  pub items: Vec<Agent>,
  pub next_cursor: Option<String>,
}

/// An agent with its new token, shown this once.
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentWithToken {
  /// The token, `dga_` and 43 characters. Dopgate keeps only a hash.
  pub token: String,
  pub agent: Agent,
}

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
#[serde(rename_all = "camelCase")]
pub struct AgentQuery {
  /// An admin or user ID: only that owner's agents.
  pub owner: Option<String>,
  pub status: Option<UserStatus>,
  /// Matches the name.
  pub search: Option<String>,
  /// The `nextCursor` of the previous page.
  pub cursor: Option<String>,
  /// 1 to 200. Default: 50.
  pub limit: Option<u32>,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateAgentRequest {
  /// 1 to 64 lowercase letters, digits, and dashes, unique among the
  /// owner's agents.
  pub name: String,
  /// Up to 280 characters, one line. Not in the token.
  pub description: Option<String>,
  /// Flat key-value pairs, 4 KB at most. Default: `{}`.
  #[schema(value_type = Option<Object>)]
  pub capabilities: Option<serde_json::Value>,
}

/// Fields left out stay as they are. An empty description clears it.
#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAgentRequest {
  pub name: Option<String>,
  pub description: Option<String>,
  /// Replaces the whole object.
  #[schema(value_type = Option<Object>)]
  pub capabilities: Option<serde_json::Value>,
}
