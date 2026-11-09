//! Sign-up, sign-in, tokens, and the signed-in account, end to end.

use axum::http::{Method, StatusCode};
use serde_json::{Value, json};

use crate::support::{PASSWORD, TestApp};

async fn signup(
  app: &TestApp,
  email: &str,
) -> (StatusCode, Value) {
  app
    .request(
      Method::POST,
      "/api/v1/auth/signup",
      Some(json!({ "email": email, "password": PASSWORD, "displayName": "Ada" })),
    )
    .await
}

#[tokio::test]
async fn sign_in_waits_for_a_verified_email_by_default() {
  let app = TestApp::new().await;
  let (status, body) = signup(&app, " Ada@Example.com ").await;
  assert_eq!(status, StatusCode::CREATED, "{body}");
  assert_eq!(body["data"]["user"]["email"], "ada@example.com");
  assert_eq!(body["data"]["verificationRequired"], true);
  assert!(body["data"]["tokens"].is_null());
  let (status, body) = app
    .request(
      Method::POST,
      "/api/v1/auth/login",
      Some(json!({ "email": "ada@example.com", "password": PASSWORD })),
    )
    .await;
  assert_eq!(status, StatusCode::FORBIDDEN);
  assert!(body["error"]["EMAIL_NOT_VERIFIED"].is_string());
}

#[tokio::test]
async fn without_the_verification_rule_signup_signs_in_at_once() {
  let app = TestApp::new().await;
  let root = app.root_token().await;
  app
    .settings(&root, json!({ "signup": { "enabled": true, "requireEmailVerification": false, "passwordlessSignup": false } }))
    .await;
  let (status, body) = signup(&app, "ada@example.com").await;
  assert_eq!(status, StatusCode::CREATED);
  let token = body["data"]["tokens"]["accessToken"].as_str().unwrap();
  let (status, me) = app
    .request_with(Method::GET, "/api/v1/auth/me", None, Some(token))
    .await;
  assert_eq!(status, StatusCode::OK);
  assert_eq!(me["data"]["emailVerified"], false);
}

#[tokio::test]
async fn signup_refuses_taken_emails_weak_passwords_and_closed_signup() {
  let app = TestApp::new().await;
  assert_eq!(signup(&app, "ada@example.com").await.0, StatusCode::CREATED);
  let (status, body) = signup(&app, "ADA@example.com").await;
  assert_eq!(status, StatusCode::CONFLICT);
  assert!(body["error"]["EMAIL_TAKEN"].is_string());

  let (status, body) = app
    .request(
      Method::POST,
      "/api/v1/auth/signup",
      Some(json!({ "email": "bob@example.com", "password": "short" })),
    )
    .await;
  assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
  assert!(body["error"]["PASSWORD_INVALID"].is_string());

  let (status, _) = signup(&app, "not-an-email").await;
  assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

  let root = app.root_token().await;
  app
    .settings(&root, json!({ "signup": { "enabled": false, "requireEmailVerification": true, "passwordlessSignup": false } }))
    .await;
  let (status, body) = signup(&app, "carl@example.com").await;
  assert_eq!(status, StatusCode::FORBIDDEN);
  assert!(body["error"]["SIGNUP_DISABLED"].is_string());
}

