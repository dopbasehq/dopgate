use app::{
  models::{AuthIdentity, Role},
  services::authz::{check_manage, require_admin, require_root},
};

fn user(role: Role) -> AuthIdentity {
  AuthIdentity::User {
    user_id: "usr_1".into(),
    email: "person@example.com".into(),
    role,
    session_id: "ses_1".into(),
  }
}

#[test]
fn admin_api_is_for_root_admins_and_the_service_key() {
  assert!(require_admin(&user(Role::Root)).is_ok());
  assert!(require_admin(&user(Role::Admin)).is_ok());
  assert!(require_admin(&AuthIdentity::Service).is_ok());
  let error = require_admin(&user(Role::Member)).unwrap_err();
  assert_eq!(error.status, axum::http::StatusCode::FORBIDDEN);
}

#[test]
fn instance_operations_are_for_root_only() {
  assert!(require_root(&user(Role::Root)).is_ok());
  assert!(require_root(&user(Role::Admin)).is_err());
  assert!(require_root(&AuthIdentity::Service).is_err());
}

#[test]
fn nobody_manages_root_and_only_root_manages_admins() {
  for actor in [user(Role::Root), user(Role::Admin), AuthIdentity::Service] {
    assert!(check_manage(&actor, Role::Root).is_err());
    assert!(check_manage(&actor, Role::Member).is_ok());
  }
  assert!(check_manage(&user(Role::Root), Role::Admin).is_ok());
  assert!(check_manage(&user(Role::Admin), Role::Admin).is_err());
  assert!(check_manage(&AuthIdentity::Service, Role::Admin).is_err());
  for target in [Role::Root, Role::Admin, Role::Member] {
    assert!(check_manage(&user(Role::Member), target).is_err());
  }
}

#[test]
fn roles_round_trip_through_their_stored_names() {
  for role in [Role::Root, Role::Admin, Role::Member] {
    assert_eq!(Role::parse(role.as_str()), Some(role));
  }
  assert_eq!(Role::parse("owner"), None);
  assert_eq!(user(Role::Admin).audit_actor_type(), "admin");
  assert_eq!(AuthIdentity::Service.audit_actor_type(), "service");
}
