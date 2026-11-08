//! Runtime settings: sign-up rules, the password policy, token lifetimes,
//! SMTP, and branding. Each section is one JSON row in `settings`. The SMTP
//! password is a row of its own, encrypted with the master key.

use super::{model::*, repository};
use crate::{
  constants::errors::{
    EMAIL_INVALID, EMAIL_INVALID_MESSAGE, SETTINGS_INVALID, SMTP_NOT_CONFIGURED, SMTP_SEND_FAILED,
  },
  http::HttpError,
  models::AuthIdentity,
  modules::audit,
  services::{
    crypto,
    mailer::{self, Message, SmtpConfig},
  },
  state::AppState,
  utils::email,
};
use axum::http::StatusCode;
use serde::{Serialize, de::DeserializeOwned};
use sqlx::SqlitePool;
use zeroize::Zeroizing;

const SIGNUP: &str = "signup";
const PASSWORD: &str = "password";
const TOKENS: &str = "tokens";
const SMTP: &str = "smtp";
/// Encrypted. `crypto::rekey_database` re-encrypts it with the rest.
const SMTP_PASSWORD: &str = "smtp.password";
const BRANDING: &str = "branding";

const PASSWORD_MIN_LENGTH_MAX: u32 = 128;
const ACCESS_TOKEN_MINUTES_MAX: u32 = 24 * 60;
const SMTP_PASSWORD_MAX_BYTES: usize = 1024;
const TEXT_MAX_CHARS: usize = 255;

pub async fn get(state: &AppState) -> Result<Settings, HttpError> {
  let pool = state.db.pool();
  let smtp: StoredSmtp = section(pool, SMTP).await?;
  let password_set = repository::secret(pool, SMTP_PASSWORD).await?.is_some();
  let source = if smtp.host.is_some() {
    SmtpSource::Settings
  } else if state.config.smtp.host.is_some() {
    SmtpSource::ServerConfig
  } else {
    SmtpSource::Log
  };
  Ok(Settings {
    signup: section(pool, SIGNUP).await?,
    password: section(pool, PASSWORD).await?,
    tokens: section(pool, TOKENS).await?,
    smtp: SmtpSettings {
      port: smtp.port(),
      host: smtp.host,
      username: smtp.username,
      password_set,
      security: smtp.security,
      from_email: smtp.from_email,
      from_name: smtp.from_name,
      source,
    },
    branding: section(pool, BRANDING).await?,
  })
}

pub async fn update(
  state: &AppState,
  actor: &AuthIdentity,
  request: UpdateSettingsRequest,
) -> Result<Settings, HttpError> {
  let pool = state.db.pool();
  if let Some(password) = &request.password {
    check_password(password)?;
  }
  if let Some(tokens) = &request.tokens {
    check_tokens(tokens)?;
  }
  let branding = request.branding.map(clean_branding).transpose()?;
  let smtp = match &request.smtp {
    Some(changes) => Some(merge_smtp(section(pool, SMTP).await?, changes)?),
    None => None,
  };
  let smtp_password = request
    .smtp
    .as_ref()
    .and_then(|changes| changes.password.as_deref());
  if let Some(password) = smtp_password
    && password.len() > SMTP_PASSWORD_MAX_BYTES
  {
    return Err(invalid("The SMTP password is too long."));
  }

  let mut sections = Vec::new();
  let user_id = match actor {
    AuthIdentity::User { user_id, .. } => Some(user_id.as_str()),
    AuthIdentity::Client { .. } => None,
  };
  let now = chrono::Utc::now().to_rfc3339();
  let mut tx = pool.begin().await?;
  if let Some(signup) = &request.signup {
    save(&mut tx, SIGNUP, signup, user_id, &now).await?;
    sections.push(SIGNUP);
  }
  if let Some(password) = &request.password {
    save(&mut tx, PASSWORD, password, user_id, &now).await?;
    sections.push(PASSWORD);
  }
  if let Some(tokens) = &request.tokens {
    save(&mut tx, TOKENS, tokens, user_id, &now).await?;
    sections.push(TOKENS);
  }
  if let Some(smtp) = &smtp {
    save(&mut tx, SMTP, smtp, user_id, &now).await?;
    sections.push(SMTP);
  }
  match smtp_password {
    Some("") => repository::delete(&mut tx, SMTP_PASSWORD).await?,
    Some(password) => {
      let (ciphertext, nonce) = state
        .crypto
        .encrypt_master(password.as_bytes(), &crypto::setting_aad(SMTP_PASSWORD))
        .map_err(|error| {
          tracing::error!(%error, "failed to encrypt the SMTP password");
          HttpError::internal()
        })?;
      repository::put_secret(&mut tx, SMTP_PASSWORD, &ciphertext, &nonce, user_id, &now).await?;
    }
    None => {}
  }
  if let Some(branding) = &branding {
    save(&mut tx, BRANDING, branding, user_id, &now).await?;
    sections.push(BRANDING);
  }
  if !sections.is_empty() {
    let actor_label = match actor {
      AuthIdentity::User { email, .. } => Some(email.as_str()),
      AuthIdentity::Client { .. } => None,
    };
    // Values are left out: the SMTP section sits next to its password.
    audit::service::record(
      &mut tx,
      audit::service::Event {
        actor_type: actor.audit_actor_type(),
        actor_id: Some(actor.actor_id()),
        actor_label,
        action: "settings.updated",
        resource_type: Some("settings"),
        resource_id: None,
        metadata: serde_json::json!({
          "sections": sections,
          "smtpPasswordChanged": smtp_password.is_some(),
        }),
      },
    )
    .await?;
  }
  tx.commit().await?;
  get(state).await
}

