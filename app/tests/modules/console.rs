//! Console sign-in: admins sign in here and only here, with their own
//! sessions, codes, and cookie.

use axum::http::{Method, StatusCode};
use serde_json::{Value, json};

use crate::support::{PASSWORD, ROOT_EMAIL, TestApp, smtp::FakeSmtp, use_smtp};

#[tokio::test]
async fn admins_and_users_sign_in_on_their_own_side_only() {
  let app = TestApp::new().await;
  let root = app.root_token().await;
  app.create_user(&root, "ada@example.com").await;

  // Root's password doesn't open the app, and looks like a wrong one.
  let (status, body) = app
    .request(
      Method::POST,
      "/api/v1/auth/login",
      Some(json!({ "email": ROOT_EMAIL, "password": PASSWORD })),
    )
    .await;
  assert_eq!(status, StatusCode::UNAUTHORIZED);
  assert!(
    body["error"]["AUTHENTICATION_INVALID"].is_string(),
    "{body}"
  );

  // A user's password doesn't open the console either.
  let (status, body) = app
    .request(
      Method::POST,
      "/api/v1/console/login",
      Some(json!({ "email": "ada@example.com", "password": PASSWORD })),
    )
    .await;
  assert_eq!(status, StatusCode::UNAUTHORIZED);
  assert!(
    body["error"]["AUTHENTICATION_INVALID"].is_string(),
    "{body}"
  );

  // Each token only works on its own side.
  let user = app.login("ada@example.com", PASSWORD).await;
  let (status, _) = app
    .request_with(Method::GET, "/api/v1/auth/me", None, Some(&root))
    .await;
  assert_eq!(status, StatusCode::FORBIDDEN);
  let (status, _) = app
    .request_with(Method::GET, "/api/v1/console/me", None, Some(&user))
    .await;
  assert_eq!(status, StatusCode::FORBIDDEN);

  let (status, me) = app
    .request_with(Method::GET, "/api/v1/console/me", None, Some(&root))
    .await;
  assert_eq!(status, StatusCode::OK);
  assert_eq!(me["data"]["role"], "root");
  assert_eq!(me["data"]["email"], ROOT_EMAIL);
}

fn cookie_value(
  reply: &crate::support::Reply,
  name: &str,
) -> Option<String> {
  reply
    .headers
    .get_all("set-cookie")
    .iter()
    .filter_map(|value| value.to_str().ok())
    .find(|value| value.starts_with(&format!("{name}=")))
    .map(str::to_owned)
}

#[tokio::test]
async fn the_console_keeps_its_session_in_its_own_cookie() {
  let app = TestApp::new().await;
  app.root_token().await;
  let reply = app
    .call(
      Method::POST,
      "/api/v1/console/login",
      Some(json!({ "email": ROOT_EMAIL, "password": PASSWORD })),
      None,
      &[("x-dopgate-session", "cookie")],
    )
    .await;
  assert_eq!(reply.status, StatusCode::OK);
  assert!(reply.json["data"]["refreshToken"].is_null());
  let cookie = cookie_value(&reply, "dopgate_console").expect("the console cookie is set");
  assert!(cookie.contains("HttpOnly"));
  assert!(cookie.contains("Path=/api/v1/console"));
  let refresh = cookie
    .split(';')
    .next()
    .unwrap()
    .trim_start_matches("dopgate_console=")
    .to_owned();

  // The app's refresh endpoint doesn't know console refresh tokens.
  let (status, _) = app
    .request(
      Method::POST,
      "/api/v1/auth/refresh",
      Some(json!({ "refreshToken": refresh })),
    )
    .await;
  assert_eq!(status, StatusCode::UNAUTHORIZED);

  let reply = app
    .call(
      Method::POST,
      "/api/v1/console/refresh",
      None,
      None,
      &[
        ("x-dopgate-session", "cookie"),
        ("cookie", &format!("dopgate_console={refresh}")),
      ],
    )
    .await;
  assert_eq!(reply.status, StatusCode::OK, "{}", reply.json);
  assert_eq!(reply.json["data"]["admin"]["role"], "root");

  // Using the old refresh token again ends the session.
  let (status, _) = app
    .request(
      Method::POST,
      "/api/v1/console/refresh",
      Some(json!({ "refreshToken": refresh })),
    )
    .await;
  assert_eq!(status, StatusCode::UNAUTHORIZED);
}

