//! Runtime settings over the admin API. SMTP comes from the environment and
//! is only reported.

use axum::http::{Method, StatusCode};
use serde_json::{Value, json};

use crate::support::{TestApp, smtp::FakeSmtp, use_smtp};

const SETTINGS: &str = "/api/v1/admin/settings";

async fn get(
  app: &TestApp,
  token: &str,
) -> Value {
  let (status, body) = app
    .request_with(Method::GET, SETTINGS, None, Some(token))
    .await;
  assert_eq!(status, StatusCode::OK, "{body}");
  body["data"].clone()
}

#[tokio::test]
async fn a_new_instance_has_defaults_and_logs_mail() {
  let app = TestApp::new().await;
  let root = app.root_token().await;
  let settings = get(&app, &root).await;
  assert_eq!(
    settings["smtp"],
    json!({
      "host": null, "port": 587, "username": null, "passwordSet": false,
      "security": "starttls", "fromEmail": null, "fromName": null, "source": "log",
    })
  );
  assert_eq!(settings["signup"]["enabled"], true);
  assert_eq!(settings["signup"]["requireEmailVerification"], true);
  assert_eq!(settings["signup"]["passwordlessSignup"], false);
  assert_eq!(settings["password"]["minLength"], 8);
  assert_eq!(settings["tokens"]["accessTokenMinutes"], 15);
  assert_eq!(
    settings["limits"],
    json!({
      "codeMinutes": 10, "codeMaxAttempts": 5, "codeResendSeconds": 60, "codesPerHour": 5,
      "lockoutAttempts": 5, "lockoutMinutes": 15, "ipRequestsPerMinute": 20,
    })
  );
  assert_eq!(settings["branding"]["appName"], "Dopgate");
}

#[tokio::test]
async fn smtp_from_the_environment_is_reported_without_its_password() {
  let smtp = FakeSmtp::start().await;
  let app = TestApp::with(|config| {
    use_smtp(config, &smtp);
    config.smtp.password = Some("hidden".into());
  })
  .await;
  let root = app.root_token().await;
  let settings = get(&app, &root).await;
  assert_eq!(settings["smtp"]["source"], "server_config");
  assert_eq!(settings["smtp"]["passwordSet"], true);
  assert!(!settings.to_string().contains("hidden"));
}

#[tokio::test]
async fn sections_save_and_are_audited() {
  let app = TestApp::new().await;
  let root = app.root_token().await;
  app
    .settings(
      &root,
      json!({
        "signup": { "enabled": false, "requireEmailVerification": false, "passwordlessSignup": true },
        "limits": { "codeMinutes": 5, "codeMaxAttempts": 3, "codeResendSeconds": 0, "codesPerHour": 10,
                    "lockoutAttempts": 3, "lockoutMinutes": 30, "ipRequestsPerMinute": 100 },
        "branding": { "appName": "  MyApp ", "logoUrl": "https://myapp.example.com/logo.png" },
      }),
    )
    .await;
  let settings = get(&app, &root).await;
  assert_eq!(settings["signup"]["enabled"], false);
  assert_eq!(settings["limits"]["codeMaxAttempts"], 3);
  assert_eq!(settings["branding"]["appName"], "MyApp");

  let (_, events) = app
    .request_with(
      Method::GET,
      "/api/v1/admin/audit-events?action=settings.updated",
      None,
      Some(&root),
    )
    .await;
  assert_eq!(
    events["data"]["items"][0]["metadata"]["sections"],
    json!(["signup", "limits", "branding"])
  );
}

#[tokio::test]
async fn bad_values_and_smtp_changes_are_refused() {
  let app = TestApp::new().await;
  let root = app.root_token().await;
  for patch in [
    json!({ "password": { "minLength": 4 } }),
    json!({ "tokens": { "accessTokenMinutes": 0, "refreshTokenIdleDays": 30, "sessionAbsoluteDays": 90 } }),
    json!({ "tokens": { "accessTokenMinutes": 15, "refreshTokenIdleDays": 100, "sessionAbsoluteDays": 90 } }),
    json!({ "limits": { "codeMinutes": 0 } }),
    json!({ "branding": { "appName": "" } }),
    json!({ "branding": { "appName": "x", "logoUrl": "javascript:alert(1)" } }),
    json!({ "smtp": { "host": "smtp.example.com" } }),
  ] {
    let (status, body) = app
      .request_with(Method::PATCH, SETTINGS, Some(patch.clone()), Some(&root))
      .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{patch}: {body}");
    assert!(body["error"]["SETTINGS_INVALID"].is_string());
  }
}

#[tokio::test]
async fn members_cannot_read_settings_but_the_service_key_can() {
  let key = "k".repeat(40);
  let service_key = key.clone();
  let app = TestApp::with(move |config| {
    config.service_key = Some(zeroize::Zeroizing::new(service_key));
  })
  .await;
  let root = app.root_token().await;
  app.create_user(&root, "member@example.com", "member").await;
  let member = app
    .login("member@example.com", crate::support::PASSWORD)
    .await;
  let (status, _) = app
    .request_with(Method::GET, SETTINGS, None, Some(&member))
    .await;
  assert_eq!(status, StatusCode::FORBIDDEN);
  let (status, _) = app
    .request_with(Method::GET, SETTINGS, None, Some(&key))
    .await;
  assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn the_test_message_goes_to_the_admin_through_smtp() {
  let smtp = FakeSmtp::start().await;
  let app = TestApp::with(|config| use_smtp(config, &smtp)).await;
  let root = app.root_token().await;
  let (status, body) = app
    .request_with(
      Method::POST,
      "/api/v1/admin/settings/smtp/test",
      None,
      Some(&root),
    )
    .await;
  assert_eq!(status, StatusCode::OK, "{body}");
  assert_eq!(smtp.wait_for(crate::support::ROOT_EMAIL, 1).await, 1);
  assert!(smtp.received().contains("Test message from Dopgate"));
}

#[tokio::test]
async fn a_refused_test_message_reports_the_server_reply() {
  let smtp = FakeSmtp::answering_rcpt("550 5.1.1 mailbox unavailable").await;
  let app = TestApp::with(|config| use_smtp(config, &smtp)).await;
  let root = app.root_token().await;
  let (status, body) = app
    .request_with(
      Method::POST,
      "/api/v1/admin/settings/smtp/test",
      Some(json!({ "to": "someone@example.com" })),
      Some(&root),
    )
    .await;
  assert_eq!(status, StatusCode::BAD_GATEWAY);
  assert!(
    body["error"]["SMTP_SEND_FAILED"]
      .as_str()
      .unwrap()
      .contains("mailbox unavailable")
  );
}

#[tokio::test]
async fn testing_without_smtp_explains_what_to_set() {
  let app = TestApp::new().await;
  let root = app.root_token().await;
  let (status, body) = app
    .request_with(
      Method::POST,
      "/api/v1/admin/settings/smtp/test",
      None,
      Some(&root),
    )
    .await;
  assert_eq!(status, StatusCode::BAD_REQUEST);
  assert!(
    body["error"]["SMTP_NOT_CONFIGURED"]
      .as_str()
      .unwrap()
      .contains("DOPGATE_SMTP_HOST")
  );
}
