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
  /// The main app's backend holding `DOPGATE_SERVICE_KEY`. It acts like an
  /// admin, never like root or a particular user.
  Service,
}

impl AuthIdentity {
  /// The actor type audit records store for this identity.
  pub fn audit_actor_type(&self) -> &'static str {
    match self {
      Self::User { role, .. } => role.as_str(),
      Self::Service => "service",
    }
  }

  /// The ID audit records store for this identity.
  pub fn actor_id(&self) -> Option<&str> {
    match self {
      Self::User { user_id, .. } => Some(user_id),
      Self::Service => None,
    }
  }

  /// A readable name for audit records: the email, or `service`.
  pub fn actor_label(&self) -> &str {
    match self {
      Self::User { email, .. } => email,
      Self::Service => "service",
    }
  }

  /// The role this identity acts with.
  pub fn role(&self) -> Role {
    match self {
      Self::User { role, .. } => *role,
      Self::Service => Role::Admin,
    }
  }

  /// The signed-in user's ID, if this is a user.
  pub fn user_id(&self) -> Option<&str> {
    self.actor_id()
  }
}

/// The claims inside an access token.
#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
pub struct AccessClaims {
  /// The public URL of this Dopgate instance.
  pub iss: String,
  /// The user ID. Use it as the foreign key in your own tables.
  pub sub: String,
  pub exp: i64,
  pub iat: i64,
  /// The session ID. Ending the session stops it refreshing.
  pub sid: String,
  pub email: String,
  pub email_verified: bool,
  pub role: Role,
}
