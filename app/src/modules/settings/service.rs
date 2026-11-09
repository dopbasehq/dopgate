//! Runtime settings: sign-up rules, the password policy, token lifetimes,
//! limits, and branding. Each section is one JSON row in `settings`. SMTP
//! comes from the environment and is only reported here.

use super::{model::*, repository};
use crate::{
  constants::errors::{
    EMAIL_INVALID, EMAIL_INVALID_MESSAGE, SETTINGS_INVALID, SMTP_NOT_CONFIGURED, SMTP_SEND_FAILED,
  },
  http::HttpError,
  models::AuthIdentity,
  modules::audit,
  services::mailer::{self, Message},
  state::AppState,
  utils::email,
};
use axum::http::StatusCode;
use serde::{Serialize, de::DeserializeOwned};
use sqlx::PgPool;

const SIGNUP: &str = "signup";
const PASSWORD: &str = "password";
const TOKENS: &str = "tokens";
const LIMITS: &str = "limits";
const BRANDING: &str = "branding";

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
  let smtp = &state.config.smtp;
  Ok(Settings {
    signup: signup(pool).await?,
    password: password(pool).await?,
    tokens: tokens(pool).await?,
    limits: limits(pool).await?,
    smtp: SmtpSettings {
      host: smtp.host.clone(),
      port: smtp.port.unwrap_or_else(|| smtp.security.default_port()),
      username: smtp.username.clone(),
      password_set: smtp.password.is_some(),
      security: smtp.security,
      from_email: smtp.from_email.clone(),
      from_name: smtp.from_name.clone(),
      source: if smtp.host.is_some() {
        SmtpSource::ServerConfig
      } else {
        SmtpSource::Log
      },
    },
    branding: branding(pool).await?,
  })
}

pub async fn update(
  state: &AppState,
  actor: &AuthIdentity,
  request: UpdateSettingsRequest,
) -> Result<Settings, HttpError> {
  if request.smtp.is_some() {
    return Err(HttpError::new(
      StatusCode::UNPROCESSABLE_ENTITY,
      SETTINGS_INVALID,
      "SMTP is set with the DOPGATE_SMTP_* environment variables, not through the API.",
    ));
  }
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

/// Send a test message through the configured SMTP server.
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
      AuthIdentity::User { email, .. } => email.clone(),
      AuthIdentity::Service => {
        return Err(HttpError::new(
          StatusCode::UNPROCESSABLE_ENTITY,
          EMAIL_INVALID,
          "Give the address to send the test message to in `to`.",
        ));
      }
    },
  };
  let config = state.config.smtp.mailer_config().ok_or_else(|| {
    HttpError::bad_request(
      SMTP_NOT_CONFIGURED,
      "Set DOPGATE_SMTP_HOST and DOPGATE_SMTP_FROM_EMAIL before sending a test message.",
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

fn invalid(message: &str) -> HttpError {
  HttpError::new(StatusCode::UNPROCESSABLE_ENTITY, SETTINGS_INVALID, message)
}
