use super::{error::EmailTemplatesError, model::*, service};
use crate::{
  extractors::AdminIdentity,
  http::{HttpResponse, HttpResponseFormat},
  state::AppState,
};
use axum::{
  Json,
  extract::{Path, State},
};

/// List email templates
///
/// The six messages Dopgate sends, and whether each one is customized.
#[utoipa::path(
  get,
  path = crate::constants::api::email_templates::COLLECTION,
  tag = "email-templates",
  security(("bearerAuth" = [])),
  responses(
    (status = 200, description = "Templates fetched", body = inline(HttpResponseFormat<Vec<TemplateSummary>>)),
    (status = 401, description = "Authentication is required", body = crate::http::ErrorBody),
    (status = 403, description = "Only root, admins, and the service key", body = crate::http::ErrorBody),
  ),
)]
pub async fn list(
  State(state): State<AppState>,
  AdminIdentity(_actor): AdminIdentity,
) -> Result<HttpResponse<Vec<TemplateSummary>>, EmailTemplatesError> {
  Ok(HttpResponse::ok(
    service::list(&state).await?,
    "EMAIL_TEMPLATES_FETCHED",
  ))
}

/// Show an email template
///
/// The version in use, the built-in version, and the variables it accepts.
#[utoipa::path(
  get,
  path = crate::constants::api::email_templates::ITEM,
  tag = "email-templates",
  security(("bearerAuth" = [])),
  params(("name" = String, Path, description = "verify_email, login_code, password_reset, email_change, email_changed, or password_changed")),
  responses(
    (status = 200, description = "Template fetched", body = inline(HttpResponseFormat<TemplateDetail>)),
    (status = 404, description = "No such template", body = crate::http::ErrorBody),
  ),
)]
pub async fn get(
  State(state): State<AppState>,
  AdminIdentity(_actor): AdminIdentity,
  Path(name): Path<String>,
) -> Result<HttpResponse<TemplateDetail>, EmailTemplatesError> {
  Ok(HttpResponse::ok(
    service::get(&state, &name).await?,
    "EMAIL_TEMPLATE_FETCHED",
  ))
}

/// Customize an email template
///
/// Save a subject, HTML, and text that replace the built-in version.
/// Placeholders such as `{{code}}` must be ones the template accepts.
#[utoipa::path(
  put,
  path = crate::constants::api::email_templates::ITEM,
  tag = "email-templates",
  security(("bearerAuth" = [])),
  params(("name" = String, Path, description = "Template name")),
  request_body = TemplateInput,
  responses(
    (status = 200, description = "Template saved", body = inline(HttpResponseFormat<TemplateDetail>)),
    (status = 404, description = "No such template", body = crate::http::ErrorBody),
    (status = 422, description = "The template was refused", body = crate::http::ErrorBody),
  ),
)]
pub async fn save(
  State(state): State<AppState>,
  AdminIdentity(actor): AdminIdentity,
  Path(name): Path<String>,
  Json(input): Json<TemplateInput>,
) -> Result<HttpResponse<TemplateDetail>, EmailTemplatesError> {
  Ok(HttpResponse::ok(
    service::save(&state, &actor, &name, input).await?,
    "EMAIL_TEMPLATE_SAVED",
  ))
}

/// Reset an email template
///
/// Remove the override, so the built-in version is used again.
#[utoipa::path(
  delete,
  path = crate::constants::api::email_templates::ITEM,
  tag = "email-templates",
  security(("bearerAuth" = [])),
  params(("name" = String, Path, description = "Template name")),
  responses(
    (status = 200, description = "Template reset", body = inline(HttpResponseFormat<TemplateDetail>)),
    (status = 404, description = "No such template", body = crate::http::ErrorBody),
  ),
)]
pub async fn reset(
  State(state): State<AppState>,
  AdminIdentity(actor): AdminIdentity,
  Path(name): Path<String>,
) -> Result<HttpResponse<TemplateDetail>, EmailTemplatesError> {
  Ok(HttpResponse::ok(
    service::reset(&state, &actor, &name).await?,
    "EMAIL_TEMPLATE_RESET",
  ))
}

/// Preview an email template
///
/// Render a draft with sample values. Nothing is saved or sent.
#[utoipa::path(
  post,
  path = crate::constants::api::email_templates::PREVIEW,
  tag = "email-templates",
  security(("bearerAuth" = [])),
  params(("name" = String, Path, description = "Template name")),
  request_body = TemplateInput,
  responses(
    (status = 200, description = "Draft rendered", body = inline(HttpResponseFormat<TemplateContent>)),
    (status = 422, description = "The draft was refused", body = crate::http::ErrorBody),
  ),
)]
pub async fn preview(
  State(state): State<AppState>,
  AdminIdentity(actor): AdminIdentity,
  Path(name): Path<String>,
  Json(input): Json<TemplateInput>,
) -> Result<HttpResponse<TemplateContent>, EmailTemplatesError> {
  Ok(HttpResponse::ok(
    service::preview(&state, &actor, &name, input).await?,
    "EMAIL_TEMPLATE_PREVIEWED",
  ))
}

/// Send a test email
///
/// Render a draft with sample values and send it to the signed-in admin.
#[utoipa::path(
  post,
  path = crate::constants::api::email_templates::TEST,
  tag = "email-templates",
  security(("bearerAuth" = [])),
  params(("name" = String, Path, description = "Template name")),
  request_body = TemplateInput,
  responses(
    (status = 200, description = "Test sent", body = inline(HttpResponseFormat<serde_json::Value>)),
    (status = 422, description = "The draft was refused", body = crate::http::ErrorBody),
    (status = 502, description = "The SMTP server refused the message", body = crate::http::ErrorBody),
  ),
)]
pub async fn test(
  State(state): State<AppState>,
  AdminIdentity(actor): AdminIdentity,
  Path(name): Path<String>,
  Json(input): Json<TemplateInput>,
) -> Result<HttpResponse<serde_json::Value>, EmailTemplatesError> {
  service::test(&state, &actor, &name, input).await?;
  Ok(HttpResponse::done("EMAIL_TEMPLATE_TEST_SENT"))
}
