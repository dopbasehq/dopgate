//! Runtime settings: sign-up rules, the password policy, token lifetimes,
//! limits, branding, and SMTP. Each section is one JSON row in `settings`.
//!
//! SMTP is resolved in order: the server config (`DOPGATE_SMTP_*` or the
//! config file) when it sets a host, then the section saved here, then the
//! server log. The saved password is encrypted with the service key.

use super::{model::*, repository};
use crate::{
  constants::{
    config::DEFAULT_SMTP_FROM_EMAIL,
    errors::{
      EMAIL_INVALID, EMAIL_INVALID_MESSAGE, SETTINGS_INVALID, SMTP_NOT_CONFIGURED,
      SMTP_PASSWORD_UNREADABLE, SMTP_SEND_FAILED,
    },
  },
  http::HttpError,
  models::AuthIdentity,
  modules::audit,
  services::{
    mailer::{self, Message, SmtpConfig, SmtpSecurity},
    secret_box::SecretBox,
  },
  state::AppState,
  utils::email,
};
use axum::http::StatusCode;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use sqlx::PgPool;

const SIGNUP: &str = "signup";
const PASSWORD: &str = "password";
const TOKENS: &str = "tokens";
const LIMITS: &str = "limits";
const BRANDING: &str = "branding";
const SMTP: &str = "smtp";

/// Keeps the SMTP password key apart from keys for other secrets.
const SMTP_PASSWORD_PURPOSE: &str = "smtp-password";
const SMTP_PASSWORD_MAX_CHARS: usize = 1024;

/// The SMTP section as stored. `password` is sealed with the service key.
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct StoredSmtp {
  host: Option<String>,
  port: Option<u16>,
  security: SmtpSecurity,
  username: Option<String>,
  password: Option<String>,
  from_email: Option<String>,
  from_name: Option<String>,
}

const PASSWORD_MIN_LENGTH_MAX: u32 = 128;
const ACCESS_TOKEN_MINUTES_MAX: u32 = 24 * 60;
const TEXT_MAX_CHARS: usize = 255;

pub async fn signup(pool: &PgPool) -> Result<SignupSettings, HttpError> {
  section(pool, SIGNUP).await
}

pub async fn password(pool: &PgPool) -> Result<PasswordSettings, HttpError> {
  section(pool, PASSWORD).await
}

pub async fn tokens(pool: &PgPool) -> Result<TokenSettings, HttpError> {
  section(pool, TOKENS).await
}

pub async fn limits(pool: &PgPool) -> Result<LimitSettings, HttpError> {
  section(pool, LIMITS).await
}

pub async fn branding(pool: &PgPool) -> Result<BrandingSettings, HttpError> {
  section(pool, BRANDING).await
}

pub async fn get(state: &AppState) -> Result<Settings, HttpError> {
  let pool = state.db.pool();
  Ok(Settings {
    signup: signup(pool).await?,
    password: password(pool).await?,
    tokens: tokens(pool).await?,
    limits: limits(pool).await?,
    smtp: smtp_settings(state).await?,
    branding: branding(pool).await?,
  })
}

/// The SMTP server mail goes through: the server config when it sets a host,
/// otherwise the one saved in settings. `None` means mail goes to the log.
pub async fn smtp(state: &AppState) -> Result<Option<SmtpConfig>, HttpError> {
  if server_smtp(state) {
    return Ok(state.config.smtp.mailer_config());
  }
  let stored: StoredSmtp = section(state.db.pool(), SMTP).await?;
  let Some(host) = stored.host else {
    return Ok(None);
  };
  let password = stored
    .password
    .as_deref()
    .map(|sealed| open_smtp_password(state, sealed))
    .transpose()?;
  Ok(Some(SmtpConfig {
    host,
    port: stored
      .port
      .unwrap_or_else(|| stored.security.default_port()),
    security: stored.security,
    username: stored.username,
    password,
    from_email: stored
      .from_email
      .unwrap_or_else(|| DEFAULT_SMTP_FROM_EMAIL.into()),
    from_name: stored.from_name,
  }))
}

/// Whether `DOPGATE_SMTP_*` or the config file sets a host. When it does,
/// it wins over the saved settings.
fn server_smtp(state: &AppState) -> bool {
  state.config.smtp.host.is_some()
}

