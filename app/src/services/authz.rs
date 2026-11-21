//! Authorization.
//!
//! Admins and users are separate accounts. Root owns the instance and
//! exists exactly once; admins manage users and settings. The service key
//! acts like an admin. Users only reach their own account, through
//! `/api/v1/auth`.

use crate::{
  constants::errors::AUTHORIZATION_DENIED,
  http::HttpError,
  models::{AuthIdentity, Role},
};

/// Admin API access: root, admins, and the service key.
pub fn require_admin(identity: &AuthIdentity) -> Result<(), HttpError> {
  if identity.is_admin() {
    Ok(())
  } else {
    Err(HttpError::forbidden(
      AUTHORIZATION_DENIED,
      "Only admins and the service key can do this.",
    ))
  }
}

/// Instance-level operations such as rotating keys and managing admins.
pub fn require_root(identity: &AuthIdentity) -> Result<(), HttpError> {
  if identity.admin_role() == Some(Role::Root) {
    Ok(())
  } else {
    Err(HttpError::forbidden(
      AUTHORIZATION_DENIED,
      "Only the root account can do this.",
    ))
  }
}
