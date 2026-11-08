use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::{
  constants::limits::{
    ACCESS_TOKEN_MINUTES, PASSWORD_MIN_LENGTH, REFRESH_TOKEN_IDLE_DAYS, SESSION_ABSOLUTE_DAYS,
  },
  services::mailer::SmtpSecurity,
};

/// Every runtime setting. Server-level options such as the port live in
/// server.toml instead.
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
  pub signup: SignupSettings,
  pub password: PasswordSettings,
  pub tokens: TokenSettings,
  pub smtp: SmtpSettings,
  pub branding: BrandingSettings,
}

#[derive(Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SignupSettings {
  /// Anyone can create an account. When off, only admins create accounts.
  pub enabled: bool,
  /// New accounts must verify their email before their tokens work.
  pub require_email_verification: bool,
  /// Passwordless sign-in creates an account for an unknown email.
  pub passwordless_signup: bool,
}

impl Default for SignupSettings {
  fn default() -> Self {
    Self {
      enabled: true,
      require_email_verification: false,
      passwordless_signup: false,
    }
  }
}

#[derive(Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PasswordSettings {
  pub min_length: u32,
}

impl Default for PasswordSettings {
  fn default() -> Self {
    Self {
      min_length: PASSWORD_MIN_LENGTH as u32,
    }
  }
}

#[derive(Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TokenSettings {
  pub access_token_minutes: u32,
  pub refresh_token_idle_days: u32,
  pub session_absolute_days: u32,
}

impl Default for TokenSettings {
  fn default() -> Self {
    Self {
      access_token_minutes: ACCESS_TOKEN_MINUTES as u32,
      refresh_token_idle_days: REFRESH_TOKEN_IDLE_DAYS as u32,
      session_absolute_days: SESSION_ABSOLUTE_DAYS as u32,
    }
  }
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SmtpSettings {
  /// Unset means messages go to the server log instead.
  pub host: Option<String>,
  /// Defaults to the usual port for `security`.
  pub port: u16,
  pub username: Option<String>,
  /// The password itself is never returned.
  pub password_set: bool,
  pub security: SmtpSecurity,
  pub from_email: Option<String>,
  pub from_name: Option<String>,
  /// Where mail goes right now.
  pub source: SmtpSource,
}

#[derive(Clone, Copy, Debug, Serialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SmtpSource {
  /// The SMTP server saved in these settings.
  Settings,
  /// No host is saved here, so the `[smtp]` table in server.toml or the
  /// `DOPGATE_SMTP_*` variables are used.
  ServerConfig,
  /// No SMTP server anywhere: messages are written to the server log.
  Log,
}

/// The SMTP row as stored. The password is a separate, encrypted row.
#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct StoredSmtp {
  pub host: Option<String>,
  /// Unset means the usual port for `security`.
  pub port: Option<u16>,
  pub username: Option<String>,
  pub security: SmtpSecurity,
  pub from_email: Option<String>,
  pub from_name: Option<String>,
}

impl StoredSmtp {
  pub fn port(&self) -> u16 {
    self.port.unwrap_or_else(|| self.security.default_port())
  }
}

#[derive(Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BrandingSettings {
  /// The name emails and sign-in pages use.
  pub app_name: String,
  pub logo_url: Option<String>,
}

impl Default for BrandingSettings {
  fn default() -> Self {
    Self {
      app_name: "dopgate".into(),
      logo_url: None,
    }
  }
}

/// Fields left out stay as they are.
#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSettingsRequest {
  pub signup: Option<SignupSettings>,
  pub password: Option<PasswordSettings>,
  pub tokens: Option<TokenSettings>,
  pub smtp: Option<UpdateSmtpSettings>,
  pub branding: Option<BrandingSettings>,
}

/// Fields left out stay as they are. An empty string clears `host`,
/// `username`, `password`, `fromEmail`, or `fromName`; clearing `host` sends
/// mail to the server log again.
#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSmtpSettings {
  /// A host name or IP address, without a scheme or port.
  pub host: Option<String>,
  pub port: Option<u16>,
  pub username: Option<String>,
  /// Stored encrypted with the master key.
  pub password: Option<String>,
  pub security: Option<SmtpSecurity>,
  /// Required while a host is set.
  pub from_email: Option<String>,
  pub from_name: Option<String>,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SmtpTestRequest {
  /// Where to send the test message.
  pub to: String,
}