async fn smtp_settings(state: &AppState) -> Result<SmtpSettings, HttpError> {
  let can_store_password = state.config.service_key.is_some();
  if server_smtp(state) {
    let smtp = &state.config.smtp;
    return Ok(SmtpSettings {
      host: smtp.host.clone(),
      port: smtp.port.unwrap_or_else(|| smtp.security.default_port()),
      username: smtp.username.clone(),
      password_set: smtp.password.is_some(),
      security: smtp.security,
      from_email: smtp
        .from_email
        .clone()
        .unwrap_or_else(|| DEFAULT_SMTP_FROM_EMAIL.into()),
      from_name: smtp.from_name.clone(),
      source: SmtpSource::ServerConfig,
      can_store_password,
    });
  }
  let stored: StoredSmtp = section(state.db.pool(), SMTP).await?;
  Ok(SmtpSettings {
    source: if stored.host.is_some() {
      SmtpSource::Database
    } else {
      SmtpSource::Log
    },
    port: stored
      .port
      .unwrap_or_else(|| stored.security.default_port()),
    password_set: stored.password.is_some(),
    security: stored.security,
    from_email: stored
      .from_email
      .unwrap_or_else(|| DEFAULT_SMTP_FROM_EMAIL.into()),
    host: stored.host,
    username: stored.username,
    from_name: stored.from_name,
    can_store_password,
  })
}

fn smtp_password_box(service_key: &str) -> SecretBox {
  SecretBox::new(service_key, SMTP_PASSWORD_PURPOSE)
}

fn open_smtp_password(
  state: &AppState,
  sealed: &str,
) -> Result<zeroize::Zeroizing<String>, HttpError> {
  state
    .config
    .service_key
    .as_ref()
    .and_then(|key| smtp_password_box(key).open(sealed).ok())
    .ok_or_else(|| {
      tracing::warn!(
        "the saved SMTP password can't be decrypted: DOPGATE_SERVICE_KEY was removed or changed"
      );
      HttpError::bad_request(
        SMTP_PASSWORD_UNREADABLE,
        "The saved SMTP password can't be read because DOPGATE_SERVICE_KEY was removed or changed. Enter the password again in Settings.",
      )
    })
}

pub async fn update(
  state: &AppState,
  actor: &AuthIdentity,
  request: UpdateSettingsRequest,
) -> Result<Settings, HttpError> {
  let smtp = match request.smtp {
    Some(_) if server_smtp(state) => {
      return Err(invalid(
        "SMTP is set on the server with DOPGATE_SMTP_* or the config file. Change it there, or unset DOPGATE_SMTP_HOST to manage it here.",
      ));
    }
    Some(input) => {
      let saved: StoredSmtp = section(state.db.pool(), SMTP).await?;
      Some(clean_smtp(state, input, saved)?)
    }
    None => None,
  };
  if let Some(password) = &request.password {
    check_password(password)?;
  }
  if let Some(tokens) = &request.tokens {
    check_tokens(tokens)?;
  }
  if let Some(limits) = &request.limits {
    check_limits(limits)?;
  }
  let branding = request.branding.map(clean_branding).transpose()?;

  let mut sections = Vec::new();
  let user_id = actor.actor_id();
  let mut tx = state.db.pool().begin().await?;
  if let Some(signup) = &request.signup {
    save(&mut tx, SIGNUP, signup, user_id).await?;
    sections.push(SIGNUP);
  }
  if let Some(password) = &request.password {
    save(&mut tx, PASSWORD, password, user_id).await?;
    sections.push(PASSWORD);
  }
  if let Some(tokens) = &request.tokens {
    save(&mut tx, TOKENS, tokens, user_id).await?;
    sections.push(TOKENS);
  }
  if let Some(limits) = &request.limits {
    save(&mut tx, LIMITS, limits, user_id).await?;
    sections.push(LIMITS);
  }
  if let Some(branding) = &branding {
    save(&mut tx, BRANDING, branding, user_id).await?;
    sections.push(BRANDING);
  }
  if let Some(smtp) = &smtp {
    save(&mut tx, SMTP, smtp, user_id).await?;
    sections.push(SMTP);
  }
  if !sections.is_empty() {
    audit::service::record(
      &mut tx,
      audit::service::Event::by(actor, "settings.updated")
        .resource("settings", None)
        .metadata(serde_json::json!({ "sections": sections })),
    )
    .await?;
  }
  tx.commit().await?;
  get(state).await
}

