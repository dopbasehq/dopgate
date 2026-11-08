//! Delivery through a real SMTP exchange is covered by the settings tests.

use app::services::mailer::{self, Message, SmtpConfig, SmtpSecurity};

fn message(to: &str) -> Message {
  Message {
    to: to.into(),
    subject: "Your code".into(),
    text: "123456".into(),
  }
}

#[tokio::test]
async fn without_smtp_the_message_goes_to_the_log() {
  mailer::send(None, &message("user@example.com"))
    .await
    .unwrap();
}

#[tokio::test]
async fn a_bad_recipient_is_refused_before_connecting() {
  // Nothing listens on port 1, so reaching the network would fail differently.
  let config = SmtpConfig {
    host: "127.0.0.1".into(),
    port: 1,
    security: SmtpSecurity::None,
    username: None,
    password: None,
    from_email: "no-reply@example.com".into(),
    from_name: None,
  };
  let error = mailer::send(Some(&config), &message("not an address"))
    .await
    .unwrap_err();
  assert!(error.0.contains("recipient"), "{error}");
}

#[test]
fn each_security_mode_has_its_usual_port() {
  assert_eq!(SmtpSecurity::Starttls.default_port(), 587);
  assert_eq!(SmtpSecurity::Tls.default_port(), 465);
  assert_eq!(SmtpSecurity::None.default_port(), 25);
}