async fn app_with_mail() -> (TestApp, FakeSmtp, String) {
  let smtp = FakeSmtp::start().await;
  let app = TestApp::with(|config| use_smtp(config, &smtp)).await;
  let root = app.root_token().await;
  (app, smtp, root)
}

async fn post(
  app: &TestApp,
  path: &str,
  body: Value,
) -> (StatusCode, Value) {
  app.request(Method::POST, path, Some(body)).await
}

#[tokio::test]
async fn an_admin_without_a_password_signs_in_with_a_code() {
  let (app, smtp, root) = app_with_mail().await;
  let (status, _) = app
    .request_with(
      Method::POST,
      "/api/v1/admin/admins",
      Some(json!({ "email": "ana@example.com" })),
      Some(&root),
    )
    .await;
  assert_eq!(status, StatusCode::CREATED);
  let (status, _) = post(
    &app,
    "/api/v1/console/codes/send",
    json!({ "email": "ana@example.com" }),
  )
  .await;
  assert_eq!(status, StatusCode::OK);
  let code = smtp.code_for("ana@example.com").await;

  // The code is the console's: the app's confirm endpoint doesn't take it.
  let (status, _) = post(
    &app,
    "/api/v1/auth/verification/confirm",
    json!({ "email": "ana@example.com", "purpose": "login", "code": code }),
  )
  .await;
  assert_eq!(status, StatusCode::BAD_REQUEST);

  let (status, body) = post(
    &app,
    "/api/v1/console/codes/confirm",
    json!({ "email": "ana@example.com", "purpose": "login", "code": code }),
  )
  .await;
  assert_eq!(status, StatusCode::OK, "{body}");
  assert_eq!(body["data"]["admin"]["role"], "admin");
  assert!(body["data"]["accessToken"].is_string());
}

#[tokio::test]
async fn an_admin_resets_a_forgotten_password() {
  let (app, smtp, root) = app_with_mail().await;
  let session = app.console_login(ROOT_EMAIL, PASSWORD).await;
  let (status, _) = post(
    &app,
    "/api/v1/console/password/forgot",
    json!({ "email": ROOT_EMAIL }),
  )
  .await;
  assert_eq!(status, StatusCode::OK);
  let code = smtp.code_for(ROOT_EMAIL).await;
  let (status, body) = post(
    &app,
    "/api/v1/console/password/reset",
    json!({ "email": ROOT_EMAIL, "code": code, "newPassword": "a brand new password" }),
  )
  .await;
  assert_eq!(status, StatusCode::OK, "{body}");
  for token in [root, session] {
    let (status, _) = app
      .request_with(Method::GET, "/api/v1/console/me", None, Some(&token))
      .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
  }
  app.console_login(ROOT_EMAIL, "a brand new password").await;
}

#[tokio::test]
async fn wrong_passwords_lock_the_admin_but_not_a_user_with_the_same_email() {
  let app = TestApp::new().await;
  let root = app.root_token().await;
  app.create_user(&root, ROOT_EMAIL).await;
  for _ in 0..5 {
    let (status, _) = post(
      &app,
      "/api/v1/console/login",
      json!({ "email": ROOT_EMAIL, "password": "wrong password here" }),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
  }
  let (status, _) = post(
    &app,
    "/api/v1/console/login",
    json!({ "email": ROOT_EMAIL, "password": PASSWORD }),
  )
  .await;
  assert_eq!(status, StatusCode::UNAUTHORIZED, "the admin is locked");
  app.login(ROOT_EMAIL, PASSWORD).await;
}
