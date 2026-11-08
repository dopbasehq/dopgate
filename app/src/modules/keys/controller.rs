use super::{error::KeysError, model::*, service};
use crate::{
  extractors::{AdminIdentity, RootIdentity},
  http::{HttpResponse, HttpResponseFormat},
  state::AppState,
};
use axum::{Json, extract::State};

/// Public signing keys
///
/// The JSON Web Key Set your backend uses to verify access tokens without
/// calling dopgate. Cache it, and fetch it again when a token names a `kid`
/// you have not seen.
#[utoipa::path(
  get,
  path = crate::constants::api::keys::JWKS,
  tag = "keys",
  responses(
    (status = 200, description = "Key set", body = Jwks),
    (status = 501, description = "Not built yet", body = crate::http::ErrorBody),
  ),
)]
pub async fn jwks(State(state): State<AppState>) -> Result<Json<Jwks>, KeysError> {
  Ok(Json(service::jwks(&state).await?))
}

/// List signing keys
#[utoipa::path(
  get,
  path = crate::constants::api::keys::COLLECTION,
  tag = "keys",
  security(("bearerAuth" = [])),
  responses(
    (status = 200, description = "Keys fetched", body = inline(HttpResponseFormat<Vec<SigningKeyResponse>>)),
    (status = 401, description = "Authentication is required", body = crate::http::ErrorBody),
    (status = 403, description = "Only root and admins may read keys", body = crate::http::ErrorBody),
    (status = 501, description = "Not built yet", body = crate::http::ErrorBody),
  ),
)]
pub async fn list(
  State(state): State<AppState>,
  AdminIdentity(_actor): AdminIdentity,
) -> Result<HttpResponse<Vec<SigningKeyResponse>>, KeysError> {
  Ok(HttpResponse::ok(
    service::list(&state).await?,
    "SIGNING_KEYS_FETCHED",
  ))
}

/// Rotate the signing key
///
/// Start signing with a new key. The old key keeps verifying the tokens it
/// signed until they expire.
#[utoipa::path(
  post,
  path = crate::constants::api::keys::ROTATE,
  tag = "keys",
  security(("bearerAuth" = [])),
  responses(
    (status = 200, description = "Key rotated", body = inline(HttpResponseFormat<SigningKeyResponse>)),
    (status = 401, description = "Authentication is required", body = crate::http::ErrorBody),
    (status = 403, description = "Only root may rotate keys", body = crate::http::ErrorBody),
    (status = 501, description = "Not built yet", body = crate::http::ErrorBody),
  ),
)]
pub async fn rotate(
  State(state): State<AppState>,
  RootIdentity(actor): RootIdentity,
) -> Result<HttpResponse<SigningKeyResponse>, KeysError> {
  Ok(HttpResponse::ok(
    service::rotate(&state, &actor).await?,
    "SIGNING_KEY_ROTATED",
  ))
}
