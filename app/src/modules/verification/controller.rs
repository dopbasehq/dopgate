use super::{error::VerificationError, model::*, service};
use crate::{
  http::{HttpResponse, HttpResponseFormat},
  state::AppState,
};
use axum::{Json, extract::State};

/// Send a code or link
///
/// Email a one-time code or a link that proves the user owns the address.
/// Use it to verify an email, to sign in without a password, or to move an
/// account to a new email. Sending again replaces the previous code.
#[utoipa::path(
  post,
  path = crate::constants::api::verification::SEND,
  tag = "verification",
  security((), ("clientKey" = [])),
  request_body = SendVerificationRequest,
  responses(
    (status = 200, description = "Message on its way", body = inline(HttpResponseFormat<serde_json::Value>)),
    (status = 400, description = "The email or redirect URL was refused", body = crate::http::ErrorBody),
    (status = 429, description = "Too many messages for this email or address", body = crate::http::ErrorBody),
    (status = 501, description = "Not built yet", body = crate::http::ErrorBody),
  ),
)]
pub async fn send(
  State(state): State<AppState>,
  Json(request): Json<SendVerificationRequest>,
) -> Result<HttpResponse<serde_json::Value>, VerificationError> {
  service::send(&state, None, request).await?;
  Ok(HttpResponse::done("VERIFICATION_SENT"))
}

/// Confirm a code or link
///
/// Check the code the user typed or the token from the link. For a
/// passwordless sign-in the response carries tokens.
#[utoipa::path(
  post,
  path = crate::constants::api::verification::CONFIRM,
  tag = "verification",
  security((), ("clientKey" = [])),
  request_body = ConfirmVerificationRequest,
  responses(
    (status = 200, description = "Verified", body = inline(HttpResponseFormat<VerificationResult>)),
    (status = 400, description = "The code or token is wrong, used, or expired", body = crate::http::ErrorBody),
    (status = 429, description = "Too many wrong codes", body = crate::http::ErrorBody),
    (status = 501, description = "Not built yet", body = crate::http::ErrorBody),
  ),
)]
pub async fn confirm(
  State(state): State<AppState>,
  Json(request): Json<ConfirmVerificationRequest>,
) -> Result<HttpResponse<VerificationResult>, VerificationError> {
  Ok(HttpResponse::ok(
    service::confirm(&state, None, request).await?,
    "VERIFIED",
  ))
}
