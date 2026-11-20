//! Email templates: built-in versions, overrides, previews, and sending.

use axum::http::{Method, StatusCode};
use serde_json::json;

use crate::support::{TestApp, smtp::FakeSmtp, use_smtp};

const BASE: &str = "/api/v1/admin/email-templates";

#[tokio::test]
async fn every_template_works_out_of_the_box() {
  let app = TestApp::new().await;
  let root = app.root_token().await;
  let (status, body) = app.request_with(Method::GET, BASE, None, Some(&root)).await;
  assert_eq!(status, StatusCode::OK);
  let names: Vec<&str> = body["data"]
    .as_array()
    .unwrap()
    .iter()
    .map(|template| template["name"].as_str().unwrap())
    .collect();
  assert_eq!(
    names,
    [
      "verify_email",
      "login_code",
      "password_reset",
      "email_change",
      "email_changed",
      "password_changed"
    ]
  );
  assert!(
    body["data"]
      .as_array()
      .unwrap()
      .iter()
      .all(|t| t["customized"] == false)
  );

  let (_, detail) = app
    .request_with(
      Method::GET,
      &format!("{BASE}/verify_email"),
      None,
      Some(&root),
    )
    .await;
  assert!(
    detail["data"]["variables"]
      .as_array()
      .unwrap()
      .contains(&json!("code"))
  );
  assert_eq!(
    detail["data"]["subject"],
    detail["data"]["defaults"]["subject"]
  );
}

#[tokio::test]
async fn an_override_is_used_for_real_mail_until_reset() {
  let smtp = FakeSmtp::start().await;
  let app = TestApp::with(|config| use_smtp(config, &smtp)).await;
  let root = app.root_token().await;
  let (status, body) = app
    .request_with(
      Method::PUT,
      &format!("{BASE}/login_code"),
      Some(json!({
        "subject": "{{ app_name }} login {{code}}",
        "html": "<p>Code: <b>{{code}}</b></p>",
        "text": "Custom text\n\n{{code}}\n",
      })),
      Some(&root),
    )
    .await;
  assert_eq!(status, StatusCode::OK, "{body}");
  assert_eq!(body["data"]["customized"], true);

  app
    .request(
      Method::POST,
      "/api/v1/console/codes/send",
      Some(json!({ "email": crate::support::ROOT_EMAIL })),
    )
    .await;
  smtp.code_for(crate::support::ROOT_EMAIL).await;
  let message = smtp.messages_to(crate::support::ROOT_EMAIL).pop().unwrap();
  assert!(message.contains("Custom text"), "{message}");
  assert!(message.contains("Dopgate login"));

  let (_, body) = app
    .request_with(
      Method::DELETE,
      &format!("{BASE}/login_code"),
      None,
      Some(&root),
    )
    .await;
  assert_eq!(body["data"]["customized"], false);
}

#[tokio::test]
async fn a_test_goes_to_root_or_the_saved_test_address() {
  let smtp = FakeSmtp::start().await;
  let key = "k".repeat(40);
  let service_key = key.clone();
  let fake = &smtp;
  let app = TestApp::with(move |config| {
    use_smtp(config, fake);
    config.service_key = Some(zeroize::Zeroizing::new(service_key));
  })
  .await;
  let root = app.root_token().await;
  let draft =
    json!({ "subject": "Test {{code}}", "html": "<p>{{email}}</p>", "text": "{{email}}" });
  let send_test = |token: String| {
    let app = &app;
    let draft = draft.clone();
    async move {
      let (status, body) = app
        .request_with(
          Method::POST,
          &format!("{BASE}/login_code/test"),
          Some(draft),
          Some(&token),
        )
        .await;
      assert_eq!(status, StatusCode::OK, "{body}");
    }
  };

  // The service key has no email of its own, so root gets it.
  send_test(key.clone()).await;
  assert_eq!(smtp.wait_for(crate::support::ROOT_EMAIL, 1).await, 1);

  app
    .settings(
      &root,
      json!({ "testEmail": { "recipient": "qa@example.com" } }),
    )
    .await;
  send_test(root).await;
  assert_eq!(smtp.wait_for("qa@example.com", 1).await, 1);
  let message = smtp.messages_to("qa@example.com").pop().unwrap();
  assert!(message.contains("qa@example.com"), "{message}");
}

