//! Authorization by role.
//!
//! Dopgate has three roles. `root` owns the instance and exists exactly
//! once. `admin` manages members and settings. `member` is an end user of
//! your app and only reaches their own account. The service key acts like
//! an admin.

use crate::{
  constants::errors::{AUTHORIZATION_DENIED, ROOT_PROTECTED},
  http::HttpError,
  models::{AuthIdentity, Role},
};

/// Admin API access: root, admins, and the service key.
pub fn require_admin(identity: &AuthIdentity) -> Result<(), HttpError> {
  if identity.role().is_admin() {
    Ok(())
  } else {
    Err(denied())
  }
}

/// Instance-level operations such as rotating keys.
pub fn require_root(identity: &AuthIdentity) -> Result<(), HttpError> {
  match identity.role() {
    Role::Root if matches!(identity, AuthIdentity::User { .. }) => Ok(()),
    _ => Err(HttpError::forbidden(
      AUTHORIZATION_DENIED,
      "Only the root account can do this.",
    )),
  }
}

/// Whether `actor` may change, disable, or delete an account with `target`.
/// Nobody manages root through the API. Root manages admins and members.
/// Admins and the service key manage members only.
pub fn check_manage(
  actor: &AuthIdentity,
  target: Role,
) -> Result<(), HttpError> {
  match (actor.role(), target) {
    (_, Role::Root) => Err(HttpError::forbidden(
      ROOT_PROTECTED,
      "The root account can't be changed through the API.",
    )),
    (Role::Root, _) => Ok(()),
    (Role::Admin, Role::Member) => Ok(()),
    _ => Err(HttpError::forbidden(
      AUTHORIZATION_DENIED,
      "Only root can manage admins.",
    )),
  }
}

fn denied() -> HttpError {
  HttpError::forbidden(AUTHORIZATION_DENIED, "Your role does not allow this.")
}
