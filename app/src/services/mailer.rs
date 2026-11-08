//! Outgoing email: verification codes, sign-in links, and password resets.
//!
//! Messages go out through the SMTP server stored in settings. Until one is
//! configured, the mailer writes each message to the server log, so local
//! development works without a mail server.

use std::time::Duration;

use lettre::{
  AsyncSmtpTransport, AsyncTransport, Tokio1Executor,
  message::{Mailbox, header::ContentType},
  transport::smtp::authentication::Credentials,
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use zeroize::Zeroizing;

use crate::constants::limits::SMTP_TIMEOUT_SECONDS;

/// One message, already rendered from its template.
pub struct Message {
  pub to: String,
  pub subject: String,
  pub text: String,
}

/// How the connection to the SMTP server is protected.
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SmtpSecurity {
  /// Upgrade a plain connection with STARTTLS, usually on port 587.
  #[default]
  Starttls,
  /// TLS from the first byte, usually on port 465.
  Tls,
  /// No encryption. Only for a relay on the same host or a private network.
  None,
}

impl std::str::FromStr for SmtpSecurity {
  type Err = String;

  fn from_str(value: &str) -> Result<Self, Self::Err> {
    match value {
      "starttls" => Ok(Self::Starttls),
      "tls" => Ok(Self::Tls),
      "none" => Ok(Self::None),
      other => Err(format!(
        "unknown SMTP security \"{other}\": use starttls, tls, or none"
      )),
    }
  }
}

impl SmtpSecurity {
  /// The port to use when the admin has not set one.
  pub fn default_port(self) -> u16 {
    match self {
      Self::Starttls => 587,
      Self::Tls => 465,
      Self::None => 25,
    }
  }
}

/// A configured SMTP server. Settings return none while no host is set.
pub struct SmtpConfig {
  pub host: String,
  pub port: u16,
  pub security: SmtpSecurity,
  pub username: Option<String>,
  pub password: Option<Zeroizing<String>>,
  pub from_email: String,
  pub from_name: Option<String>,
}

/// A host name or IP address. A scheme, port, or path is a common paste
/// mistake, so `:`, `/`, and `@` are refused outside an IPv6 address.
pub fn valid_host(host: &str) -> bool {
  host.len() <= 253
    && (host.parse::<std::net::Ipv6Addr>().is_ok()
      || !host
        .chars()
        .any(|c| c.is_whitespace() || c.is_control() || matches!(c, ':' | '/' | '@')))
}

/// The sender address, normalized, or `None` when it cannot be sent from.
pub fn normalize_from_email(address: &str) -> Option<String> {
  crate::utils::email::normalize(address)
    .filter(|address| address.parse::<lettre::Address>().is_ok())
}

/// Line breaks and other control characters would end up in mail headers.
pub fn header_safe(value: &str) -> bool {
  !value.chars().any(char::is_control)
}

/// Why a message did not go out. The text comes from the SMTP client or
/// server and is meant for admins, not end users.
#[derive(Debug)]
pub struct MailError(pub String);

impl std::fmt::Display for MailError {
  fn fmt(
    &self,
    formatter: &mut std::fmt::Formatter<'_>,
  ) -> std::fmt::Result {
    formatter.write_str(&self.0)
  }
}

impl std::error::Error for MailError {}

/// Send `message` through `config`, or write it to the log when there is no
/// SMTP server.
pub async fn send(
  config: Option<&SmtpConfig>,
  message: &Message,
) -> Result<(), MailError> {
  let Some(config) = config else {
    tracing::info!(
      to = %message.to,
      subject = %message.subject,
      "SMTP is not configured, so the message was logged instead of sent:\n{}",
      message.text
    );
    return Ok(());
  };
  let email = build(config, message)?;
  transport(config)?
    .send(email)
    .await
    .map(|_| ())
    .map_err(|error| MailError(error.to_string()))
}

fn build(
  config: &SmtpConfig,
  message: &Message,
) -> Result<lettre::Message, MailError> {
  let from_address = config
    .from_email
    .parse()
    .map_err(|error| MailError(format!("the from address is invalid: {error}")))?;
  let to: Mailbox = message
    .to
    .parse()
    .map_err(|error| MailError(format!("the recipient address is invalid: {error}")))?;
  lettre::Message::builder()
    .from(Mailbox::new(config.from_name.clone(), from_address))
    .to(to)
    .subject(&message.subject)
    .header(ContentType::TEXT_PLAIN)
    .body(message.text.clone())
    .map_err(|error| MailError(error.to_string()))
}

fn transport(config: &SmtpConfig) -> Result<AsyncSmtpTransport<Tokio1Executor>, MailError> {
  let builder = match config.security {
    SmtpSecurity::Starttls => AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&config.host),
    SmtpSecurity::Tls => AsyncSmtpTransport::<Tokio1Executor>::relay(&config.host),
    SmtpSecurity::None => Ok(AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(
      &config.host,
    )),
  }
  .map_err(|error| MailError(error.to_string()))?;
  let mut builder = builder
    .port(config.port)
    .timeout(Some(Duration::from_secs(SMTP_TIMEOUT_SECONDS)));
  if let Some(username) = &config.username {
    let password = config.password.as_deref().map_or("", String::as_str);
    builder = builder.credentials(Credentials::new(username.clone(), password.to_owned()));
  }
  Ok(builder.build())
}
