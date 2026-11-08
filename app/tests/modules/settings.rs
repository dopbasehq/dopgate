//! Runtime settings, called through the service: the admin routes answer
//! 501 until access tokens land, so they cannot be reached over HTTP yet.

use app::{
  config::SmtpServerConfig,
  models::{AuthIdentity, Role},
  modules::{
    bootstrap,
    settings::{model::*, service},
  },
  services::{crypto, mailer::SmtpSecurity},
};
use axum::http::StatusCode;
use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::{Value, json};

use crate::support::{TestApp, smtp::FakeSmtp};

async fn root(app: &TestApp) -> AuthIdentity {
  let user_id = bootstrap::service::create_root(&app.state.db, "root@example.com", "correct-horse")
    .await
    .unwrap();
  AuthIdentity::User {
    user_id,
    email: "root@example.com".into(),
    role: Role::Root,
    session_id: "ses_test".into(),
  }
}

async fn update(
  app: &TestApp,
  actor: &AuthIdentity,
  changes: Value,
) -> Result<Value, app::http::HttpError> {
  let request: UpdateSettingsRequest = serde_json::from_value(changes).unwrap();
  service::update(&app.state, actor, request)
    .await
    .map(|settings| serde_json::to_value(settings).unwrap())
}

async fn send_test(
  app: &TestApp,
  to: &str,
) -> Result<(), app::http::HttpError> {
  service::test_smtp(
    &app.state,
    serde_json::from_value(json!({ "to": to })).unwrap(),
  )
  .await
}

async fn setting_rows(app: &TestApp) -> i64 {
  sqlx::query_scalar("SELECT COUNT(*) FROM settings")
    .fetch_one(app.state.db.pool())
    .await
    .unwrap()
}

#[tokio::test]
async fn a_new_instance_has_defaults_and_logs_mail() {
  let app = TestApp::new().await;
  let settings = serde_json::to_value(service::get(&app.state).await.unwrap()).unwrap();
  assert_eq!(
    settings["smtp"],
    json!({
      "host": null, "port": 587, "username": null, "passwordSet": false,
      "security": "starttls", "fromEmail": null, "fromName": null, "source": "log",
    })
  );
  assert_eq!(settings["signup"]["enabled"], true);
  assert_eq!(settings["password"]["minLength"], 8);
  assert_eq!(settings["tokens"]["accessTokenMinutes"], 15);
  assert_eq!(settings["branding"]["appName"], "dopgate");
  assert!(service::smtp_config(&app.state).await.unwrap().is_none());
}

#[tokio::test]
async fn smtp_settings_save_with_the_password_encrypted_and_audited() {
  let app = TestApp::new().await;
  let actor = root(&app).await;
  let settings = update(
    &app,
    &actor,
    json!({"smtp": {
      "host": " smtp.example.com ", "port": 2525, "username": "dopgate",
      "password": "s3cret pass", "security": "tls",
      "fromEmail": "No-Reply@Example.com", "fromName": "Example",
    }}),
  )
  .await
  .unwrap();
  assert_eq!(
    settings["smtp"],
    json!({
      "host": "smtp.example.com", "port": 2525, "username": "dopgate", "passwordSet": true,
      "security": "tls", "fromEmail": "no-reply@example.com", "fromName": "Example",
      "source": "settings",
    })
  );

  let (value, ciphertext, nonce): (Option<String>, Vec<u8>, Vec<u8>) =
    sqlx::query_as("SELECT value, ciphertext, nonce FROM settings WHERE key = 'smtp.password'")
      .fetch_one(app.state.db.pool())
      .await
      .unwrap();
  assert!(value.is_none());
  let clear = app
    .state
    .crypto
    .decrypt_master(&ciphertext, &nonce, &crypto::setting_aad("smtp.password"))
    .unwrap();
  assert_eq!(clear, b"s3cret pass");
  let config = service::smtp_config(&app.state).await.unwrap().unwrap();
  assert_eq!(config.password.as_deref().unwrap().as_str(), "s3cret pass");

  let (action, actor_id, metadata): (String, String, String) =
    sqlx::query_as("SELECT action, actor_id, metadata FROM audit_events ORDER BY seq DESC LIMIT 1")
      .fetch_one(app.state.db.pool())
      .await
      .unwrap();
  assert_eq!(action, "settings.updated");
  assert_eq!(actor_id, actor.actor_id());
  let metadata: Value = serde_json::from_str(&metadata).unwrap();
  assert_eq!(
    metadata,
    json!({"sections": ["smtp"], "smtpPasswordChanged": true})
  );
}

