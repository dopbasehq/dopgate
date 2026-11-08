use super::{error::MfaError, model::*, service};
use crate::{
  http::{HttpResponse, HttpResponseFormat},
  models::AuthIdentity,
  modules::auth::model::AuthTokens,
  state::AppState,
};
use axum::{Json, extract::State};

/// Start authenticator app setup
///
/// Create a TOTP secret for the signed-in account. It does nothing until
/// confirmed with a code.
#[utoipa::path(
  post,
  path = crate::constants::api::mfa::TOTP_ENROLL,
  tag = "mfa",
  security(("bearerAuth" = [])),
  responses(
    (status = 200, description = "Secret created", body = inline(HttpResponseFormat<TotpEnrollment>)),
    (status = 401, description = "Authentication is required", body = crate::http::ErrorBody),
    (status = 409, description = "An authenticator app is already set up", body = crate::http::ErrorBody),
    (status = 501, description = "Not built yet", body = crate::http::ErrorBody),
  ),
)]
pub async fn enroll(
  State(state): State<AppState>,
  identity: AuthIdentity,
) -> Result<HttpResponse<TotpEnrollment>, MfaError> {
  Ok(HttpResponse::ok(
    service::enroll(&state, &identity).await?,
    "TOTP_ENROLLMENT_STARTED",
  ))
}

/// Confirm authenticator app
///
/// Turn on the second factor with a first code, and get recovery codes.
#[utoipa::path(
  post,
  path = crate::constants::api::mfa::TOTP_VERIFY,
  tag = "mfa",
  security(("bearerAuth" = [])),
  request_body = TotpCodeRequest,
  responses(
    (status = 200, description = "Second factor on", body = inline(HttpResponseFormat<RecoveryCodes>)),
    (status = 400, description = "The code is wrong", body = crate::http::ErrorBody),
    (status = 401, description = "Authentication is required", body = crate::http::ErrorBody),
    (status = 501, description = "Not built yet", body = crate::http::ErrorBody),
  ),
)]
pub async fn verify(
  State(state): State<AppState>,
  identity: AuthIdentity,
  Json(request): Json<TotpCodeRequest>,
) -> Result<HttpResponse<RecoveryCodes>, MfaError> {
  Ok(HttpResponse::ok(
    service::verify(&state, &identity, request).await?,
    "TOTP_ENABLED",
  ))
}

/// Remove authenticator app
///
/// Turn off the second factor. Needs a current code or a recovery code.
#[utoipa::path(
  delete,
  path = crate::constants::api::mfa::TOTP,
  tag = "mfa",
  security(("bearerAuth" = [])),
  request_body = TotpCodeRequest,
  responses(
    (status = 200, description = "Second factor off", body = inline(HttpResponseFormat<serde_json::Value>)),
    (status = 400, description = "The code is wrong", body = crate::http::ErrorBody),
    (status = 401, description = "Authentication is required", body = crate::http::ErrorBody),
    (status = 501, description = "Not built yet", body = crate::http::ErrorBody),
  ),
)]
pub async fn remove(
  State(state): State<AppState>,
  identity: AuthIdentity,
  Json(request): Json<TotpCodeRequest>,
) -> Result<HttpResponse<serde_json::Value>, MfaError> {
  service::remove(&state, &identity, request).await?;
  Ok(HttpResponse::done("TOTP_REMOVED"))
}

/// Finish an MFA sign-in
///
/// Trade the `mfaToken` from the first sign-in step and a code for tokens.
#[utoipa::path(
  post,
  path = crate::constants::api::mfa::CHALLENGE,
  tag = "mfa",
  request_body = MfaChallengeRequest,
  responses(
    (status = 200, description = "Signed in", body = inline(HttpResponseFormat<AuthTokens>)),
    (status = 401, description = "The MFA token or code is wrong or expired", body = crate::http::ErrorBody),
    (status = 429, description = "Too many wrong codes", body = crate::http::ErrorBody),
    (status = 501, description = "Not built yet", body = crate::http::ErrorBody),
  ),
)]
pub async fn challenge(
  State(state): State<AppState>,
  Json(request): Json<MfaChallengeRequest>,
) -> Result<HttpResponse<AuthTokens>, MfaError> {
  Ok(HttpResponse::ok(
    service::challenge(&state, request).await?,
    "SIGNED_IN",
  ))
}