#[tokio::test]
async fn unknown_variables_and_empty_parts_are_refused() {
  let app = TestApp::new().await;
  let root = app.root_token().await;
  for draft in [
    json!({ "subject": "Hi {{reset_link}}", "html": "<p>x</p>", "text": "x" }),
    json!({ "subject": "Hi", "html": "<p>{{code</p>", "text": "x" }),
    json!({ "subject": "", "html": "<p>x</p>", "text": "x" }),
    json!({ "subject": "Hi", "html": " ", "text": "x" }),
    json!({ "subject": "Hi {{new_email}}", "html": "<p>x</p>", "text": "x" }),
  ] {
    let (status, body) = app
      .request_with(
        Method::PUT,
        &format!("{BASE}/login_code"),
        Some(draft.clone()),
        Some(&root),
      )
      .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{draft}");
    assert!(body["error"]["TEMPLATE_INVALID"].is_string());
  }
  let (status, _) = app
    .request_with(
      Method::GET,
      &format!("{BASE}/no_such_template"),
      None,
      Some(&root),
    )
    .await;
  assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn previews_escape_values_in_html_only() {
  let app = TestApp::new().await;
  let root = app.root_token().await;
  app
    .settings(&root, json!({ "branding": { "appName": "A & B <Co>" } }))
    .await;
  let (status, body) = app
    .request_with(
      Method::POST,
      &format!("{BASE}/verify_email/preview"),
      Some(json!({ "subject": "{{app_name}}", "html": "<h1>{{app_name}}</h1>", "text": "{{app_name}} {{code}}" })),
      Some(&root),
    )
    .await;
  assert_eq!(status, StatusCode::OK, "{body}");
  assert_eq!(body["data"]["html"], "<h1>A &amp; B &lt;Co&gt;</h1>");
  assert_eq!(body["data"]["text"], "A & B <Co> 482913");
  assert_eq!(body["data"]["subject"], "A & B <Co>");
}

#[tokio::test]
async fn members_cannot_touch_templates() {
  let app = TestApp::new().await;
  let root = app.root_token().await;
  app.create_user(&root, "member@example.com").await;
  let member = app
    .login("member@example.com", crate::support::PASSWORD)
    .await;
  let (status, _) = app
    .request_with(Method::GET, BASE, None, Some(&member))
    .await;
  assert_eq!(status, StatusCode::FORBIDDEN);
}

/// Code names a template with `Template`, the API with a string. Both reach
/// the same built-in text, and the list has each template once.
#[test]
fn every_template_dopgate_sends_is_one_of_the_built_in_ones() {
  use app::modules::email_templates::{Template, defaults};
  let sent = [
    (Template::VerifyEmail, "verify_email"),
    (Template::LoginCode, "login_code"),
    (Template::PasswordReset, "password_reset"),
    (Template::EmailChange, "email_change"),
    (Template::EmailChanged, "email_changed"),
    (Template::PasswordChanged, "password_changed"),
  ];
  assert_eq!(defaults::ALL.len(), sent.len());
  for (template, name) in sent {
    let builtin = template.builtin();
    assert_eq!(builtin.name, name);
    let found = defaults::find(name).unwrap();
    assert!(std::ptr::eq(found, builtin), "{name}");
    assert!(
      defaults::ALL
        .iter()
        .any(|listed| std::ptr::eq(*listed, builtin)),
      "{name}"
    );
  }
  assert!(defaults::find("no_such_template").is_none());
}
