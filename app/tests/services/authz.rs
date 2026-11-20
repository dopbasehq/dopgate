use app::{
  models::{AuthIdentity, Role, UserStatus, UserVia},
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
    via: UserVia::Session("ses_2".into()),
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
  // A stored role or status Dopgate doesn't know is an error when a row is
  // read. It never falls back to a default.
  assert_eq!(Role::try_from("root".to_owned()).ok(), Some(Role::Root));
  assert!(Role::try_from("member".to_owned()).is_err());
  for status in [UserStatus::Active, UserStatus::Disabled] {
    assert_eq!(
      UserStatus::try_from(status.as_str().to_owned()).ok(),
      Some(status)
    );
  }
  let error = UserStatus::try_from("suspended".to_owned()).unwrap_err();
  assert_eq!(error.to_string(), "unknown status \"suspended\"");
  assert_eq!(admin(Role::Admin).audit_actor_type(), "admin");
  assert_eq!(admin(Role::Root).audit_actor_type(), "root");
  assert_eq!(user().audit_actor_type(), "user");
  assert_eq!(AuthIdentity::Service.audit_actor_type(), "service");
}