#[tokio::test]
async fn refresh_tokens_rotate_and_a_reused_one_ends_the_session() {
  let app = TestApp::new().await;
  app.root_token().await;
  let (_, body) = app
    .request(
      Method::POST,
      "/api/v1/auth/login",
      Some(json!({ "email": crate::support::ROOT_EMAIL, "password": PASSWORD })),
    )
    .await;
  let first = body["data"]["refreshToken"].as_str().unwrap().to_owned();
  let access = body["data"]["accessToken"].as_str().unwrap().to_owned();
  let refresh = |token: String| {
    let app = &app;
    async move {
      app
        .request(
          Method::POST,
          "/api/v1/auth/refresh",
          Some(json!({ "refreshToken": token })),
        )
        .await
    }
  };
  let (status, body) = refresh(first.clone()).await;
  assert_eq!(status, StatusCode::OK, "{body}");
  let second = body["data"]["refreshToken"].as_str().unwrap().to_owned();
  assert_ne!(first, second);

  // The first token comes back: someone copied it, so the session ends.
  let (status, _) = refresh(first).await;
  assert_eq!(status, StatusCode::UNAUTHORIZED);
  let (status, _) = refresh(second).await;
  assert_eq!(status, StatusCode::UNAUTHORIZED);
  let (status, _) = app
    .request_with(Method::GET, "/api/v1/auth/me", None, Some(&access))
    .await;
  assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn cookie_mode_keeps_the_refresh_token_out_of_the_body() {
  let app = TestApp::new().await;
  app.root_token().await;
  let reply = app
    .call(
      Method::POST,
      "/api/v1/auth/login",
      Some(json!({ "email": crate::support::ROOT_EMAIL, "password": PASSWORD })),
      None,
      &[("x-dopgate-session", "cookie")],
    )
    .await;
  assert_eq!(reply.status, StatusCode::OK);
  assert!(reply.json["data"]["refreshToken"].is_null());
  let cookie = reply.headers["set-cookie"].to_str().unwrap().to_owned();
  assert!(cookie.contains("HttpOnly"));
  assert!(cookie.contains("SameSite=Strict"));
  assert!(cookie.contains("Path=/api/v1/auth"));
  let pair = cookie.split(';').next().unwrap().to_owned();

  let reply = app
    .call(
      Method::POST,
      "/api/v1/auth/refresh",
      Some(json!({})),
      None,
      &[("x-dopgate-session", "cookie"), ("cookie", &pair)],
    )
    .await;
  assert_eq!(reply.status, StatusCode::OK, "{}", reply.json);
  assert!(reply.json["data"]["accessToken"].is_string());
  let pair = reply.headers["set-cookie"]
    .to_str()
    .unwrap()
    .split(';')
    .next()
    .unwrap()
    .to_owned();

  // Signing out with only the cookie works and clears it.
  let reply = app
    .call(
      Method::POST,
      "/api/v1/auth/logout",
      Some(json!({})),
      None,
      &[("x-dopgate-session", "cookie"), ("cookie", &pair)],
    )
    .await;
  assert_eq!(reply.status, StatusCode::OK);
  assert!(
    reply.headers["set-cookie"]
      .to_str()
      .unwrap()
      .contains("Max-Age=0")
  );
  let reply = app
    .call(
      Method::POST,
      "/api/v1/auth/refresh",
      Some(json!({})),
      None,
      &[("cookie", &pair)],
    )
    .await;
  assert_eq!(reply.status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn the_profile_reads_and_changes_its_own_fields_only() {
  let app = TestApp::new().await;
  let root = app.root_token().await;
  let id = app.create_user(&root, "ada@example.com", "member").await;
  sqlx::query("UPDATE users SET public_metadata = '{\"plan\":\"pro\"}' WHERE id = $1")
    .bind(&id)
    .execute(app.state.db.pool())
    .await
    .unwrap();
  let token = app.login("ada@example.com", PASSWORD).await;
  let (status, body) = app
    .request_with(
      Method::PATCH,
      "/api/v1/auth/me",
      Some(json!({
        "displayName": "  Ada L ",
        "avatarUrl": "https://cdn.example.com/a.png",
        "userMetadata": { "theme": "dark" },
        "publicMetadata": { "plan": "free" },
      })),
      Some(&token),
    )
    .await;
  assert_eq!(status, StatusCode::OK, "{body}");
  assert_eq!(body["data"]["displayName"], "Ada L");
  assert_eq!(body["data"]["userMetadata"]["theme"], "dark");
  // The user can't change what the app sets.
  assert_eq!(body["data"]["publicMetadata"]["plan"], "pro");
  assert!(body["data"].get("privateMetadata").is_none());

  for patch in [
    json!({ "avatarUrl": "javascript:alert(1)" }),
    json!({ "userMetadata": [1, 2] }),
    json!({ "displayName": "x".repeat(300) }),
  ] {
    let (status, _) = app
      .request_with(
        Method::PATCH,
        "/api/v1/auth/me",
        Some(patch.clone()),
        Some(&token),
      )
      .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{patch}");
  }

  let (_, body) = app
    .request_with(
      Method::PATCH,
      "/api/v1/auth/me",
      Some(json!({ "displayName": "" })),
      Some(&token),
    )
    .await;
  assert!(body["data"]["displayName"].is_null());
}

#[tokio::test]
async fn changing_the_password_ends_other_sessions() {
  let app = TestApp::new().await;
  let root = app.root_token().await;
  app.create_user(&root, "ada@example.com", "member").await;
  let laptop = app.login("ada@example.com", PASSWORD).await;
  let phone = app.login("ada@example.com", PASSWORD).await;

  let (status, body) = app
    .request_with(
      Method::POST,
      "/api/v1/auth/password/change",
      Some(json!({ "currentPassword": "wrong", "newPassword": "a brand new password" })),
      Some(&laptop),
    )
    .await;
  assert_eq!(status, StatusCode::UNAUTHORIZED, "{body}");

  let (status, _) = app
    .request_with(
      Method::POST,
      "/api/v1/auth/password/change",
      Some(json!({ "currentPassword": PASSWORD, "newPassword": "a brand new password" })),
      Some(&laptop),
    )
    .await;
  assert_eq!(status, StatusCode::OK);
  assert_eq!(me(&app, &laptop).await, StatusCode::OK);
  assert_eq!(me(&app, &phone).await, StatusCode::UNAUTHORIZED);
  app.login("ada@example.com", "a brand new password").await;
}

#[tokio::test]
async fn sign_in_methods_describe_the_instance() {
  let app = TestApp::new().await;
  let (status, body) = app.request(Method::GET, "/api/v1/auth/methods", None).await;
  assert_eq!(status, StatusCode::OK);
  assert_eq!(body["data"]["signupEnabled"], true);
  assert_eq!(body["data"]["emailOtp"], true);
  assert_eq!(body["data"]["emailVerificationRequired"], true);
  assert_eq!(body["data"]["branding"]["appName"], "Dopgate");
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
