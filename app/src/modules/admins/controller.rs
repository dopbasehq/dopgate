use super::{error::AdminsError, model::*, service};
use crate::{
  extractors::{AdminIdentity, RootIdentity},
  http::{HttpResponse, HttpResponseFormat},
  models::{Admin, UserStatus},
  state::AppState,
};
use axum::{
  Json,
  extract::{Path, State},
  http::StatusCode,
  response::{IntoResponse, Response},
};

/// List admins
///
/// Root and every admin, root first. Admins and the service key can read the
/// list; only root changes it.
#[utoipa::path(
  get,
  path = crate::constants::api::admins::COLLECTION,
  tag = "admins",
  security(("bearerAuth" = [])),
  responses(
    (status = 200, description = "Admins fetched", body = inline(HttpResponseFormat<AdminList>)),
    (status = 401, description = "Authentication is required", body = crate::http::ErrorBody),
    (status = 403, description = "Only admins and the service key", body = crate::http::ErrorBody),
  ),
)]
pub async fn list(
  State(state): State<AppState>,
  AdminIdentity(_actor): AdminIdentity,
) -> Result<HttpResponse<AdminList>, AdminsError> {
  Ok(HttpResponse::ok(
    service::list(&state).await?,
    "ADMINS_FETCHED",
  ))
}

/// Show an admin
#[utoipa::path(
  get,
  path = crate::constants::api::admins::ITEM,
  tag = "admins",
  security(("bearerAuth" = [])),
  params(("id" = String, Path, description = "Admin ID with the adm_ prefix")),
  responses(
    (status = 200, description = "Admin fetched", body = inline(HttpResponseFormat<Admin>)),
    (status = 404, description = "No such admin", body = crate::http::ErrorBody),
  ),
)]
pub async fn get(
  State(state): State<AppState>,
  AdminIdentity(_actor): AdminIdentity,
  Path(id): Path<String>,
) -> Result<HttpResponse<Admin>, AdminsError> {
  Ok(HttpResponse::ok(
    service::get(&state, &id).await?,
    "ADMIN_FETCHED",
  ))
}

/// Add an admin
///
/// Root only. No email is sent. Leave out `password` for an admin who signs
/// in to the console with emailed codes.
#[utoipa::path(
  post,
  path = crate::constants::api::admins::COLLECTION,
  tag = "admins",
  security(("bearerAuth" = [])),
  request_body = CreateAdminRequest,
  responses(
    (status = 201, description = "Admin added", body = inline(HttpResponseFormat<Admin>)),
    (status = 403, description = "Only root adds admins", body = crate::http::ErrorBody),
    (status = 409, description = "Another admin uses this email", body = crate::http::ErrorBody),
    (status = 422, description = "A value was refused", body = crate::http::ErrorBody),
  ),
)]
pub async fn create(
  State(state): State<AppState>,
  RootIdentity(actor): RootIdentity,
  Json(request): Json<CreateAdminRequest>,
) -> Result<HttpResponse<Admin>, AdminsError> {
  Ok(HttpResponse::created(
    service::create(&state, &actor, request).await?,
    "ADMIN_CREATED",
  ))
}

/// Update an admin
///
/// Root only. Change the display name or avatar URL. Root's own account
/// changes through `/console/me`.
#[utoipa::path(
  patch,
  path = crate::constants::api::admins::ITEM,
  tag = "admins",
  security(("bearerAuth" = [])),
  params(("id" = String, Path, description = "Admin ID with the adm_ prefix")),
  request_body = UpdateAdminRequest,
  responses(
    (status = 200, description = "Admin updated", body = inline(HttpResponseFormat<Admin>)),
    (status = 403, description = "Only root changes admins, and root is protected", body = crate::http::ErrorBody),
    (status = 404, description = "No such admin", body = crate::http::ErrorBody),
  ),
)]
pub async fn update(
  State(state): State<AppState>,
  RootIdentity(actor): RootIdentity,
  Path(id): Path<String>,
  Json(request): Json<UpdateAdminRequest>,
) -> Result<HttpResponse<Admin>, AdminsError> {
  Ok(HttpResponse::ok(
    service::update(&state, &actor, &id, request).await?,
    "ADMIN_UPDATED",
  ))
}

/// Remove an admin
///
/// Root only. Ends the admin's console sessions. The audit log keeps an
/// `admin.deleted` event.
#[utoipa::path(
  delete,
  path = crate::constants::api::admins::ITEM,
  tag = "admins",
  security(("bearerAuth" = [])),
  params(("id" = String, Path, description = "Admin ID with the adm_ prefix")),
  responses(
    (status = 204, description = "Admin removed"),
    (status = 403, description = "Only root removes admins, and root is protected", body = crate::http::ErrorBody),
    (status = 404, description = "No such admin", body = crate::http::ErrorBody),
  ),
)]
pub async fn delete(
  State(state): State<AppState>,
  RootIdentity(actor): RootIdentity,
  Path(id): Path<String>,
) -> Result<Response, AdminsError> {
  service::delete(&state, &actor, &id).await?;
  Ok(StatusCode::NO_CONTENT.into_response())
}

/// Disable an admin
///
/// Root only. Ends every console session of the admin and refuses new
/// sign-ins until root enables the account again.
#[utoipa::path(
  post,
  path = crate::constants::api::admins::DISABLE,
  tag = "admins",
  security(("bearerAuth" = [])),
  params(("id" = String, Path, description = "Admin ID with the adm_ prefix")),
  responses(
    (status = 200, description = "Admin disabled", body = inline(HttpResponseFormat<Admin>)),
    (status = 403, description = "Only root disables admins, and root is protected", body = crate::http::ErrorBody),
    (status = 404, description = "No such admin", body = crate::http::ErrorBody),
  ),
)]
pub async fn disable(
  State(state): State<AppState>,
  RootIdentity(actor): RootIdentity,
  Path(id): Path<String>,
) -> Result<HttpResponse<Admin>, AdminsError> {
  Ok(HttpResponse::ok(
    service::set_status(&state, &actor, &id, UserStatus::Disabled).await?,
    "ADMIN_DISABLED",
  ))
}

/// Enable an admin
#[utoipa::path(
  post,
  path = crate::constants::api::admins::ENABLE,
  tag = "admins",
  security(("bearerAuth" = [])),
  params(("id" = String, Path, description = "Admin ID with the adm_ prefix")),
  responses(
    (status = 200, description = "Admin enabled", body = inline(HttpResponseFormat<Admin>)),
    (status = 403, description = "Only root enables admins", body = crate::http::ErrorBody),
    (status = 404, description = "No such admin", body = crate::http::ErrorBody),
  ),
)]
pub async fn enable(
  State(state): State<AppState>,
  RootIdentity(actor): RootIdentity,
  Path(id): Path<String>,
) -> Result<HttpResponse<Admin>, AdminsError> {
  Ok(HttpResponse::ok(
    service::set_status(&state, &actor, &id, UserStatus::Active).await?,
    "ADMIN_ENABLED",
  ))
}
