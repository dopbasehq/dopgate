use super::{error::UsersError, model::*, service};
use crate::{
  extractors::AdminIdentity,
  http::{HttpResponse, HttpResponseFormat},
  state::AppState,
};
use axum::{
  Json,
  extract::{Path, Query, State},
};

/// List users
///
/// Search and page through accounts, newest first.
#[utoipa::path(
  get,
  path = crate::constants::api::users::COLLECTION,
  tag = "users",
  security(("bearerAuth" = [])),
  params(UserQuery),
  responses(
    (status = 200, description = "Users fetched", body = inline(HttpResponseFormat<UserPage>)),
    (status = 401, description = "Authentication is required", body = crate::http::ErrorBody),
    (status = 403, description = "Only root, admins, and client secret keys may manage users", body = crate::http::ErrorBody),
    (status = 501, description = "Not built yet", body = crate::http::ErrorBody),
  ),
)]
pub async fn list(
  State(state): State<AppState>,
  AdminIdentity(_actor): AdminIdentity,
  Query(query): Query<UserQuery>,
) -> Result<HttpResponse<UserPage>, UsersError> {
  Ok(HttpResponse::ok(
    service::list(&state, query).await?,
    "USERS_FETCHED",
  ))
}

/// Show a user
#[utoipa::path(
  get,
  path = crate::constants::api::users::ITEM,
  tag = "users",
  security(("bearerAuth" = [])),
  params(("id" = String, Path, description = "User ID with the usr_ prefix")),
  responses(
    (status = 200, description = "User fetched", body = inline(HttpResponseFormat<AdminUser>)),
    (status = 401, description = "Authentication is required", body = crate::http::ErrorBody),
    (status = 403, description = "Only root, admins, and client secret keys may manage users", body = crate::http::ErrorBody),
    (status = 404, description = "No such user", body = crate::http::ErrorBody),
    (status = 501, description = "Not built yet", body = crate::http::ErrorBody),
  ),
)]
pub async fn get(
  State(state): State<AppState>,
  AdminIdentity(_actor): AdminIdentity,
  Path(id): Path<String>,
) -> Result<HttpResponse<AdminUser>, UsersError> {
  Ok(HttpResponse::ok(
    service::get(&state, &id).await?,
    "USER_FETCHED",
  ))
}

/// Create a user
///
/// Create an admin or member account. Root cannot be created here.
#[utoipa::path(
  post,
  path = crate::constants::api::users::COLLECTION,
  tag = "users",
  security(("bearerAuth" = [])),
  request_body = CreateUserRequest,
  responses(
    (status = 201, description = "User created", body = inline(HttpResponseFormat<AdminUser>)),
    (status = 400, description = "The email, password, or role was refused", body = crate::http::ErrorBody),
    (status = 401, description = "Authentication is required", body = crate::http::ErrorBody),
    (status = 403, description = "Only root, admins, and client secret keys may manage users", body = crate::http::ErrorBody),
    (status = 409, description = "An account with this email exists", body = crate::http::ErrorBody),
    (status = 501, description = "Not built yet", body = crate::http::ErrorBody),
  ),
)]
pub async fn create(
  State(state): State<AppState>,
  AdminIdentity(actor): AdminIdentity,
  Json(request): Json<CreateUserRequest>,
) -> Result<HttpResponse<AdminUser>, UsersError> {
  Ok(HttpResponse::created(
    service::create(&state, &actor, request).await?,
    "USER_CREATED",
  ))
}

/// Update a user
///
/// Change any field, including role and status. Disabling an account ends
/// its sessions. Nobody can change root here.
#[utoipa::path(
  patch,
  path = crate::constants::api::users::ITEM,
  tag = "users",
  security(("bearerAuth" = [])),
  params(("id" = String, Path, description = "User ID with the usr_ prefix")),
  request_body = UpdateUserRequest,
  responses(
    (status = 200, description = "User updated", body = inline(HttpResponseFormat<AdminUser>)),
    (status = 400, description = "A field was refused", body = crate::http::ErrorBody),
    (status = 401, description = "Authentication is required", body = crate::http::ErrorBody),
    (status = 403, description = "You may not change this account", body = crate::http::ErrorBody),
    (status = 404, description = "No such user", body = crate::http::ErrorBody),
    (status = 501, description = "Not built yet", body = crate::http::ErrorBody),
  ),
)]
pub async fn update(
  State(state): State<AppState>,
  AdminIdentity(actor): AdminIdentity,
  Path(id): Path<String>,
  Json(request): Json<UpdateUserRequest>,
) -> Result<HttpResponse<AdminUser>, UsersError> {
  Ok(HttpResponse::ok(
    service::update(&state, &actor, &id, request).await?,
    "USER_UPDATED",
  ))
}

/// Delete a user
///
/// Delete the account with its sessions and linked identities. Root cannot
/// be deleted.
#[utoipa::path(
  delete,
  path = crate::constants::api::users::ITEM,
  tag = "users",
  security(("bearerAuth" = [])),
  params(("id" = String, Path, description = "User ID with the usr_ prefix")),
  responses(
    (status = 200, description = "User deleted", body = inline(HttpResponseFormat<serde_json::Value>)),
    (status = 401, description = "Authentication is required", body = crate::http::ErrorBody),
    (status = 403, description = "You may not delete this account", body = crate::http::ErrorBody),
    (status = 404, description = "No such user", body = crate::http::ErrorBody),
    (status = 501, description = "Not built yet", body = crate::http::ErrorBody),
  ),
)]
pub async fn delete(
  State(state): State<AppState>,
  AdminIdentity(actor): AdminIdentity,
  Path(id): Path<String>,
) -> Result<HttpResponse<serde_json::Value>, UsersError> {
  service::delete(&state, &actor, &id).await?;
  Ok(HttpResponse::done("USER_DELETED"))
}

/// Sign a user out everywhere
///
/// End every session of the account.
#[utoipa::path(
  delete,
  path = crate::constants::api::users::SESSIONS,
  tag = "users",
  security(("bearerAuth" = [])),
  params(("id" = String, Path, description = "User ID with the usr_ prefix")),
  responses(
    (status = 200, description = "Sessions ended", body = inline(HttpResponseFormat<serde_json::Value>)),
    (status = 401, description = "Authentication is required", body = crate::http::ErrorBody),
    (status = 403, description = "You may not change this account", body = crate::http::ErrorBody),
    (status = 404, description = "No such user", body = crate::http::ErrorBody),
    (status = 501, description = "Not built yet", body = crate::http::ErrorBody),
  ),
)]
pub async fn revoke_sessions(
  State(state): State<AppState>,
  AdminIdentity(actor): AdminIdentity,
  Path(id): Path<String>,
) -> Result<HttpResponse<serde_json::Value>, UsersError> {
  service::revoke_sessions(&state, &actor, &id).await?;
  Ok(HttpResponse::done("USER_SESSIONS_REVOKED"))
}
