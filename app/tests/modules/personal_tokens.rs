//! Personal tokens: a user's own tokens that sign in as that user.

use axum::http::{Method, StatusCode};
use serde_json::{Value, json};

use crate::support::{PASSWORD, TestApp};

/// An instance with personal tokens on, root's console token, a user's ID,
/// and the user's access token.
async fn app_with_user() -> (TestApp, String, String, String) {
  let app = TestApp::new().await;
  let root = app.root_token().await;
  app
    .settings(
      &root,
      json!({ "selfService": { "personalTokens": true, "maxPersonalTokensPerUser": 2 } }),
    )
    .await;
  let id = app.create_user(&root, "ada@example.com").await;
  let user = app.login("ada@example.com", PASSWORD).await;
  (app, root, id, user)
}

async fn create(
  app: &TestApp,
  user: &str,
  body: Value,
) -> (StatusCode, Value) {
  app
    .request_with(
      Method::POST,
      "/api/v1/auth/personal-tokens",
      Some(body),
      Some(user),
    )
    .await
}

async fn trade(
  app: &TestApp,
  token: &str,
) -> (StatusCode, Value) {
  app
    .request(
      Method::POST,
      "/api/v1/auth/token",
      Some(json!({ "token": token })),
    )
    .await
}

fn claims(access_token: &str) -> Value {
  use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
  let payload = access_token.split('.').nth(1).unwrap();
  serde_json::from_slice(&URL_SAFE_NO_PAD.decode(payload).unwrap()).unwrap()
}

#[tokio::test]
async fn a_personal_token_signs_in_as_its_user() {
  let (app, _, id, user) = app_with_user().await;
  let (status, body) = create(&app, &user, json!({ "name": "laptop-cli" })).await;
  assert_eq!(status, StatusCode::CREATED, "{body}");
  let token = body["data"]["token"].as_str().unwrap().to_owned();
  assert!(token.starts_with("dgp_"));
  assert_eq!(token.len(), 4 + 43);
  assert_eq!(
    body["data"]["personalToken"]["lastFour"],
    &token[token.len() - 4..]
  );
  assert!(body["data"]["personalToken"]["expiresAt"].is_null());

  let (status, body) = trade(&app, &token).await;
  assert_eq!(status, StatusCode::OK, "{body}");
  assert!(body["data"].get("refreshToken").is_none());
  let access = body["data"]["accessToken"].as_str().unwrap();
  let claims = claims(access);
  assert_eq!(claims["sub"], id.as_str());
  assert_eq!(claims["kind"], "human");
  assert_eq!(claims["via"], "pat");
  assert!(claims["tid"].as_str().unwrap().starts_with("pat_"));
  assert!(claims.get("sid").is_none());

  // It reads the profile but can't make more tokens.
  let (status, me) = app
    .request_with(Method::GET, "/api/v1/auth/me", None, Some(access))
    .await;
  assert_eq!(status, StatusCode::OK);
  assert_eq!(me["data"]["email"], "ada@example.com");
  let (status, _) = create(&app, access, json!({ "name": "another" })).await;
  assert_eq!(status, StatusCode::FORBIDDEN);
  let (status, _) = app
    .request_with(Method::GET, "/api/v1/auth/sessions", None, Some(access))
    .await;
  assert_eq!(status, StatusCode::FORBIDDEN);

  // The list shows it without the token.
  let (_, list) = app
    .request_with(
      Method::GET,
      "/api/v1/auth/personal-tokens",
      None,
      Some(&user),
    )
    .await;
  assert_eq!(list["data"]["items"][0]["name"], "laptop-cli");
  assert!(list["data"]["items"][0].get("token").is_none());
  assert!(list["data"]["items"][0]["lastUsedAt"].is_string());
}