#[tokio::test]
async fn left_out_fields_stay_and_empty_strings_clear_them() {
  let app = TestApp::new().await;
  let actor = root(&app).await;
  let full = json!({"smtp": {
    "host": "smtp.example.com", "username": "dopgate", "password": "s3cret",
    "fromEmail": "no-reply@example.com",
  }});
  let settings = update(&app, &actor, full).await.unwrap();
  assert_eq!(settings["smtp"]["port"], 587);

  // Without a saved port, the port follows the security mode.
  let settings = update(&app, &actor, json!({"smtp": {"security": "tls"}}))
    .await
    .unwrap();
  assert_eq!(settings["smtp"]["port"], 465);
  assert_eq!(settings["smtp"]["host"], "smtp.example.com");
  assert_eq!(settings["smtp"]["passwordSet"], true);

  let settings = update(&app, &actor, json!({"smtp": {"port": 2525}}))
    .await
    .unwrap();
  assert_eq!(settings["smtp"]["port"], 2525);
  assert_eq!(settings["smtp"]["security"], "tls");

  let settings = update(&app, &actor, json!({"smtp": {"host": "", "password": ""}}))
    .await
    .unwrap();
  assert_eq!(settings["smtp"]["host"], Value::Null);
  assert_eq!(settings["smtp"]["passwordSet"], false);
  assert_eq!(settings["smtp"]["username"], "dopgate");
  assert!(service::smtp_config(&app.state).await.unwrap().is_none());
}

#[tokio::test]
async fn bad_smtp_values_are_refused_and_nothing_is_saved() {
  let app = TestApp::new().await;
  let actor = root(&app).await;
  let from = "no-reply@example.com";
  for smtp in [
    json!({"host": "smtp://smtp.example.com", "fromEmail": from}),
    json!({"host": "smtp.example.com:587", "fromEmail": from}),
    json!({"host": "smtp.example.com"}),
    json!({"host": "smtp.example.com", "fromEmail": "not-an-address"}),
    json!({"host": "smtp.example.com", "fromEmail": from, "fromName": "Acme\r\nBcc: x@example.com"}),
    json!({"username": "dop\ngate"}),
    json!({"port": 0}),
  ] {
    let error = update(&app, &actor, json!({ "smtp": smtp }))
      .await
      .unwrap_err();
    assert_eq!(error.status, StatusCode::BAD_REQUEST, "{smtp}");
    assert!(error.errors.contains_key("SETTINGS_INVALID"), "{smtp}");
  }
  assert_eq!(setting_rows(&app).await, 0);

  // An IPv6 address keeps its colons.
  let settings = update(
    &app,
    &actor,
    json!({"smtp": {"host": "::1", "security": "none", "fromEmail": from}}),
  )
  .await
  .unwrap();
  assert_eq!(settings["smtp"]["host"], "::1");
  assert_eq!(settings["smtp"]["port"], 25);
}

#[tokio::test]
async fn other_sections_are_checked_then_saved() {
  let app = TestApp::new().await;
  let actor = root(&app).await;
  for changes in [
    json!({"password": {"minLength": 4}}),
    json!({"tokens": {"accessTokenMinutes": 0, "refreshTokenIdleDays": 30, "sessionAbsoluteDays": 90}}),
    json!({"tokens": {"accessTokenMinutes": 15, "refreshTokenIdleDays": 0, "sessionAbsoluteDays": 90}}),
    json!({"branding": {"appName": "  "}}),
    json!({"branding": {"appName": "Acme", "logoUrl": "javascript:alert(1)"}}),
  ] {
    let error = update(&app, &actor, changes.clone()).await.unwrap_err();
    assert!(error.errors.contains_key("SETTINGS_INVALID"), "{changes}");
  }
  assert_eq!(setting_rows(&app).await, 0);

  let settings = update(
    &app,
    &actor,
    json!({
      "signup": {"enabled": false, "requireEmailVerification": true, "passwordlessSignup": false},
      "password": {"minLength": 12},
      "branding": {"appName": " Acme ", "logoUrl": "https://acme.example/logo.png"},
    }),
  )
  .await
  .unwrap();
  assert_eq!(settings["signup"]["enabled"], false);
  assert_eq!(settings["signup"]["requireEmailVerification"], true);
  assert_eq!(settings["password"]["minLength"], 12);
  assert_eq!(settings["branding"]["appName"], "Acme");
  assert_eq!(settings["tokens"]["accessTokenMinutes"], 15);
  assert_eq!(setting_rows(&app).await, 3);
}

