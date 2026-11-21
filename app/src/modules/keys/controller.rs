use super::{error::KeysError, model::*, service};
use crate::{
  extractors::{AdminIdentity, RootIdentity},
  http::{HttpResponse, HttpResponseFormat},
  state::AppState,
};
use axum::response::{IntoResponse, Response};
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
  ),
)]
pub async fn jwks(State(state): State<AppState>) -> Result<Response, KeysError> {
  let mut response = Json(service::jwks(&state).await).into_response();
  // Backends cache the key set; a rotated key is picked up within minutes.
  response.headers_mut().insert(
    axum::http::header::CACHE_CONTROL,
    axum::http::HeaderValue::from_static("public, max-age=300"),
  );
  Ok(response)
}

/// Discovery document
///
/// Tells a tool that only knows the issuer URL, such as an API gateway,
/// where the key set is. Dopgate is not an OpenID Connect provider: there
/// is no authorization endpoint, and the document says nothing else.
#[utoipa::path(
  get,
  path = crate::constants::api::keys::DISCOVERY,
  tag = "keys",
  responses(
    (status = 200, description = "Discovery document", body = Discovery),
  ),
)]
pub async fn discovery(State(state): State<AppState>) -> Response {
  let mut response = Json(service::discovery(&state)).into_response();
  response.headers_mut().insert(
    axum::http::header::CACHE_CONTROL,
    axum::http::HeaderValue::from_static("public, max-age=300"),
  );
  response
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
  ),
)]
pub async fn rotate(
  State(state): State<AppState>,
  RootIdentity(actor): RootIdentity,
) -> Result<HttpResponse<SigningKeyResponse>, KeysError> {
  Ok(HttpResponse::ok(
    service::rotate(&state, Some(&actor)).await?,
    "SIGNING_KEY_ROTATED",
  ))
}
