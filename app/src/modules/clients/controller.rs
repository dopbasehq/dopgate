use super::{error::ClientsError, model::*, service};
use crate::{
  extractors::AdminIdentity,
  http::{HttpResponse, HttpResponseFormat},
  state::AppState,
};
use axum::{
  Json,
  extract::{Path, State},
};

/// List clients
#[utoipa::path(
  get,
  path = crate::constants::api::clients::COLLECTION,
  tag = "clients",
  security(("bearerAuth" = [])),
  responses(
    (status = 200, description = "Clients fetched", body = inline(HttpResponseFormat<Vec<ClientResponse>>)),
    (status = 401, description = "Authentication is required", body = crate::http::ErrorBody),
    (status = 403, description = "Only root and admins may manage clients", body = crate::http::ErrorBody),
    (status = 501, description = "Not built yet", body = crate::http::ErrorBody),
  ),
)]
pub async fn list(
  State(state): State<AppState>,
  AdminIdentity(_actor): AdminIdentity,
) -> Result<HttpResponse<Vec<ClientResponse>>, ClientsError> {
  Ok(HttpResponse::ok(
    service::list(&state).await?,
    "CLIENTS_FETCHED",
  ))
}

/// Show a client
#[utoipa::path(
  get,
  path = crate::constants::api::clients::ITEM,
  tag = "clients",
  security(("bearerAuth" = [])),
  params(("id" = String, Path, description = "Client ID with the cli_ prefix")),
  responses(
    (status = 200, description = "Client fetched", body = inline(HttpResponseFormat<ClientResponse>)),
    (status = 401, description = "Authentication is required", body = crate::http::ErrorBody),
    (status = 403, description = "Only root and admins may manage clients", body = crate::http::ErrorBody),
    (status = 404, description = "No such client", body = crate::http::ErrorBody),
    (status = 501, description = "Not built yet", body = crate::http::ErrorBody),
  ),
)]
pub async fn get(
  State(state): State<AppState>,
  AdminIdentity(_actor): AdminIdentity,
  Path(id): Path<String>,
) -> Result<HttpResponse<ClientResponse>, ClientsError> {
  Ok(HttpResponse::ok(
    service::get(&state, &id).await?,
    "CLIENT_FETCHED",
  ))
}

/// Register a client
///
/// Register an app and get its publishable key and secret key. The secret
/// key is shown once.
#[utoipa::path(
  post,
  path = crate::constants::api::clients::COLLECTION,
  tag = "clients",
  security(("bearerAuth" = [])),
  request_body = CreateClientRequest,
  responses(
    (status = 201, description = "Client registered", body = inline(HttpResponseFormat<ClientWithSecret>)),
    (status = 400, description = "A name, URL, or origin was refused", body = crate::http::ErrorBody),
    (status = 401, description = "Authentication is required", body = crate::http::ErrorBody),
    (status = 403, description = "Only root and admins may manage clients", body = crate::http::ErrorBody),
    (status = 501, description = "Not built yet", body = crate::http::ErrorBody),
  ),
)]
pub async fn create(
  State(state): State<AppState>,
  AdminIdentity(actor): AdminIdentity,
  Json(request): Json<CreateClientRequest>,
) -> Result<HttpResponse<ClientWithSecret>, ClientsError> {
  Ok(HttpResponse::created(
    service::create(&state, &actor, request).await?,
    "CLIENT_CREATED",
  ))
}

/// Update a client
#[utoipa::path(
  patch,
  path = crate::constants::api::clients::ITEM,
  tag = "clients",
  security(("bearerAuth" = [])),
  params(("id" = String, Path, description = "Client ID with the cli_ prefix")),
  request_body = UpdateClientRequest,
  responses(
    (status = 200, description = "Client updated", body = inline(HttpResponseFormat<ClientResponse>)),
    (status = 400, description = "A name, URL, or origin was refused", body = crate::http::ErrorBody),
    (status = 401, description = "Authentication is required", body = crate::http::ErrorBody),
    (status = 403, description = "Only root and admins may manage clients", body = crate::http::ErrorBody),
    (status = 404, description = "No such client", body = crate::http::ErrorBody),
    (status = 501, description = "Not built yet", body = crate::http::ErrorBody),
  ),
)]
pub async fn update(
  State(state): State<AppState>,
  AdminIdentity(actor): AdminIdentity,
  Path(id): Path<String>,
  Json(request): Json<UpdateClientRequest>,
) -> Result<HttpResponse<ClientResponse>, ClientsError> {
  Ok(HttpResponse::ok(
    service::update(&state, &actor, &id, request).await?,
    "CLIENT_UPDATED",
  ))
}

/// Delete a client
///
/// Its keys stop working at once. Sessions it started keep working until
/// they expire or are revoked.
#[utoipa::path(
  delete,
  path = crate::constants::api::clients::ITEM,
  tag = "clients",
  security(("bearerAuth" = [])),
  params(("id" = String, Path, description = "Client ID with the cli_ prefix")),
  responses(
    (status = 200, description = "Client deleted", body = inline(HttpResponseFormat<serde_json::Value>)),
    (status = 401, description = "Authentication is required", body = crate::http::ErrorBody),
    (status = 403, description = "Only root and admins may manage clients", body = crate::http::ErrorBody),
    (status = 404, description = "No such client", body = crate::http::ErrorBody),
    (status = 501, description = "Not built yet", body = crate::http::ErrorBody),
  ),
)]
pub async fn delete(
  State(state): State<AppState>,
  AdminIdentity(actor): AdminIdentity,
  Path(id): Path<String>,
) -> Result<HttpResponse<serde_json::Value>, ClientsError> {
  service::delete(&state, &actor, &id).await?;
  Ok(HttpResponse::done("CLIENT_DELETED"))
}

/// Replace the secret key
///
/// Issue a new secret key. The old one stops working at once.
#[utoipa::path(
  post,
  path = crate::constants::api::clients::SECRET,
  tag = "clients",
  security(("bearerAuth" = [])),
  params(("id" = String, Path, description = "Client ID with the cli_ prefix")),
  responses(
    (status = 200, description = "Secret key replaced", body = inline(HttpResponseFormat<ClientWithSecret>)),
    (status = 401, description = "Authentication is required", body = crate::http::ErrorBody),
    (status = 403, description = "Only root and admins may manage clients", body = crate::http::ErrorBody),
    (status = 404, description = "No such client", body = crate::http::ErrorBody),
    (status = 501, description = "Not built yet", body = crate::http::ErrorBody),
  ),
)]
pub async fn rotate_secret(
  State(state): State<AppState>,
  AdminIdentity(actor): AdminIdentity,
  Path(id): Path<String>,
) -> Result<HttpResponse<ClientWithSecret>, ClientsError> {
  Ok(HttpResponse::ok(
    service::rotate_secret(&state, &actor, &id).await?,
    "CLIENT_SECRET_ROTATED",
  ))
}
