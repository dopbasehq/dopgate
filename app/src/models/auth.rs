use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::Role;

/// Who is calling, as resolved from the `Authorization` header.
#[derive(Clone, Debug)]
pub enum AuthIdentity {
  /// Root or an admin, signed in to the console.
  Admin {
    admin_id: String,
    email: String,
    role: Role,
    session_id: String,
  },
  /// A user of your app, signed in with a session or a personal token.
  User {
    user_id: String,
    email: String,
    via: UserVia,
  },
  /// An agent. Its token is for your backend: every Dopgate endpoint
  /// refuses it.
  Agent { agent_id: String, owner_id: String },
  /// The main app's backend holding `DOPGATE_SERVICE_KEY`. It acts like an
  /// admin, never like root or a particular account.
  Service,
}

impl AuthIdentity {
  /// The actor type audit records store for this identity: `root`,
  /// `admin`, `user`, or `service`.
  pub fn audit_actor_type(&self) -> &'static str {
    match self {
      Self::Admin { role, .. } => role.as_str(),
      Self::User { .. } => "user",
      Self::Agent { .. } => "agent",
      Self::Service => "service",
    }
  }

  /// The ID audit records store for this identity.
  pub fn actor_id(&self) -> Option<&str> {
    match self {
      Self::Admin { admin_id, .. } => Some(admin_id),
      Self::User { user_id, .. } => Some(user_id),
      Self::Agent { agent_id, .. } => Some(agent_id),
      Self::Service => None,
    }
  }

  /// A readable name for audit records: the email, or `service`.
  pub fn actor_label(&self) -> &str {
    match self {
      Self::Admin { email, .. } | Self::User { email, .. } => email,
      Self::Agent { agent_id, .. } => agent_id,
      Self::Service => "service",
    }
  }

  /// Whether this identity may use the admin API: an admin, or the service
  /// key.
  pub fn is_admin(&self) -> bool {
    matches!(self, Self::Admin { .. } | Self::Service)
  }

  /// The admin's role, for a signed-in admin.
  pub fn admin_role(&self) -> Option<Role> {
    match self {
      Self::Admin { role, .. } => Some(*role),
      _ => None,
    }
  }

  /// The signed-in admin's ID, if this is an admin.
  pub fn admin_id(&self) -> Option<&str> {
    match self {
      Self::Admin { admin_id, .. } => Some(admin_id),
      _ => None,
    }
  }
}

/// How a user's access token was obtained.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum UserVia {
  /// A password or code sign-in, with this session ID.
  Session(String),
  /// A personal token, with this token ID.
  PersonalToken(String),
}

/// What kind of account an app access token belongs to.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TokenKind {
  /// A person who signed in to your app.
  Human,
  /// An agent, signed in with its token.
  Agent,
}

/// The claims inside an app access token, signed with ES256. Your backend
/// verifies them offline against the JWKS. A person's token carries the
/// email; an agent's carries its owner and capabilities instead.
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct AccessClaims {
  /// The public URL of this Dopgate instance.
  pub iss: String,
  /// The user ID (`usr_`), or the agent ID (`agt_`). Use it as the foreign
  /// key in your own tables.
  pub sub: String,
  pub exp: i64,
  pub iat: i64,
  /// The session ID, for a password or code sign-in. Ending the session
  /// stops it refreshing.
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub sid: Option<String>,
  /// `human` for a person, `agent` for an agent.
  pub kind: TokenKind,
  /// `pat` when the token came from a personal token.
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub via: Option<String>,
  /// The personal token's ID, when `via` is `pat`.
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub tid: Option<String>,
  /// A person's email.
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub email: Option<String>,
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub email_verified: Option<bool>,
  /// An agent's owner: an admin (`adm_`) or a user (`usr_`).
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub owner: Option<String>,
  /// An agent's capabilities: flat key-value pairs your app interprets.
  #[serde(default, skip_serializing_if = "Option::is_none")]
  #[schema(value_type = Option<Object>)]
  pub capabilities: Option<serde_json::Value>,
}

/// The claims inside a console access token. These are signed with HS256
/// and a secret that never leaves Dopgate, so no backend can verify them.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ConsoleClaims {
  pub iss: String,
  /// Always `dopgate-console`.
  pub aud: String,
  /// The admin ID.
  pub sub: String,
  pub exp: i64,
  pub iat: i64,
  /// The console session ID.
  pub sid: String,
  pub role: Role,
  pub email: String,
}
