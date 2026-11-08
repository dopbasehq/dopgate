use super::{error::SessionsError, model::*, service};
use crate::{
  http::{HttpResponse, HttpResponseFormat},
  models::AuthIdentity,
  state::AppState,
};
use axum::extract::{Path, State};

/// List sessions
///
/// List the devices signed in to the current account, newest first.
#[utoipa::path(
  get,
  path = crate::constants::api::sessions::COLLECTION,
  tag = "sessions",
  security(("bearerAuth" = [])),
  responses(
    (status = 200, description = "Sessions fetched", body = inline(HttpResponseFormat<Vec<SessionResponse>>)),
    (status = 401, description = "Authentication is required", body = crate::http::ErrorBody),
    (status = 501, description = "Not built yet", body = crate::http::ErrorBody),
  ),
)]
pub async fn list(
  State(state): State<AppState>,
  identity: AuthIdentity,
) -> Result<HttpResponse<Vec<SessionResponse>>, SessionsError> {
  Ok(HttpResponse::ok(
    service::list(&state, &identity).await?,
    "SESSIONS_FETCHED",
  ))
}

/// Sign out a device
///
/// End one session of the current account. Its refresh token stops
/// working; its access token runs out within minutes.
#[utoipa::path(
  delete,
  path = crate::constants::api::sessions::ITEM,
  tag = "sessions",
  security(("bearerAuth" = [])),
  params(("id" = String, Path, description = "Session ID with the ses_ prefix")),
  responses(
    (status = 200, description = "Session ended", body = inline(HttpResponseFormat<serde_json::Value>)),
    (status = 401, description = "Authentication is required", body = crate::http::ErrorBody),
    (status = 404, description = "No such session on this account", body = crate::http::ErrorBody),
    (status = 501, description = "Not built yet", body = crate::http::ErrorBody),
  ),
)]
pub async fn revoke(
  State(state): State<AppState>,
  identity: AuthIdentity,
  Path(id): Path<String>,
) -> Result<HttpResponse<serde_json::Value>, SessionsError> {
  service::revoke(&state, &identity, &id).await?;
  Ok(HttpResponse::done("SESSION_REVOKED"))
}
