use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::{
  constants::limits::{
    ACCESS_TOKEN_MINUTES, CODE_RESEND_SECONDS, CODES_PER_HOUR, IP_REQUESTS_PER_MINUTE,
    LOCKOUT_ATTEMPTS, LOCKOUT_MINUTES, PASSWORD_MIN_LENGTH, REFRESH_TOKEN_IDLE_DAYS,
    SESSION_ABSOLUTE_DAYS, VERIFICATION_CODE_MINUTES, VERIFICATION_MAX_ATTEMPTS,
  },
  services::mailer::SmtpSecurity,
};

/// Every runtime setting. Server-level options such as the port and SMTP
/// come from the environment instead.
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
  pub signup: SignupSettings,
  pub password: PasswordSettings,
  pub tokens: TokenSettings,
  pub limits: LimitSettings,
  /// Read-only: set with `DOPGATE_SMTP_*`.
  pub smtp: SmtpSettings,
  pub branding: BrandingSettings,
}

#[derive(Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", default)]
pub struct SignupSettings {
  /// Anyone can create an account. When off, only admins create accounts.
  pub enabled: bool,
  /// Sign-in is refused until the user confirms the code sent to their
  /// email.
  pub require_email_verification: bool,
  /// Sign-in by emailed code creates an account for an unknown email.
  pub passwordless_signup: bool,
}

impl Default for SignupSettings {
  fn default() -> Self {
    Self {
      enabled: true,
      require_email_verification: true,
      passwordless_signup: false,
    }
  }
}

#[derive(Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", default)]
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

#[derive(Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", default)]
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

/// Emailed codes, account lockout, and per-address request limits.
#[derive(Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", default)]
pub struct LimitSettings {
  /// Minutes a code stays valid.
  pub code_minutes: u32,
  /// Wrong tries before a code is burned.
  pub code_max_attempts: u32,
  /// Seconds before the same email can get another code.
  pub code_resend_seconds: u32,
  /// Codes one email can receive per hour.
  pub codes_per_hour: u32,
  /// Wrong passwords in a row before the account is locked.
  pub lockout_attempts: u32,
  /// Minutes a locked account stays locked.
  pub lockout_minutes: u32,
  /// Sign-in, sign-up, and code requests one address can make per minute.
  pub ip_requests_per_minute: u32,
}

impl Default for LimitSettings {
  fn default() -> Self {
    Self {
      code_minutes: VERIFICATION_CODE_MINUTES as u32,
      code_max_attempts: VERIFICATION_MAX_ATTEMPTS as u32,
      code_resend_seconds: CODE_RESEND_SECONDS as u32,
      codes_per_hour: CODES_PER_HOUR as u32,
      lockout_attempts: LOCKOUT_ATTEMPTS as u32,
      lockout_minutes: LOCKOUT_MINUTES as u32,
      ip_requests_per_minute: IP_REQUESTS_PER_MINUTE as u32,
    }
  }
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SmtpSettings {
  /// Unset means messages go to the server log instead.
  pub host: Option<String>,
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
  /// The SMTP server from `DOPGATE_SMTP_*` or the config file.
  ServerConfig,
  /// No SMTP server: messages are written to the server log.
  Log,
}

#[derive(Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", default)]
pub struct BrandingSettings {
  /// The name emails use.
  pub app_name: String,
  pub logo_url: Option<String>,
}

impl Default for BrandingSettings {
  fn default() -> Self {
    Self {
      app_name: "Dopgate".into(),
      logo_url: None,
    }
  }
}

/// Sections left out stay as they are. Each section is replaced whole.
#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSettingsRequest {
  pub signup: Option<SignupSettings>,
  pub password: Option<PasswordSettings>,
  pub tokens: Option<TokenSettings>,
  pub limits: Option<LimitSettings>,
  pub branding: Option<BrandingSettings>,
  /// Refused: SMTP is set with `DOPGATE_SMTP_*`.
  #[schema(value_type = Option<Object>)]
  pub smtp: Option<serde_json::Value>,
}

#[derive(Deserialize, ToSchema, Default)]
#[serde(rename_all = "camelCase")]
pub struct SmtpTestRequest {
  /// Where to send the test message. Default: the caller's own email.
  pub to: Option<String>,
}
