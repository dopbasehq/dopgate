use super::{error::VerificationError, model::*, service};
use crate::{
  extractors::RequestContext,
  http::{HttpResponse, HttpResponseFormat},
  modules::{auth::model::AuthTokens, sessions},
  state::AppState,
};
use axum::{
  Json,
  extract::State,
  http::StatusCode,
  response::{IntoResponse, Response},
};

/// Send a code
///
/// Email a 6-digit code to verify an address (`email_verify`) or to sign in
/// without a password (`login`). The answer is the same whether or not the
/// email has an account. Asking again replaces the earlier code, after a
/// short wait.
#[utoipa::path(
  post,
  path = crate::constants::api::verification::SEND,
  tag = "verification",
  request_body = SendCodeRequest,
  responses(
    (status = 200, description = "A code was sent if the email can receive one", body = inline(HttpResponseFormat<serde_json::Value>)),
    (status = 422, description = "The email or purpose was refused", body = crate::http::ErrorBody),
    (status = 429, description = "Too many codes; see Retry-After", body = crate::http::ErrorBody),
  ),
)]
pub async fn send(
  State(state): State<AppState>,
  Json(request): Json<SendCodeRequest>,
) -> Result<HttpResponse<serde_json::Value>, VerificationError> {
  service::send(&state, request).await?;
  Ok(HttpResponse::done("CODE_SENT"))
}

/// Confirm a code
///
/// For `email_verify` and `login`, marks the email verified and signs the
/// user in. For `email_change`, moves the account to the new address (pass
/// the new address as `email`) and returns the account.
#[utoipa::path(
  post,
  path = crate::constants::api::verification::CONFIRM,
  tag = "verification",
  request_body = ConfirmCodeRequest,
  responses(
    (status = 200, description = "Confirmed. Tokens for email_verify and login, the user for email_change", body = inline(HttpResponseFormat<AuthTokens>)),
    (status = 400, description = "The code is wrong, used up, or expired", body = crate::http::ErrorBody),
    (status = 403, description = "The account is disabled", body = crate::http::ErrorBody),
    (status = 409, description = "The new email is taken", body = crate::http::ErrorBody),
    (status = 429, description = "Too many attempts", body = crate::http::ErrorBody),
  ),
)]
pub async fn confirm(
  State(state): State<AppState>,
  context: RequestContext,
  Json(request): Json<ConfirmCodeRequest>,
) -> Result<Response, VerificationError> {
  match service::confirm(&state, request, context.user_agent.as_deref()).await? {
    service::Confirmed::SignedIn(tokens) => Ok(
      sessions::service::deliver(&state, &context, tokens, "SIGNED_IN", StatusCode::OK)
        .await?
        .into_response(),
    ),
    service::Confirmed::EmailChanged(user) => {
      Ok(HttpResponse::ok(user, "EMAIL_CHANGED").into_response())
    }
  }
}
