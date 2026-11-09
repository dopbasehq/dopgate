use super::{error::RecoveryError, model::*, service};
use crate::{
  http::{HttpResponse, HttpResponseFormat},
  state::AppState,
};
use axum::{Json, extract::State};

/// Forgot password
///
/// Email a 6-digit reset code. The answer is the same whether or not an
/// account uses the address, so it cannot be used to find accounts.
#[utoipa::path(
  post,
  path = crate::constants::api::recovery::FORGOT,
  tag = "recovery",
  request_body = ForgotPasswordRequest,
  responses(
    (status = 200, description = "If an account uses this email, a code is on its way", body = inline(HttpResponseFormat<serde_json::Value>)),
    (status = 422, description = "The email is not valid", body = crate::http::ErrorBody),
    (status = 429, description = "Too many requests for this email or address", body = crate::http::ErrorBody),
  ),
)]
pub async fn forgot(
  State(state): State<AppState>,
  Json(request): Json<ForgotPasswordRequest>,
) -> Result<HttpResponse<serde_json::Value>, RecoveryError> {
  service::forgot(&state, request).await?;
  Ok(HttpResponse::done("PASSWORD_RESET_SENT"))
}

/// Reset password
///
/// Set a new password with the emailed code. Every session of the account
/// ends, so devices someone else signed in on are signed out too.
#[utoipa::path(
  post,
  path = crate::constants::api::recovery::RESET,
  tag = "recovery",
  request_body = ResetPasswordRequest,
  responses(
    (status = 200, description = "Password changed", body = inline(HttpResponseFormat<serde_json::Value>)),
    (status = 400, description = "The code is wrong, used up, or expired", body = crate::http::ErrorBody),
    (status = 422, description = "The new password was refused", body = crate::http::ErrorBody),
    (status = 429, description = "Too many attempts", body = crate::http::ErrorBody),
  ),
)]
pub async fn reset(
  State(state): State<AppState>,
  Json(request): Json<ResetPasswordRequest>,
) -> Result<HttpResponse<serde_json::Value>, RecoveryError> {
  service::reset(&state, request).await?;
  Ok(HttpResponse::done("PASSWORD_RESET"))
}
