use super::{error::BootstrapError, model::*, service};
use crate::{
  http::{HttpResponse, HttpResponseFormat},
  state::AppState,
};
use axum::{Json, extract::State};

/// Setup status
///
/// Report whether the root account exists. A new instance has none until
/// `dopgate init` runs or `POST /bootstrap/root` succeeds.
#[utoipa::path(
  get,
  path = crate::constants::api::bootstrap::STATUS,
  tag = "bootstrap",
  responses(
    (status = 200, description = "Setup status fetched", body = inline(HttpResponseFormat<BootstrapStatus>)),
  ),
)]
pub async fn status(
  State(state): State<AppState>
) -> Result<HttpResponse<BootstrapStatus>, BootstrapError> {
  Ok(HttpResponse::ok(
    service::status(&state).await?,
    "BOOTSTRAP_STATUS_FETCHED",
  ))
}

/// Create the root account
///
/// Create the instance owner with the one-time setup token the server
/// prints at startup. Works once; afterwards it returns 409. Five wrong
/// tokens from one address lock it out for 15 minutes.
#[utoipa::path(
  post,
  path = crate::constants::api::bootstrap::ROOT,
  tag = "bootstrap",
  request_body = CreateRootRequest,
  responses(
    (status = 201, description = "Root account created", body = inline(HttpResponseFormat<RootCreated>)),
    (status = 422, description = "The email or password was refused", body = crate::http::ErrorBody),
    (status = 401, description = "The setup token is wrong", body = crate::http::ErrorBody),
    (status = 409, description = "The root account already exists", body = crate::http::ErrorBody),
    (status = 429, description = "Too many wrong setup tokens", body = crate::http::ErrorBody),
  ),
)]
pub async fn create_root(
  State(state): State<AppState>,
  Json(request): Json<CreateRootRequest>,
) -> Result<HttpResponse<RootCreated>, BootstrapError> {
  Ok(HttpResponse::created(
    service::bootstrap_root(&state, request).await?,
    "ROOT_CREATED",
  ))
}
