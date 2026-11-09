use app::{
  models::{AuthIdentity, Role},
  services::authz::{require_admin, require_root},
};

fn admin(role: Role) -> AuthIdentity {
  AuthIdentity::Admin {
    admin_id: "adm_1".into(),
    email: "admin@example.com".into(),
    role,
    session_id: "ses_1".into(),
  }
}

fn user() -> AuthIdentity {
  AuthIdentity::User {
    user_id: "usr_1".into(),
    email: "person@example.com".into(),
    session_id: "ses_2".into(),
  }
}

#[test]
fn admin_api_is_for_root_admins_and_the_service_key() {
  assert!(require_admin(&admin(Role::Root)).is_ok());
  assert!(require_admin(&admin(Role::Admin)).is_ok());
  assert!(require_admin(&AuthIdentity::Service).is_ok());
  let error = require_admin(&user()).unwrap_err();
  assert_eq!(error.status, axum::http::StatusCode::FORBIDDEN);
}

#[test]
fn instance_operations_are_for_root_only() {
  assert!(require_root(&admin(Role::Root)).is_ok());
  assert!(require_root(&admin(Role::Admin)).is_err());
  assert!(require_root(&AuthIdentity::Service).is_err());
  assert!(require_root(&user()).is_err());
}

#[test]
fn roles_round_trip_and_name_the_actor() {
  for role in [Role::Root, Role::Admin] {
    assert_eq!(Role::parse(role.as_str()), Some(role));
  }
  assert_eq!(Role::parse("member"), None);
  assert_eq!(admin(Role::Admin).audit_actor_type(), "admin");
  assert_eq!(admin(Role::Root).audit_actor_type(), "root");
  assert_eq!(user().audit_actor_type(), "user");
  assert_eq!(AuthIdentity::Service.audit_actor_type(), "service");
}
