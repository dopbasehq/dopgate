//! Email templates: the built-in versions, admin overrides, and sending.

use axum::http::StatusCode;

use super::{
  defaults::{self, Builtin},
  model::*,
  render::{self, Values},
  repository,
};
use crate::{
  constants::errors::{EMAIL_INVALID, NOT_FOUND, SMTP_SEND_FAILED, TEMPLATE_INVALID},
  http::HttpError,
  models::AuthIdentity,
  modules::{audit, settings},
  services::mailer::{self, Message},
  state::AppState,
};

const SUBJECT_MAX_CHARS: usize = 255;
const BODY_MAX_BYTES: usize = 100 * 1024;

fn builtin(name: &str) -> Result<&'static Builtin, HttpError> {
  defaults::find(name).ok_or_else(|| {
    HttpError::not_found(
      NOT_FOUND,
      "No such email template. Names: verify_email, login_code, password_reset, email_change, email_changed, password_changed.",
    )
  })
}

fn invalid(message: impl Into<String>) -> HttpError {
  HttpError::new(StatusCode::UNPROCESSABLE_ENTITY, TEMPLATE_INVALID, message)
}

pub async fn list(state: &AppState) -> Result<Vec<TemplateSummary>, HttpError> {
  let overrides = repository::all(state.db.pool()).await?;
  Ok(
    defaults::ALL
      .iter()
      .map(|template| {
        let custom = overrides.iter().find(|row| row.name == template.name);
        TemplateSummary {
          name: template.name.into(),
          description: template.description.into(),
          customized: custom.is_some(),
          subject: custom.map_or(template.subject.into(), |row| row.subject.clone()),
          updated_at: custom.map(|row| row.updated_at),
        }
      })
      .collect(),
  )
}

pub async fn get(
  state: &AppState,
  name: &str,
) -> Result<TemplateDetail, HttpError> {
  let template = builtin(name)?;
  let custom = repository::find(state.db.pool(), name).await?;
  Ok(detail(template, custom))
}

fn detail(
  template: &Builtin,
  custom: Option<repository::Override>,
) -> TemplateDetail {
  let defaults = TemplateContent {
    subject: template.subject.into(),
    html: template.html.into(),
    text: template.text.into(),
  };
  match custom {
    Some(row) => TemplateDetail {
      name: template.name.into(),
      description: template.description.into(),
      customized: true,
      subject: row.subject,
      html: row.html,
      text: row.text,
      variables: template
        .variables
        .iter()
        .map(|name| (*name).into())
        .collect(),
      updated_at: Some(row.updated_at),
      defaults,
    },
    None => TemplateDetail {
      name: template.name.into(),
      description: template.description.into(),
      customized: false,
      subject: defaults.subject.clone(),
      html: defaults.html.clone(),
      text: defaults.text.clone(),
      variables: template
        .variables
        .iter()
        .map(|name| (*name).into())
        .collect(),
      updated_at: None,
      defaults,
    },
  }
}

/// Check a draft: a subject, non-empty bodies, closed placeholders, and only
/// the variables this template knows.
fn check(
  template: &Builtin,
  input: &TemplateInput,
) -> Result<(), HttpError> {
  let subject = input.subject.trim();
  if subject.is_empty() || subject.chars().count() > SUBJECT_MAX_CHARS {
    return Err(invalid("The subject must be 1 to 255 characters."));
  }
  if input.html.trim().is_empty() || input.text.trim().is_empty() {
    return Err(invalid("Both the HTML and the text version need content."));
  }
  if input.html.len() > BODY_MAX_BYTES || input.text.len() > BODY_MAX_BYTES {
    return Err(invalid("Each version must be at most 100 KB."));
  }
  for (part, value) in [
    ("subject", &input.subject),
    ("HTML", &input.html),
    ("text", &input.text),
  ] {
    if render::has_unclosed(value) {
      return Err(invalid(format!(
        "The {part} has a {{{{ without a closing }}}}."
      )));
    }
    for name in render::placeholders(value) {
      if !template.variables.contains(&name.as_str()) {
        return Err(invalid(format!(
          "Unknown variable {{{{{name}}}}} in the {part}. Allowed: {}.",
          template.variables.join(", ")
        )));
      }
    }
  }
  Ok(())
}

pub async fn save(
  state: &AppState,
  actor: &AuthIdentity,
  name: &str,
  input: TemplateInput,
) -> Result<TemplateDetail, HttpError> {
  let template = builtin(name)?;
  check(template, &input)?;
  let mut tx = state.db.pool().begin().await?;
  repository::upsert(
    &mut *tx,
    name,
    input.subject.trim(),
    &input.html,
    &input.text,
    actor.actor_id(),
  )
  .await?;
  audit::service::record(
    &mut tx,
    audit::service::Event::by(actor, "email_template.updated")
      .resource("email_template", Some(name)),
  )
  .await?;
  tx.commit().await?;
  get(state, name).await
}

