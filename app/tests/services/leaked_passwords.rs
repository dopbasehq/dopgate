//! New passwords are checked against passwords known from data breaches.

use app::services::leaked_passwords::listed;
use axum::http::{Method, StatusCode};
use serde_json::json;

use crate::support::{
  PASSWORD, TestApp,
  breaches::{FakeBreachList, Lookup, sha1_hex},
};

const LEAKED: &str = "sunshine-and-rain-2019";
const FINE: &str = "a password nobody leaked";

async fn app_with(list: &FakeBreachList) -> TestApp {
  let url = list.url.clone();
  TestApp::with(move |config| config.leaked_passwords_url = Some(url)).await
}

async fn sign_up(
  app: &TestApp,
  email: &str,
  password: &str,
) -> (StatusCode, serde_json::Value) {
  app
    .request(
      Method::POST,
      "/api/v1/auth/signup",
      Some(json!({ "email": email, "password": password })),
    )
    .await
}

#[test]
fn a_range_answer_lists_a_suffix_only_with_a_count() {
  let range = "0018A45C4D1DEF81644B54AB7F969B88D65:3\r\n00D4F6E8FA6EECAD2A3AA415EEC418D38EC:0\r\n";
  assert!(listed(range, "0018A45C4D1DEF81644B54AB7F969B88D65"));
  // The list writes hashes in capitals; a lowercase one is the same hash.
  assert!(listed(range, "0018a45c4d1def81644b54ab7f969b88d65"));
  // A count of 0 is padding, not a password anyone used.
  assert!(!listed(range, "00D4F6E8FA6EECAD2A3AA415EEC418D38EC"));
  assert!(!listed(range, "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"));
  assert!(!listed("", "0018A45C4D1DEF81644B54AB7F969B88D65"));
  assert!(!listed(
    "not a range answer",
    "0018A45C4D1DEF81644B54AB7F969B88D65"
  ));
}

#[tokio::test]
async fn a_leaked_password_is_refused_wherever_one_is_set() {
  let list = FakeBreachList::start(&[LEAKED], &[]).await;
  let app = app_with(&list).await;
  let root = app.root_token().await;

  // Signing up.
  let (status, body) = sign_up(&app, "ana@example.com", LEAKED).await;
  assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
  assert_eq!(
    body["error"]["PASSWORD_LEAKED"],
    "This password has appeared in a data breach. Choose a different one."
  );
  let (status, body) = sign_up(&app, "ana@example.com", FINE).await;
  assert_eq!(status, StatusCode::CREATED, "{body}");

  // An admin creating a user.
  let (status, body) = app
    .request_with(
      Method::POST,
      "/api/v1/admin/users",
      Some(json!({ "email": "ben@example.com", "password": LEAKED })),
      Some(&root),
    )
    .await;
  assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
  assert!(body["error"]["PASSWORD_LEAKED"].is_string());

  // Root creating an admin.
  let (status, body) = app
    .request_with(
      Method::POST,
      "/api/v1/admin/admins",
      Some(json!({ "email": "cy@example.com", "password": LEAKED })),
      Some(&root),
    )
    .await;
  assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
  assert!(body["error"]["PASSWORD_LEAKED"].is_string());

  // A signed-in user changing their password.
  app.create_user(&root, "dee@example.com").await;
  let session = app.login("dee@example.com", PASSWORD).await;
  let (status, body) = app
    .request_with(
      Method::POST,
      "/api/v1/auth/password/change",
      Some(json!({ "currentPassword": PASSWORD, "newPassword": LEAKED })),
      Some(&session),
    )
    .await;
  assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
  assert!(body["error"]["PASSWORD_LEAKED"].is_string());
  // The old password still works.
  app.login("dee@example.com", PASSWORD).await;
}

#[tokio::test]
async fn only_five_characters_of_the_hash_leave_the_server() {
  let list = FakeBreachList::start(&[LEAKED], &[]).await;
  let app = app_with(&list).await;
  let (status, _) = sign_up(&app, "ana@example.com", FINE).await;
  assert_eq!(status, StatusCode::CREATED);

  let hash = sha1_hex(FINE);
  assert_eq!(
    list.lookups(),
    vec![Lookup {
      path: format!("/range/{}", &hash[..5]),
      // Asks for a padded answer, so its size says nothing about the hash.
      padding: Some("true".into()),
    }]
  );
}

#[tokio::test]
async fn a_padding_entry_is_not_a_match() {
  // The same hash comes back with a count of 0: padding the real list adds.
  let list = FakeBreachList::start(&[], &[FINE]).await;
  let app = app_with(&list).await;
  let (status, body) = sign_up(&app, "ana@example.com", FINE).await;
  assert_eq!(status, StatusCode::CREATED, "{body}");
}

#[tokio::test]
async fn a_list_that_cannot_be_reached_never_blocks_a_password() {
  // A port nothing listens on.
  let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
  let url = format!("http://{}", listener.local_addr().unwrap());
  drop(listener);
  let app = TestApp::with(move |config| config.leaked_passwords_url = Some(url)).await;
  let (status, body) = sign_up(&app, "ana@example.com", LEAKED).await;
  assert_eq!(status, StatusCode::CREATED, "{body}");
}

#[tokio::test]
async fn an_admin_can_turn_the_check_off() {
  let list = FakeBreachList::start(&[LEAKED], &[]).await;
  let app = app_with(&list).await;
  let root = app.root_token().await;

  // It is on unless someone turns it off.
  let (_, body) = app
    .request_with(Method::GET, "/api/v1/admin/settings", None, Some(&root))
    .await;
  assert_eq!(body["data"]["password"]["rejectLeaked"], true);

  app
    .settings(
      &root,
      json!({ "password": { "minLength": 8, "rejectLeaked": false } }),
    )
    .await;
  let (status, body) = sign_up(&app, "ana@example.com", LEAKED).await;
  assert_eq!(status, StatusCode::CREATED, "{body}");
  assert!(
    list.lookups().is_empty(),
    "nothing is asked while it is off"
  );
}
