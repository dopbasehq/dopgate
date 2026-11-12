use super::{error::SettingsError, model::*, service};
use crate::{
  extractors::AdminIdentity,
  http::{HttpResponse, HttpResponseFormat},
  state::AppState,
};
use axum::{Json, extract::State};

/// Read settings
#[utoipa::path(
  get,
  path = crate::constants::api::settings::ROOT,
  tag = "settings",
  security(("bearerAuth" = [])),
  responses(
    (status = 200, description = "Settings fetched", body = inline(HttpResponseFormat<Settings>)),
    (status = 401, description = "Authentication is required", body = crate::http::ErrorBody),
    (status = 403, description = "Only root and admins may read settings", body = crate::http::ErrorBody),
  ),
)]
pub async fn get(
  State(state): State<AppState>,
  AdminIdentity(_actor): AdminIdentity,
) -> Result<HttpResponse<Settings>, SettingsError> {
  Ok(HttpResponse::ok(
    service::get(&state).await?,
    "SETTINGS_FETCHED",
  ))
}

/// Change settings
#[utoipa::path(
  patch,
  path = crate::constants::api::settings::ROOT,
  tag = "settings",
  security(("bearerAuth" = [])),
  request_body = UpdateSettingsRequest,
  responses(
    (status = 200, description = "Settings saved", body = inline(HttpResponseFormat<Settings>)),
    (status = 422, description = "A value was refused", body = crate::http::ErrorBody),
    (status = 401, description = "Authentication is required", body = crate::http::ErrorBody),
    (status = 403, description = "Only root and admins may change settings", body = crate::http::ErrorBody),
  ),
)]
pub async fn update(
  State(state): State<AppState>,
  AdminIdentity(actor): AdminIdentity,
  Json(request): Json<UpdateSettingsRequest>,
) -> Result<HttpResponse<Settings>, SettingsError> {
  Ok(HttpResponse::ok(
    service::update(&state, &actor, request).await?,
    "SETTINGS_UPDATED",
  ))
}

/// Send a test email
///
/// Send a message through the SMTP server in use (`DOPGATE_SMTP_*`, or the
/// one saved in settings) and report the server's answer. Without `to`, it goes to the caller's own email.
#[utoipa::path(
  post,
  path = crate::constants::api::settings::SMTP_TEST,
  tag = "settings",
  security(("bearerAuth" = [])),
  request_body = SmtpTestRequest,
  responses(
    (status = 200, description = "Message accepted by the SMTP server", body = inline(HttpResponseFormat<serde_json::Value>)),
    (status = 400, description = "SMTP is not configured", body = crate::http::ErrorBody),
    (status = 401, description = "Authentication is required", body = crate::http::ErrorBody),
    (status = 403, description = "Only root and admins may test SMTP", body = crate::http::ErrorBody),
    (status = 502, description = "The SMTP server refused the message", body = crate::http::ErrorBody),
  ),
)]
pub async fn test_smtp(
  State(state): State<AppState>,
  AdminIdentity(actor): AdminIdentity,
  request: Option<Json<SmtpTestRequest>>,
) -> Result<HttpResponse<serde_json::Value>, SettingsError> {
  let request = request.map(|Json(request)| request).unwrap_or_default();
  service::test_smtp(&state, &actor, request).await?;
  Ok(HttpResponse::done("SMTP_TEST_SENT"))
}
