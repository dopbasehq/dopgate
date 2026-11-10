//! Agents: owned by an admin or a user, signing in with one token, and
//! carrying capabilities.

use axum::http::{Method, StatusCode};
use serde_json::{Value, json};

use crate::support::{PASSWORD, TestApp};

const SERVICE_KEY: &str = "a-service-key-that-is-long-enough-1234";

/// An instance with agents for users on, root's console token, a user's
/// ID, and the user's access token.
async fn app_with_user() -> (TestApp, String, String, String) {
  let app = TestApp::with(|config| {
    config.service_key = Some(zeroize::Zeroizing::new(SERVICE_KEY.into()));
  })
  .await;
  let root = app.root_token().await;
  app
    .settings(
      &root,
      json!({ "selfService": { "agents": true, "maxAgentsPerUser": 2 } }),
    )
    .await;
  let id = app.create_user(&root, "ada@example.com").await;
  let user = app.login("ada@example.com", PASSWORD).await;
  (app, root, id, user)
}

async fn post(
  app: &TestApp,
  path: &str,
  body: Option<Value>,
  bearer: &str,
) -> (StatusCode, Value) {
  app
    .request_with(Method::POST, path, body, Some(bearer))
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
async fn a_users_agent_signs_in_with_its_owner_and_capabilities() {
  let (app, _, user_id, user) = app_with_user().await;
  let (status, body) = post(
    &app,
    "/api/v1/auth/agents",
    Some(json!({
      "name": "cursor",
      "description": "Opens pull requests",
      "capabilities": { "repo": "dopgate", "max_files": 20, "can_merge": false, "labels": ["bot"] },
    })),
    &user,
  )
  .await;
  assert_eq!(status, StatusCode::CREATED, "{body}");
  let token = body["data"]["token"].as_str().unwrap().to_owned();
  assert!(token.starts_with("dga_"));
  let agent = &body["data"]["agent"];
  assert!(agent["id"].as_str().unwrap().starts_with("agt_"));
  assert_eq!(agent["owner"]["id"], user_id.as_str());
  assert_eq!(agent["owner"]["kind"], "user");
  assert_eq!(agent["lastFour"], &token[token.len() - 4..]);

  let (status, traded) = trade(&app, &token).await;
  assert_eq!(status, StatusCode::OK, "{traded}");
  let access = traded["data"]["accessToken"].as_str().unwrap().to_owned();
  let claims = claims(&access);
  assert_eq!(claims["kind"], "agent");
  assert_eq!(claims["sub"], agent["id"]);
  assert_eq!(claims["owner"], user_id.as_str());
  assert_eq!(claims["capabilities"]["repo"], "dopgate");
  assert_eq!(claims["capabilities"]["labels"], json!(["bot"]));
  for absent in ["email", "sid", "name", "role"] {
    assert!(claims.get(absent).is_none(), "{absent}");
  }

  // Agent tokens are for your backend: Dopgate's endpoints refuse them.
  for path in [
    "/api/v1/auth/me",
    "/api/v1/console/me",
    "/api/v1/admin/users",
    "/api/v1/auth/agents",
  ] {
    let (status, _) = app
      .request_with(Method::GET, path, None, Some(&access))
      .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{path}");
  }
}

#[tokio::test]
async fn an_admins_agent_is_owned_by_the_admin() {
  let (app, root, _, _) = app_with_user().await;
  let (status, body) = post(
    &app,
    "/api/v1/admin/agents",
    Some(json!({ "name": "invoice-bot", "capabilities": { "invoices": "read" } })),
    &root,
  )
  .await;
  assert_eq!(status, StatusCode::CREATED, "{body}");
  assert_eq!(body["data"]["agent"]["owner"]["kind"], "admin");
  let token = body["data"]["token"].as_str().unwrap().to_owned();
  let (_, traded) = trade(&app, &token).await;
  let claims = claims(traded["data"]["accessToken"].as_str().unwrap());
  assert!(claims["owner"].as_str().unwrap().starts_with("adm_"));

  // The service key can read agents but never make one.
  let (status, _) = app
    .request_with(Method::GET, "/api/v1/admin/agents", None, Some(SERVICE_KEY))
    .await;
  assert_eq!(status, StatusCode::OK);
  let (status, _) = post(
    &app,
    "/api/v1/admin/agents",
    Some(json!({ "name": "svc-bot" })),
    SERVICE_KEY,
  )
  .await;
  assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn edits_show_in_the_next_token_and_regenerating_kills_the_old_one() {
  let (app, _, _, user) = app_with_user().await;
  let (_, body) = post(
    &app,
    "/api/v1/auth/agents",
    Some(json!({ "name": "cursor", "capabilities": { "tier": "free" } })),
    &user,
  )
  .await;
  let id = body["data"]["agent"]["id"].as_str().unwrap().to_owned();
  let old = body["data"]["token"].as_str().unwrap().to_owned();

  let (status, updated) = app
    .request_with(
      Method::PATCH,
      &format!("/api/v1/auth/agents/{id}"),
      Some(json!({ "capabilities": { "tier": "pro" }, "description": "" })),
      Some(&user),
    )
    .await;
  assert_eq!(status, StatusCode::OK, "{updated}");
  let (_, traded) = trade(&app, &old).await;
  assert_eq!(
    claims(traded["data"]["accessToken"].as_str().unwrap())["capabilities"]["tier"],
    "pro"
  );

  let (status, body) = post(
    &app,
    &format!("/api/v1/auth/agents/{id}/regenerate"),
    None,
    &user,
  )
  .await;
  assert_eq!(status, StatusCode::OK, "{body}");
  let new = body["data"]["token"].as_str().unwrap().to_owned();
  assert_ne!(new, old);
  let (status, body) = trade(&app, &old).await;
  assert_eq!(status, StatusCode::UNAUTHORIZED);
  assert!(body["error"]["TOKEN_INVALID"].is_string());
  assert_eq!(trade(&app, &new).await.0, StatusCode::OK);
}

#[tokio::test]
async fn capabilities_and_names_are_checked() {
  let (app, _, _, user) = app_with_user().await;
  for (body, code) in [
    (json!({ "name": "Has Caps" }), "REQUEST_INVALID"),
    (
      json!({ "name": "ok", "capabilities": [] }),
      "CAPABILITIES_INVALID",
    ),
    (
      json!({ "name": "ok", "capabilities": { "nested": { "a": 1 } } }),
      "CAPABILITIES_INVALID",
    ),
    (
      json!({ "name": "ok", "capabilities": { "nums": [1, 2] } }),
      "CAPABILITIES_INVALID",
    ),
    (
      json!({ "name": "ok", "capabilities": { "bad key": "x" } }),
      "CAPABILITIES_INVALID",
    ),
    (
      json!({ "name": "ok", "capabilities": { "big": "x".repeat(5000) } }),
      "CAPABILITIES_INVALID",
    ),
  ] {
    let (status, reply) = post(&app, "/api/v1/auth/agents", Some(body.clone()), &user).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}: {reply}");
    assert!(reply["error"][code].is_string(), "{body}: {reply}");
  }
  assert_eq!(
    post(
      &app,
      "/api/v1/auth/agents",
      Some(json!({ "name": "one" })),
      &user
    )
    .await
    .0,
    StatusCode::CREATED
  );
  let (status, reply) = post(
    &app,
    "/api/v1/auth/agents",
    Some(json!({ "name": "one" })),
    &user,
  )
  .await;
  assert_eq!(status, StatusCode::CONFLICT);
  assert!(reply["error"]["AGENT_NAME_TAKEN"].is_string());
  assert_eq!(
    post(
      &app,
      "/api/v1/auth/agents",
      Some(json!({ "name": "two" })),
      &user
    )
    .await
    .0,
    StatusCode::CREATED
  );
  let (status, reply) = post(
    &app,
    "/api/v1/auth/agents",
    Some(json!({ "name": "three" })),
    &user,
  )
  .await;
  assert_eq!(status, StatusCode::CONFLICT);
  assert!(reply["error"]["LIMIT_REACHED"].is_string());
}

#[tokio::test]
async fn the_setting_gates_making_and_changing_but_not_the_rest() {
  let (app, root, _, user) = app_with_user().await;
  let (_, body) = post(
    &app,
    "/api/v1/auth/agents",
    Some(json!({ "name": "cursor" })),
    &user,
  )
  .await;
  let id = body["data"]["agent"]["id"].as_str().unwrap().to_owned();
  let token = body["data"]["token"].as_str().unwrap().to_owned();
  app
    .settings(&root, json!({ "selfService": { "agents": false } }))
    .await;

  for (method, path, body) in [
    (
      Method::POST,
      "/api/v1/auth/agents".to_owned(),
      Some(json!({ "name": "new" })),
    ),
    (
      Method::PATCH,
      format!("/api/v1/auth/agents/{id}"),
      Some(json!({ "name": "renamed" })),
    ),
    (
      Method::POST,
      format!("/api/v1/auth/agents/{id}/regenerate"),
      None,
    ),
  ] {
    let (status, reply) = app.request_with(method, &path, body, Some(&user)).await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{path}");
    assert!(reply["error"]["FEATURE_DISABLED"].is_string(), "{reply}");
  }
  assert_eq!(trade(&app, &token).await.0, StatusCode::OK);
  let (status, list) = app
    .request_with(Method::GET, "/api/v1/auth/agents", None, Some(&user))
    .await;
  assert_eq!(status, StatusCode::OK);
  assert_eq!(list["data"]["items"].as_array().unwrap().len(), 1);
  assert_eq!(
    post(
      &app,
      &format!("/api/v1/auth/agents/{id}/disable"),
      None,
      &user
    )
    .await
    .0,
    StatusCode::OK
  );
  let reply = app
    .call(
      Method::DELETE,
      &format!("/api/v1/auth/agents/{id}"),
      None,
      Some(&user),
      &[],
    )
    .await;
  assert_eq!(reply.status, StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn agents_are_off_for_users_by_default() {
  let app = TestApp::new().await;
  let root = app.root_token().await;
  app.create_user(&root, "ada@example.com").await;
  let user = app.login("ada@example.com", PASSWORD).await;
  let (status, reply) = post(
    &app,
    "/api/v1/auth/agents",
    Some(json!({ "name": "x" })),
    &user,
  )
  .await;
  assert_eq!(status, StatusCode::FORBIDDEN);
  assert!(reply["error"]["FEATURE_DISABLED"].is_string());
}

#[tokio::test]
async fn an_agent_follows_its_owner() {
  let (app, root, user_id, user) = app_with_user().await;
  let (_, body) = post(
    &app,
    "/api/v1/auth/agents",
    Some(json!({ "name": "cursor" })),
    &user,
  )
  .await;
  let token = body["data"]["token"].as_str().unwrap().to_owned();
  let agent_id = body["data"]["agent"]["id"].as_str().unwrap().to_owned();

  // Turning off the agent, or its owner, stops the next trade.
  post(
    &app,
    &format!("/api/v1/admin/agents/{agent_id}/disable"),
    None,
    &root,
  )
  .await;
  let (status, reply) = trade(&app, &token).await;
  assert_eq!(status, StatusCode::FORBIDDEN);
  assert!(reply["error"]["AGENT_DISABLED"].is_string());
  post(
    &app,
    &format!("/api/v1/admin/agents/{agent_id}/enable"),
    None,
    &root,
  )
  .await;
  assert_eq!(trade(&app, &token).await.0, StatusCode::OK);
  post(
    &app,
    &format!("/api/v1/admin/users/{user_id}/disable"),
    None,
    &root,
  )
  .await;
  assert_eq!(trade(&app, &token).await.0, StatusCode::FORBIDDEN);
  post(
    &app,
    &format!("/api/v1/admin/users/{user_id}/enable"),
    None,
    &root,
  )
  .await;
  assert_eq!(trade(&app, &token).await.0, StatusCode::OK);

  // Deleting the owner deletes the agent.
  app
    .call(
      Method::DELETE,
      &format!("/api/v1/admin/users/{user_id}"),
      None,
      Some(&root),
      &[],
    )
    .await;
  assert_eq!(trade(&app, &token).await.0, StatusCode::UNAUTHORIZED);
  let (status, _) = app
    .request_with(
      Method::GET,
      &format!("/api/v1/admin/agents/{agent_id}"),
      None,
      Some(&root),
    )
    .await;
  assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn admins_can_turn_off_any_agent_but_only_owners_edit() {
  let (app, root, user_id, user) = app_with_user().await;
  let (_, body) = post(
    &app,
    "/api/v1/auth/agents",
    Some(json!({ "name": "cursor" })),
    &user,
  )
  .await;
  let users_agent = body["data"]["agent"]["id"].as_str().unwrap().to_owned();
  app.create_admin(&root, "ana@example.com").await;
  let ana = app.console_login("ana@example.com", PASSWORD).await;
  let (_, body) = post(
    &app,
    "/api/v1/admin/agents",
    Some(json!({ "name": "anas-bot" })),
    &ana,
  )
  .await;
  let anas_agent = body["data"]["agent"]["id"].as_str().unwrap().to_owned();

  // Root sees both, and can filter by owner.
  let (_, list) = app
    .request_with(
      Method::GET,
      &format!("/api/v1/admin/agents?owner={user_id}"),
      None,
      Some(&root),
    )
    .await;
  assert_eq!(list["data"]["items"].as_array().unwrap().len(), 1);
  assert_eq!(
    list["data"]["items"][0]["owner"]["email"],
    "ada@example.com"
  );

  for agent in [&users_agent, &anas_agent] {
    let (status, _) = app
      .request_with(
        Method::PATCH,
        &format!("/api/v1/admin/agents/{agent}"),
        Some(json!({ "name": "renamed" })),
        Some(&root),
      )
      .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = post(
      &app,
      &format!("/api/v1/admin/agents/{agent}/regenerate"),
      None,
      &root,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = post(
      &app,
      &format!("/api/v1/admin/agents/{agent}/disable"),
      None,
      &root,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
  }
  // Ana owns her agent, so she can edit it.
  let (status, _) = app
    .request_with(
      Method::PATCH,
      &format!("/api/v1/admin/agents/{anas_agent}"),
      Some(json!({ "capabilities": { "scope": "billing" } })),
      Some(&ana),
    )
    .await;
  assert_eq!(status, StatusCode::OK);
  // A user can't see another owner's agent at all.
  let (status, _) = app
    .request_with(
      Method::GET,
      &format!("/api/v1/auth/agents/{anas_agent}"),
      None,
      Some(&user),
    )
    .await;
  assert_eq!(status, StatusCode::NOT_FOUND);
  let reply = app
    .call(
      Method::DELETE,
      &format!("/api/v1/admin/agents/{users_agent}"),
      None,
      Some(&root),
      &[],
    )
    .await;
  assert_eq!(reply.status, StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn rejected_agent_tokens_are_recorded() {
  let (app, root, _, _) = app_with_user().await;
  let (status, _) = trade(&app, "dga_not-a-real-token-0000000000000000000000000").await;
  assert_eq!(status, StatusCode::UNAUTHORIZED);
  let (_, events) = app
    .request_with(
      Method::GET,
      "/api/v1/admin/audit-events?action=agent.token_rejected",
      None,
      Some(&root),
    )
    .await;
  assert_eq!(events["data"]["items"][0]["metadata"]["kind"], "agent");
}