/// Send a test message through the SMTP server in use.
pub async fn test_smtp(
  state: &AppState,
  actor: &AuthIdentity,
  request: SmtpTestRequest,
) -> Result<(), HttpError> {
  let to = match request
    .to
    .as_deref()
    .map(str::trim)
    .filter(|to| !to.is_empty())
  {
    Some(to) => email::normalize(to).ok_or_else(|| {
      HttpError::new(
        StatusCode::UNPROCESSABLE_ENTITY,
        EMAIL_INVALID,
        EMAIL_INVALID_MESSAGE,
      )
    })?,
    None => match actor {
      AuthIdentity::Admin { email, .. } | AuthIdentity::User { email, .. } => email.clone(),
      AuthIdentity::Service => {
        return Err(HttpError::new(
          StatusCode::UNPROCESSABLE_ENTITY,
          EMAIL_INVALID,
          "Give the address to send the test message to in `to`.",
        ));
      }
    },
  };
  let config = smtp(state).await?.ok_or_else(|| {
    HttpError::bad_request(
      SMTP_NOT_CONFIGURED,
      "Save an SMTP host in Settings, or set DOPGATE_SMTP_HOST, before sending a test message.",
    )
  })?;
  let branding = branding(state.db.pool()).await?;
  let message = Message {
    to,
    subject: format!("Test message from {}", branding.app_name),
    text: format!(
      "This is a test message from {}. If you can read it, your SMTP settings work.\n",
      branding.app_name
    ),
    html: None,
  };
  mailer::send(Some(&config), &message)
    .await
    .map_err(|error| {
      HttpError::new(
        StatusCode::BAD_GATEWAY,
        SMTP_SEND_FAILED,
        format!("The message was not sent: {error}"),
      )
    })
}

/// A stored section, or its defaults when it was never saved.
async fn section<T: DeserializeOwned + Default>(
  pool: &PgPool,
  key: &str,
) -> Result<T, HttpError> {
  let Some(json) = repository::value(pool, key).await? else {
    return Ok(T::default());
  };
  serde_json::from_value(json).map_err(|error| {
    tracing::error!(%error, key, "a stored setting does not match its section");
    HttpError::internal()
  })
}

async fn save(
  connection: &mut sqlx::PgConnection,
  key: &str,
  value: &impl Serialize,
  updated_by: Option<&str>,
) -> Result<(), HttpError> {
  let json = serde_json::to_value(value).map_err(|_| HttpError::internal())?;
  Ok(repository::put_value(connection, key, &json, updated_by).await?)
}

fn check_password(password: &PasswordSettings) -> Result<(), HttpError> {
  let floor = PasswordSettings::default().min_length;
  if !(floor..=PASSWORD_MIN_LENGTH_MAX).contains(&password.min_length) {
    return Err(invalid(&format!(
      "The minimum password length must be between {floor} and {PASSWORD_MIN_LENGTH_MAX}."
    )));
  }
  Ok(())
}

fn check_tokens(tokens: &TokenSettings) -> Result<(), HttpError> {
  if !(1..=ACCESS_TOKEN_MINUTES_MAX).contains(&tokens.access_token_minutes) {
    return Err(invalid(
      "Access tokens must last between 1 minute and 1 day.",
    ));
  }
  if !(1..=3650).contains(&tokens.refresh_token_idle_days)
    || !(1..=3650).contains(&tokens.session_absolute_days)
  {
    return Err(invalid(
      "Refresh tokens and sessions must last between 1 day and 10 years.",
    ));
  }
  if tokens.refresh_token_idle_days > tokens.session_absolute_days {
    return Err(invalid(
      "The idle limit can't be longer than the session's maximum age.",
    ));
  }
  Ok(())
}

