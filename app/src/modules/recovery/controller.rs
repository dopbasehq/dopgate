use super::{error::RecoveryError, model::*, service};
use crate::{
  http::{HttpResponse, HttpResponseFormat},
  state::AppState,
};
use axum::{Json, extract::State};

/// Forgot password
///
/// Email a reset code or link. The response is the same whether or not an
/// account uses the address, so it cannot be used to find accounts.
#[utoipa::path(
  post,
  path = crate::constants::api::recovery::FORGOT,
  tag = "recovery",
  security((), ("clientKey" = [])),
  request_body = ForgotPasswordRequest,
  responses(
    (status = 200, description = "If an account uses this email, a message is on its way", body = inline(HttpResponseFormat<serde_json::Value>)),
    (status = 429, description = "Too many requests for this email or address", body = crate::http::ErrorBody),
    (status = 501, description = "Not built yet", body = crate::http::ErrorBody),
  ),
)]
pub async fn forgot(
  State(state): State<AppState>,
  Json(request): Json<ForgotPasswordRequest>,
) -> Result<HttpResponse<serde_json::Value>, RecoveryError> {
  service::forgot(&state, None, request).await?;
  Ok(HttpResponse::done("RESET_REQUESTED"))
}

/// Reset password
///
/// Set a new password with the emailed code or link token. Every session of
/// the account ends.
#[utoipa::path(
  post,
  path = crate::constants::api::recovery::RESET,
  tag = "recovery",
  request_body = ResetPasswordRequest,
  responses(
    (status = 200, description = "Password reset", body = inline(HttpResponseFormat<serde_json::Value>)),
    (status = 400, description = "The code or token is wrong or expired, or the password was refused", body = crate::http::ErrorBody),
    (status = 501, description = "Not built yet", body = crate::http::ErrorBody),
  ),
)]
pub async fn reset(
  State(state): State<AppState>,
  Json(request): Json<ResetPasswordRequest>,
) -> Result<HttpResponse<serde_json::Value>, RecoveryError> {
  service::reset(&state, request).await?;
  Ok(HttpResponse::done("PASSWORD_RESET"))
}