pub async fn reset(
  state: &AppState,
  actor: &AuthIdentity,
  name: &str,
) -> Result<TemplateDetail, HttpError> {
  builtin(name)?;
  let mut tx = state.db.pool().begin().await?;
  if repository::delete(&mut *tx, name).await? {
    audit::service::record(
      &mut tx,
      audit::service::Event::by(actor, "email_template.reset")
        .resource("email_template", Some(name)),
    )
    .await?;
  }
  tx.commit().await?;
  get(state, name).await
}

/// Sample values for previews and test messages.
async fn sample_values(
  state: &AppState,
  email: &str,
) -> Result<Values, HttpError> {
  let branding = settings::service::branding(state.db.pool()).await?;
  let limits = settings::service::limits(state.db.pool()).await?;
  Ok(Values::from([
    ("app_name", branding.app_name),
    ("email", email.to_owned()),
    ("display_name", "Alex".to_owned()),
    ("code", "482913".to_owned()),
    ("expires_minutes", limits.code_minutes.to_string()),
    ("new_email", "new.address@example.com".to_owned()),
  ]))
}

fn render_input(
  input: &TemplateInput,
  values: &Values,
) -> TemplateContent {
  TemplateContent {
    subject: render::subject_line(&render::render(&input.subject, values, false)),
    html: render::render(&input.html, values, true),
    text: render::render(&input.text, values, false),
  }
}

pub async fn preview(
  state: &AppState,
  actor: &AuthIdentity,
  name: &str,
  input: TemplateInput,
) -> Result<TemplateContent, HttpError> {
  let template = builtin(name)?;
  check(template, &input)?;
  let email = match actor {
    AuthIdentity::Admin { email, .. } | AuthIdentity::User { email, .. } => email.clone(),
    AuthIdentity::Agent { .. } | AuthIdentity::Service => "person@example.com".into(),
  };
  Ok(render_input(&input, &sample_values(state, &email).await?))
}

/// Send a draft with sample values to the signed-in admin.
pub async fn test(
  state: &AppState,
  actor: &AuthIdentity,
  name: &str,
  input: TemplateInput,
) -> Result<(), HttpError> {
  let template = builtin(name)?;
  check(template, &input)?;
  let AuthIdentity::Admin { email, .. } = actor else {
    return Err(HttpError::bad_request(
      EMAIL_INVALID,
      "The service key has no email to send a test to. Use an admin's access token.",
    ));
  };
  let content = render_input(&input, &sample_values(state, email).await?);
  let message = Message {
    to: email.clone(),
    subject: content.subject,
    text: content.text,
    html: Some(content.html),
  };
  let config = settings::service::smtp(state).await?;
  mailer::send(config.as_ref(), &message)
    .await
    .map_err(|error| {
      HttpError::new(
        StatusCode::BAD_GATEWAY,
        SMTP_SEND_FAILED,
        format!("The message was not sent: {error}"),
      )
    })
}

/// The values every message gets: the app name, the recipient, their name.
pub async fn base_values(
  state: &AppState,
  email: &str,
  display_name: Option<&str>,
) -> Result<Values, HttpError> {
  let branding = settings::service::branding(state.db.pool()).await?;
  Ok(Values::from([
    ("app_name", branding.app_name),
    ("email", email.to_owned()),
    ("display_name", display_name.unwrap_or_default().to_owned()),
  ]))
}

/// Render a template with `values` and send it in the background. The
/// request does not wait for the SMTP server, so responses take the same
/// time whether or not a message goes out. Failures are logged.
pub async fn send(
  state: &AppState,
  name: &'static str,
  to: &str,
  values: Values,
) -> Result<(), HttpError> {
  let template = builtin(name)?;
  let custom = repository::find(state.db.pool(), name).await?;
  let input = match custom {
    Some(row) => TemplateInput {
      subject: row.subject,
      html: row.html,
      text: row.text,
    },
    None => TemplateInput {
      subject: template.subject.into(),
      html: template.html.into(),
      text: template.text.into(),
    },
  };
  let content = render_input(&input, &values);
  let message = Message {
    to: to.to_owned(),
    subject: content.subject,
    text: content.text,
    html: Some(content.html),
  };
  // A broken SMTP setup must not fail the request that sends the email.
  let config = match settings::service::smtp(state).await {
    Ok(config) => config,
    Err(error) => {
      tracing::error!(%error, template = name, to = %message.to, "the email was not sent");
      return Ok(());
    }
  };
  tokio::spawn(async move {
    if let Err(error) = mailer::send(config.as_ref(), &message).await {
      tracing::error!(%error, template = name, to = %message.to, "failed to send an email");
    }
  });
  Ok(())
}