/// Send a test message through the saved SMTP settings.
pub async fn test_smtp(
  state: &AppState,
  request: SmtpTestRequest,
) -> Result<(), HttpError> {
  let to = email::normalize(&request.to)
    .ok_or_else(|| HttpError::bad_request(EMAIL_INVALID, EMAIL_INVALID_MESSAGE))?;
  let config = smtp_config(state).await?.ok_or_else(|| {
    HttpError::bad_request(
      SMTP_NOT_CONFIGURED,
      "Set an SMTP host in settings or server.toml before sending a test message.",
    )
  })?;
  let branding: BrandingSettings = section(state.db.pool(), BRANDING).await?;
  let message = Message {
    to,
    subject: format!("Test message from {}", branding.app_name),
    text: format!(
      "This is a test message from {}. If you can read it, your SMTP settings work.\n",
      branding.app_name
    ),
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

/// The SMTP server mail goes through: the one saved in settings, else the
/// one in server.toml, else `None` and mail goes to the server log.
pub async fn smtp_config(state: &AppState) -> Result<Option<SmtpConfig>, HttpError> {
  let pool = state.db.pool();
  let smtp: StoredSmtp = section(pool, SMTP).await?;
  let port = smtp.port();
  let (Some(host), Some(from_email)) = (smtp.host, smtp.from_email) else {
    return Ok(state.config.smtp.mailer_config());
  };
  let password = match repository::secret(pool, SMTP_PASSWORD).await? {
    Some((ciphertext, nonce)) => {
      let clear = Zeroizing::new(
        state
          .crypto
          .decrypt_master(&ciphertext, &nonce, &crypto::setting_aad(SMTP_PASSWORD))
          .map_err(|error| {
            tracing::error!(%error, "failed to decrypt the SMTP password");
            HttpError::internal()
          })?,
      );
      let password = std::str::from_utf8(&clear).map_err(|_| HttpError::internal())?;
      Some(Zeroizing::new(password.to_owned()))
    }
    None => None,
  };
  Ok(Some(SmtpConfig {
    host,
    port,
    security: smtp.security,
    username: smtp.username,
    password,
    from_email,
    from_name: smtp.from_name,
  }))
}

/// A stored section, or its defaults when it was never saved.
async fn section<T: DeserializeOwned + Default>(
  pool: &SqlitePool,
  key: &str,
) -> Result<T, HttpError> {
  let Some(json) = repository::value(pool, key).await? else {
    return Ok(T::default());
  };
  serde_json::from_str(&json).map_err(|error| {
    tracing::error!(%error, key, "a stored setting does not match its section");
    HttpError::internal()
  })
}

async fn save(
  connection: &mut sqlx::SqliteConnection,
  key: &str,
  value: &impl Serialize,
  updated_by: Option<&str>,
  now: &str,
) -> Result<(), HttpError> {
  let json = serde_json::to_string(value).map_err(|_| HttpError::internal())?;
  Ok(repository::put_value(connection, key, &json, updated_by, now).await?)
}

/// Apply the fields the request carries to the stored SMTP section.
fn merge_smtp(
  mut smtp: StoredSmtp,
  changes: &UpdateSmtpSettings,
) -> Result<StoredSmtp, HttpError> {
  if let Some(host) = &changes.host {
    smtp.host = optional(host);
    if smtp
      .host
      .as_deref()
      .is_some_and(|host| !mailer::valid_host(host))
    {
      return Err(invalid(
        "Enter the SMTP host name only, such as smtp.example.com, without a scheme or port.",
      ));
    }
  }
  if let Some(port) = changes.port {
    if port == 0 {
      return Err(invalid("The SMTP port must be between 1 and 65535."));
    }
    smtp.port = Some(port);
  }
  if let Some(username) = &changes.username {
    smtp.username = optional(username);
    if smtp
      .username
      .as_deref()
      .is_some_and(|name| !mailer::header_safe(name))
    {
      return Err(invalid("The SMTP username cannot contain line breaks."));
    }
  }
  if let Some(security) = changes.security {
    smtp.security = security;
  }
  if let Some(from_email) = &changes.from_email {
    smtp.from_email = match optional(from_email) {
      Some(address) => Some(
        mailer::normalize_from_email(&address)
          .ok_or_else(|| invalid("Enter a valid from address."))?,
      ),
      None => None,
    };
  }
  if let Some(from_name) = &changes.from_name {
    smtp.from_name = optional(from_name);
    if smtp
      .from_name
      .as_deref()
      .is_some_and(|name| !mailer::header_safe(name) || name.chars().count() > TEXT_MAX_CHARS)
    {
      return Err(invalid(
        "The from name must be one line of at most 255 characters.",
      ));
    }
  }
  if smtp.host.is_some() && smtp.from_email.is_none() {
    return Err(invalid(
      "Set a from address (fromEmail) to send mail through SMTP.",
    ));
  }
  Ok(smtp)
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
  if tokens.refresh_token_idle_days == 0 || tokens.session_absolute_days == 0 {
    return Err(invalid(
      "Refresh tokens and sessions must last at least 1 day.",
    ));
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
  let logo_url = branding.logo_url.as_deref().and_then(optional);
  if let Some(logo_url) = &logo_url
    && !url::Url::parse(logo_url).is_ok_and(|url| matches!(url.scheme(), "https" | "http"))
  {
    return Err(invalid("The logo URL must start with https:// or http://."));
  }
  Ok(BrandingSettings { app_name, logo_url })
}

/// Trimmed, with an empty value meaning unset.
fn optional(value: &str) -> Option<String> {
  let value = value.trim();
  (!value.is_empty()).then(|| value.to_owned())
}

fn invalid(message: &str) -> HttpError {
  HttpError::bad_request(SETTINGS_INVALID, message)
}
