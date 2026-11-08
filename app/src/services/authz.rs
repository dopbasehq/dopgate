//! Authorization by role.
//!
//! dopgate has three roles. `root` owns the instance and exists exactly
//! once. `admin` manages users and settings. `member` is an end user of
//! your apps and only reaches their own account.

use crate::{
  constants::errors::AUTHORIZATION_DENIED,
  http::HttpError,
  models::{AuthIdentity, Role},
};

/// Admin API access: root, admins, and client secret keys.
pub fn require_admin(identity: &AuthIdentity) -> Result<(), HttpError> {
  match identity {
    AuthIdentity::User { role, .. } if role.is_admin() => Ok(()),
    AuthIdentity::Client { .. } => Ok(()),
    AuthIdentity::User { .. } => Err(denied()),
  }
}

/// Instance-level operations such as restoring a backup or rotating keys.
pub fn require_root(identity: &AuthIdentity) -> Result<(), HttpError> {
  match identity {
    AuthIdentity::User {
      role: Role::Root, ..
    } => Ok(()),
    _ => Err(denied()),
  }
}

/// Whether `actor` may change or delete an account that has `target`.
/// Root manages everyone but itself is managed by nobody. Admins manage
/// members and other admins. Client secret keys act like admins.
pub fn can_manage(
  actor: &AuthIdentity,
  target: Role,
) -> bool {
  let actor_role = match actor {
    AuthIdentity::User { role, .. } => *role,
    AuthIdentity::Client { .. } => Role::Admin,
  };
  match (actor_role, target) {
    (_, Role::Root) => false,
    (Role::Root, _) => true,
    (Role::Admin, _) => true,
    (Role::Member, _) => false,
  }
}

fn denied() -> HttpError {
  HttpError::forbidden(AUTHORIZATION_DENIED, "Your role does not allow this.")
}
