use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::Role;

/// Who is calling, as resolved from the `Authorization` header.
#[derive(Clone, Debug)]
pub enum AuthIdentity {
  /// A signed-in user holding a valid access token.
  User {
    user_id: String,
    email: String,
    role: Role,
    session_id: String,
  },
  /// A backend service holding a client secret key. It acts like an admin
  /// and never like a particular user.
  Client { client_id: String },
}

impl AuthIdentity {
  /// The actor type audit records store for this identity.
  pub fn audit_actor_type(&self) -> &'static str {
    match self {
      Self::User { role, .. } => role.as_str(),
      Self::Client { .. } => "client",
    }
  }

  /// The ID audit records store for this identity.
  pub fn actor_id(&self) -> &str {
    match self {
      Self::User { user_id, .. } => user_id,
      Self::Client { client_id } => client_id,
    }
  }
}

/// The claims inside an access token.
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct AccessClaims {
  /// The public URL of this dopgate instance.
  pub iss: String,
  /// The user ID.
  pub sub: String,
  /// The client ID the token was issued to, when the app sent one.
  pub aud: Option<String>,
  pub exp: i64,
  pub iat: i64,
  /// The session ID. Revoking the session stops it refreshing.
  pub sid: String,
  pub email: String,
  pub email_verified: bool,
  pub role: Role,
}