#[tokio::test]
async fn deleting_a_token_stops_it_at_once() {
  let (app, _, _, user) = app_with_user().await;
  let (_, body) = create(&app, &user, json!({ "name": "ci" })).await;
  let token = body["data"]["token"].as_str().unwrap().to_owned();
  let token_id = body["data"]["personalToken"]["id"]
    .as_str()
    .unwrap()
    .to_owned();
  let (_, traded) = trade(&app, &token).await;
  let access = traded["data"]["accessToken"].as_str().unwrap().to_owned();

  let (status, _) = app
    .request_with(
      Method::DELETE,
      &format!("/api/v1/auth/personal-tokens/{token_id}"),
      None,
      Some(&user),
    )
    .await;
  assert_eq!(status, StatusCode::OK);
  let (status, body) = trade(&app, &token).await;
  assert_eq!(status, StatusCode::UNAUTHORIZED);
  assert!(body["error"]["TOKEN_INVALID"].is_string());
  let (status, _) = app
    .request_with(Method::GET, "/api/v1/auth/me", None, Some(&access))
    .await;
  assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn an_expired_token_says_so() {
  let (app, _, _, user) = app_with_user().await;
  let soon = chrono::Utc::now() + chrono::Duration::seconds(2);
  let (status, body) = create(&app, &user, json!({ "name": "short", "expiresAt": soon })).await;
  assert_eq!(status, StatusCode::CREATED, "{body}");
  let token = body["data"]["token"].as_str().unwrap().to_owned();
  tokio::time::sleep(std::time::Duration::from_millis(2500)).await;
  let (status, body) = trade(&app, &token).await;
  assert_eq!(status, StatusCode::UNAUTHORIZED);
  assert!(body["error"]["TOKEN_EXPIRED"].is_string(), "{body}");
  let (_, list) = app
    .request_with(
      Method::GET,
      "/api/v1/auth/personal-tokens",
      None,
      Some(&user),
    )
    .await;
  assert_eq!(list["data"]["items"][0]["expired"], true);
}

#[tokio::test]
async fn the_setting_names_and_limit_are_enforced() {
  let (app, root, _, user) = app_with_user().await;
  for (body, status, code) in [
    (
      json!({ "name": "" }),
      StatusCode::UNPROCESSABLE_ENTITY,
      "REQUEST_INVALID",
    ),
    (
      json!({ "name": "old", "expiresAt": "2020-01-01T00:00:00Z" }),
      StatusCode::UNPROCESSABLE_ENTITY,
      "REQUEST_INVALID",
    ),
  ] {
    let (got, reply) = create(&app, &user, body).await;
    assert_eq!(got, status, "{reply}");
    assert!(reply["error"][code].is_string(), "{reply}");
  }
  assert_eq!(
    create(&app, &user, json!({ "name": "one" })).await.0,
    StatusCode::CREATED
  );
  let (status, reply) = create(&app, &user, json!({ "name": "one" })).await;
  assert_eq!(status, StatusCode::CONFLICT);
  assert!(reply["error"]["TOKEN_NAME_TAKEN"].is_string());
  assert_eq!(
    create(&app, &user, json!({ "name": "two" })).await.0,
    StatusCode::CREATED
  );
  let (status, reply) = create(&app, &user, json!({ "name": "three" })).await;
  assert_eq!(status, StatusCode::CONFLICT);
  assert!(reply["error"]["LIMIT_REACHED"].is_string());

  // Turning the setting off stops new tokens; existing ones keep working.
  app
    .settings(
      &root,
      json!({ "selfService": { "personalTokens": false, "maxPersonalTokensPerUser": 2 } }),
    )
    .await;
  let (status, reply) = create(&app, &user, json!({ "name": "four" })).await;
  assert_eq!(status, StatusCode::FORBIDDEN);
  assert!(reply["error"]["FEATURE_DISABLED"].is_string());
  let (status, list) = app
    .request_with(
      Method::GET,
      "/api/v1/auth/personal-tokens",
      None,
      Some(&user),
    )
    .await;
  assert_eq!(status, StatusCode::OK);
  assert_eq!(list["data"]["items"].as_array().unwrap().len(), 2);
}

#[tokio::test]
async fn personal_tokens_are_off_by_default() {
  let app = TestApp::new().await;
  let root = app.root_token().await;
  app.create_user(&root, "ada@example.com").await;
  let user = app.login("ada@example.com", PASSWORD).await;
  let (status, reply) = create(&app, &user, json!({ "name": "x" })).await;
  assert_eq!(status, StatusCode::FORBIDDEN);
  assert!(reply["error"]["FEATURE_DISABLED"].is_string());
}

#[tokio::test]
async fn the_owner_decides_whether_a_token_works() {
  let (app, root, id, user) = app_with_user().await;
  let (_, body) = create(&app, &user, json!({ "name": "ci" })).await;
  let token = body["data"]["token"].as_str().unwrap().to_owned();

  app
    .request_with(
      Method::POST,
      &format!("/api/v1/admin/users/{id}/disable"),
      None,
      Some(&root),
    )
    .await;
  let (status, body) = trade(&app, &token).await;
  assert_eq!(status, StatusCode::FORBIDDEN);
  assert!(body["error"]["ACCOUNT_DISABLED"].is_string());
  app
    .request_with(
      Method::POST,
      &format!("/api/v1/admin/users/{id}/enable"),
      None,
      Some(&root),
    )
    .await;
  assert_eq!(trade(&app, &token).await.0, StatusCode::OK);

  let reply = app
    .call(
      Method::DELETE,
      &format!("/api/v1/admin/users/{id}"),
      None,
      Some(&root),
      &[],
    )
    .await;
  assert_eq!(reply.status, StatusCode::NO_CONTENT);
  assert_eq!(trade(&app, &token).await.0, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn admins_list_and_revoke_without_seeing_tokens() {
  const SERVICE_KEY: &str = "a-service-key-that-is-long-enough-1234";
  let app = TestApp::with(|config| {
    config.service_key = Some(zeroize::Zeroizing::new(SERVICE_KEY.into()));
  })
  .await;
  let root = app.root_token().await;
  app
    .settings(
      &root,
      json!({ "selfService": { "personalTokens": true, "maxPersonalTokensPerUser": 5 } }),
    )
    .await;
  let id = app.create_user(&root, "ada@example.com").await;
  let user = app.login("ada@example.com", PASSWORD).await;
  let (_, body) = create(&app, &user, json!({ "name": "ci" })).await;
  let token = body["data"]["token"].as_str().unwrap().to_owned();
  let token_id = body["data"]["personalToken"]["id"]
    .as_str()
    .unwrap()
    .to_owned();

  let path = format!("/api/v1/admin/users/{id}/personal-tokens");
  for bearer in [root.as_str(), SERVICE_KEY] {
    let (status, list) = app
      .request_with(Method::GET, &path, None, Some(bearer))
      .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(list["data"]["items"][0]["name"], "ci");
    assert!(list["data"]["items"][0].get("token").is_none());
  }
  let item = format!("{path}/{token_id}");
  let (status, _) = app
    .request_with(Method::DELETE, &item, None, Some(SERVICE_KEY))
    .await;
  assert_eq!(status, StatusCode::FORBIDDEN);
  let (status, _) = app
    .request_with(Method::DELETE, &item, None, Some(&root))
    .await;
  assert_eq!(status, StatusCode::OK);
  assert_eq!(trade(&app, &token).await.0, StatusCode::UNAUTHORIZED);
  let (_, events) = app
    .request_with(
      Method::GET,
      "/api/v1/admin/audit-events?action=personal_token.deleted",
      None,
      Some(&root),
    )
    .await;
  assert_eq!(events["data"]["items"][0]["actorType"], "root");
}

#[tokio::test]
async fn unknown_tokens_are_refused_and_recorded() {
  let app = TestApp::new().await;
  let root = app.root_token().await;
  for token in [
    "dgp_not-a-real-token-at-all-0000000000000000000",
    "something-else",
  ] {
    let (status, body) = trade(&app, token).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert!(body["error"]["TOKEN_INVALID"].is_string());
  }
  let (_, events) = app
    .request_with(
      Method::GET,
      "/api/v1/admin/audit-events?action=token.rejected",
      None,
      Some(&root),
    )
    .await;
  let items = events["data"]["items"].as_array().unwrap();
  assert_eq!(items.len(), 2);
  assert!(!items[0]["metadata"].to_string().contains("not-a-real"));
}