fn check_limits(limits: &LimitSettings) -> Result<(), HttpError> {
  let checks = [
    (
      limits.code_minutes,
      1,
      60,
      "Codes must last between 1 and 60 minutes.",
    ),
    (
      limits.code_max_attempts,
      1,
      20,
      "Allow between 1 and 20 tries per code.",
    ),
    (
      limits.code_resend_seconds,
      0,
      3600,
      "The resend wait must be between 0 and 3600 seconds.",
    ),
    (
      limits.codes_per_hour,
      1,
      100,
      "Allow between 1 and 100 codes per hour.",
    ),
    (
      limits.lockout_attempts,
      1,
      100,
      "Lock after between 1 and 100 wrong passwords.",
    ),
    (
      limits.lockout_minutes,
      1,
      1440,
      "Lock for between 1 minute and 1 day.",
    ),
    (
      limits.ip_requests_per_minute,
      1,
      10_000,
      "Allow between 1 and 10000 requests per minute per address.",
    ),
  ];
  for (value, min, max, message) in checks {
    if !(min..=max).contains(&value) {
      return Err(invalid(message));
    }
  }
  Ok(())
}

fn clean_branding(branding: BrandingSettings) -> Result<BrandingSettings, HttpError> {
  let app_name = branding.app_name.trim().to_owned();
  if app_name.is_empty()
    || app_name.chars().count() > TEXT_MAX_CHARS
    || !mailer::header_safe(&app_name)
  {
    return Err(invalid(
      "The app name must be one line of 1 to 255 characters.",
    ));
  }
  let logo_url = branding
    .logo_url
    .as_deref()
    .map(str::trim)
    .filter(|url| !url.is_empty())
    .map(str::to_owned);
  if let Some(logo_url) = &logo_url
    && !url::Url::parse(logo_url).is_ok_and(|url| matches!(url.scheme(), "https" | "http"))
  {
    return Err(invalid("The logo URL must start with https:// or http://."));
  }
  Ok(BrandingSettings { app_name, logo_url })
}

/// Check and tidy SMTP settings from the API. A left-out password keeps the
/// saved one; a new one is sealed with the service key.
fn clean_smtp(
  state: &AppState,
  input: SmtpSettingsInput,
  saved: StoredSmtp,
) -> Result<StoredSmtp, HttpError> {
  let text = |value: Option<String>| {
    value
      .as_deref()
      .map(str::trim)
      .filter(|value| !value.is_empty())
      .map(str::to_owned)
  };
  let host = text(input.host);
  let username = text(input.username);
  let from_name = text(input.from_name);
  if host
    .as_deref()
    .is_some_and(|host| !mailer::valid_host(host))
  {
    return Err(invalid(
      "Enter the SMTP host as a name or IP address, without https:// or a port.",
    ));
  }
  if input.port == Some(0) {
    return Err(invalid("The port must be between 1 and 65535."));
  }
  for (value, message) in [
    (
      &username,
      "The username must be one line of up to 255 characters.",
    ),
    (
      &from_name,
      "The sender name must be one line of up to 255 characters.",
    ),
  ] {
    if value
      .as_deref()
      .is_some_and(|value| value.chars().count() > TEXT_MAX_CHARS || !mailer::header_safe(value))
    {
      return Err(invalid(message));
    }
  }
  let from_email = text(input.from_email)
    .map(|address| {
      mailer::normalize_from_email(&address)
        .ok_or_else(|| invalid("Enter a valid sender email address."))
    })
    .transpose()?;
  let password = match input.password {
    None => saved.password,
    Some(password) if password.is_empty() => None,
    Some(password) => {
      if password.chars().count() > SMTP_PASSWORD_MAX_CHARS {
        return Err(invalid("The password is too long."));
      }
      let key = state.config.service_key.as_ref().ok_or_else(|| {
        invalid(
          "Set DOPGATE_SERVICE_KEY on the server before saving an SMTP password. Dopgate uses it to encrypt the password.",
        )
      })?;
      Some(smtp_password_box(key).seal(&password))
    }
  };
  Ok(StoredSmtp {
    host,
    port: input.port,
    security: input.security,
    username,
    password,
    from_email,
    from_name,
  })
}

fn invalid(message: &str) -> HttpError {
  HttpError::new(StatusCode::UNPROCESSABLE_ENTITY, SETTINGS_INVALID, message)
}
