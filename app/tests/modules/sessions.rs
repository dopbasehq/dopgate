//! A user's own devices.

use axum::http::{Method, StatusCode};

use crate::support::{PASSWORD, TestApp};

#[tokio::test]
async fn users_see_their_sessions_and_end_one_or_the_others() {
  let app = TestApp::new().await;
  let root = app.root_token().await;
  app.create_user(&root, "ada@example.com", "member").await;
  let laptop = app.login("ada@example.com", PASSWORD).await;
  let phone = app.login("ada@example.com", PASSWORD).await;
  let tablet = app.login("ada@example.com", PASSWORD).await;

  let (status, body) = app
    .request_with(Method::GET, "/api/v1/auth/sessions", None, Some(&laptop))
    .await;
  assert_eq!(status, StatusCode::OK);
  let sessions = body["data"].as_array().unwrap();
  assert_eq!(sessions.len(), 3);
  assert_eq!(sessions.iter().filter(|s| s["current"] == true).count(), 1);
  let phone_id = {
    let (_, mine) = app
      .request_with(Method::GET, "/api/v1/auth/sessions", None, Some(&phone))
      .await;
    mine["data"]
      .as_array()
      .unwrap()
      .iter()
      .find(|s| s["current"] == true)
      .unwrap()["id"]
      .as_str()
      .unwrap()
      .to_owned()
  };
  let (status, _) = app
    .request_with(
      Method::DELETE,
      &format!("/api/v1/auth/sessions/{phone_id}"),
      None,
      Some(&laptop),
    )
    .await;
  assert_eq!(status, StatusCode::OK);
  assert_eq!(me(&app, &phone).await, StatusCode::UNAUTHORIZED);

  let (status, _) = app
    .request_with(
      Method::DELETE,
      "/api/v1/auth/sessions?keepCurrent=true",
      None,
      Some(&laptop),
    )
    .await;
  assert_eq!(status, StatusCode::OK);
  assert_eq!(me(&app, &tablet).await, StatusCode::UNAUTHORIZED);
  assert_eq!(me(&app, &laptop).await, StatusCode::OK);
}

#[tokio::test]
async fn nobody_ends_someone_elses_session() {
  let app = TestApp::new().await;
  let root = app.root_token().await;
  app.create_user(&root, "ada@example.com", "member").await;
  let ada = app.login("ada@example.com", PASSWORD).await;
  let (_, mine) = app
    .request_with(Method::GET, "/api/v1/auth/sessions", None, Some(&root))
    .await;
  let root_session = mine["data"][0]["id"].as_str().unwrap().to_owned();
  let (status, _) = app
    .request_with(
      Method::DELETE,
      &format!("/api/v1/auth/sessions/{root_session}"),
      None,
      Some(&ada),
    )
    .await;
  assert_eq!(status, StatusCode::NOT_FOUND);
}

async fn me(
  app: &TestApp,
  token: &str,
) -> StatusCode {
  app
    .request_with(Method::GET, "/api/v1/auth/me", None, Some(token))
    .await
    .0
}