#[tokio::test]
async fn a_test_message_needs_a_recipient_and_a_host() {
  let app = TestApp::new().await;
  let error = send_test(&app, "not-an-address").await.unwrap_err();
  assert!(error.errors.contains_key("EMAIL_INVALID"));
  let error = send_test(&app, "admin@example.com").await.unwrap_err();
  assert_eq!(error.status, StatusCode::BAD_REQUEST);
  assert!(error.errors.contains_key("SMTP_NOT_CONFIGURED"));
}

#[tokio::test]
async fn a_test_message_goes_out_with_the_saved_login() {
  let app = TestApp::new().await;
  let actor = root(&app).await;
  let server = FakeSmtp::start().await;
  update(
    &app,
    &actor,
    json!({
      "smtp": {
        "host": "127.0.0.1", "port": server.port, "security": "none",
        "username": "dopgate", "password": "s3cret",
        "fromEmail": "no-reply@example.com", "fromName": "Acme",
      },
      "branding": {"appName": "Acme"},
    }),
  )
  .await
  .unwrap();

  send_test(&app, "Admin@Example.com").await.unwrap();
  let received = server.received();
  let login = STANDARD.encode("\0dopgate\0s3cret");
  assert!(
    received.contains(&format!("AUTH PLAIN {login}")),
    "{received}"
  );
  assert!(received.contains("MAIL FROM:<no-reply@example.com>"));
  assert!(received.contains("RCPT TO:<admin@example.com>"));
  assert!(received.contains("Subject: Test message from Acme"));
  assert!(received.contains("Content-Type: text/plain"));
  assert!(received.contains("This is a test message from Acme."));
}

#[tokio::test]
async fn a_refused_test_message_reports_the_server_answer() {
  let app = TestApp::new().await;
  let actor = root(&app).await;
  let server = FakeSmtp::answering_rcpt("550 5.1.1 No such user").await;
  update(
    &app,
    &actor,
    json!({"smtp": {
      "host": "127.0.0.1", "port": server.port, "security": "none",
      "fromEmail": "no-reply@example.com",
    }}),
  )
  .await
  .unwrap();

  let error = send_test(&app, "nobody@example.com").await.unwrap_err();
  assert_eq!(error.status, StatusCode::BAD_GATEWAY);
  let message = &error.errors["SMTP_SEND_FAILED"];
  assert!(message.contains("No such user"), "{message}");
}

/// server.toml's SMTP is used while the settings have no host of their own.
#[tokio::test]
async fn server_toml_smtp_is_used_until_settings_set_a_host() {
  let server = FakeSmtp::start().await;
  let port = server.port;
  let app = TestApp::with(|config| {
    config.smtp = SmtpServerConfig {
      host: Some("127.0.0.1".into()),
      port: Some(port),
      security: SmtpSecurity::None,
      from_email: Some("file@example.com".into()),
      ..Default::default()
    };
  })
  .await;
  let actor = root(&app).await;
  let source = |settings: Value| settings["smtp"]["source"].clone();
  let settings = serde_json::to_value(service::get(&app.state).await.unwrap()).unwrap();
  assert_eq!(source(settings), "server_config");
  send_test(&app, "admin@example.com").await.unwrap();
  assert!(server.received().contains("MAIL FROM:<file@example.com>"));

  let settings = update(
    &app,
    &actor,
    json!({"smtp": {"host": "smtp.example.com", "fromEmail": "settings@example.com"}}),
  )
  .await
  .unwrap();
  assert_eq!(source(settings), "settings");
  let config = service::smtp_config(&app.state).await.unwrap().unwrap();
  assert_eq!(config.from_email, "settings@example.com");

  let settings = update(&app, &actor, json!({"smtp": {"host": ""}}))
    .await
    .unwrap();
  assert_eq!(source(settings), "server_config");
}
