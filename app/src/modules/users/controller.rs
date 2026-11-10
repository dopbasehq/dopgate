use super::{error::UsersError, model::*, service};
use crate::{
  extractors::AdminIdentity,
  http::{HttpResponse, HttpResponseFormat},
  models::UserStatus,
  modules::sessions::model::SessionResponse,
  state::AppState,
};
use axum::{
  Json,
  extract::{Path, Query, State},
  http::StatusCode,
  response::{IntoResponse, Response},
};

/// List users
///
/// Search and page through accounts, newest first. `search` matches the
/// email or display name.
#[utoipa::path(
  get,
  path = crate::constants::api::users::COLLECTION,
  tag = "users",
  security(("bearerAuth" = [])),
  params(UserQuery),
  responses(
    (status = 200, description = "Users fetched", body = inline(HttpResponseFormat<UserPage>)),
    (status = 401, description = "Authentication is required", body = crate::http::ErrorBody),
    (status = 403, description = "Only root, admins, and the service key", body = crate::http::ErrorBody),
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
    (status = 404, description = "No such user", body = crate::http::ErrorBody),
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
/// Create an account without sending any email. Leave out `password` for an
/// account that signs in with emailed codes. Admins are added at
/// `/admin/admins`.
#[utoipa::path(
  post,
  path = crate::constants::api::users::COLLECTION,
  tag = "users",
  security(("bearerAuth" = [])),
  request_body = CreateUserRequest,
  responses(
    (status = 201, description = "User created", body = inline(HttpResponseFormat<AdminUser>)),
    (status = 409, description = "The email is taken", body = crate::http::ErrorBody),
    (status = 422, description = "A value was refused", body = crate::http::ErrorBody),
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
/// Change the profile, metadata, or verified flag.
#[utoipa::path(
  patch,
  path = crate::constants::api::users::ITEM,
  tag = "users",
  security(("bearerAuth" = [])),
  params(("id" = String, Path, description = "User ID with the usr_ prefix")),
  request_body = UpdateUserRequest,
  responses(
    (status = 200, description = "User updated", body = inline(HttpResponseFormat<AdminUser>)),
    (status = 403, description = "Only admins and the service key", body = crate::http::ErrorBody),
    (status = 404, description = "No such user", body = crate::http::ErrorBody),
    (status = 422, description = "A value was refused", body = crate::http::ErrorBody),
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
/// Remove the account, its sessions, and its codes. The audit log keeps a
/// `user.deleted` event. The email can sign up again as a new account.
#[utoipa::path(
  delete,
  path = crate::constants::api::users::ITEM,
  tag = "users",
  security(("bearerAuth" = [])),
  params(("id" = String, Path, description = "User ID with the usr_ prefix")),
  responses(
    (status = 204, description = "User deleted"),
    (status = 403, description = "Only admins and the service key", body = crate::http::ErrorBody),
    (status = 404, description = "No such user", body = crate::http::ErrorBody),
  ),
)]
pub async fn delete(
  State(state): State<AppState>,
  AdminIdentity(actor): AdminIdentity,
  Path(id): Path<String>,
) -> Result<Response, UsersError> {
  service::delete(&state, &actor, &id).await?;
  Ok(StatusCode::NO_CONTENT.into_response())
}

/// Disable a user
///
/// Refuse new sign-ins and end every session.
#[utoipa::path(
  post,
  path = crate::constants::api::users::DISABLE,
  tag = "users",
  security(("bearerAuth" = [])),
  params(("id" = String, Path, description = "User ID with the usr_ prefix")),
  responses(
    (status = 200, description = "User disabled", body = inline(HttpResponseFormat<AdminUser>)),
    (status = 403, description = "Only admins and the service key", body = crate::http::ErrorBody),
    (status = 404, description = "No such user", body = crate::http::ErrorBody),
  ),
)]
pub async fn disable(
  State(state): State<AppState>,
  AdminIdentity(actor): AdminIdentity,
  Path(id): Path<String>,
) -> Result<HttpResponse<AdminUser>, UsersError> {
  Ok(HttpResponse::ok(
    service::set_status(&state, &actor, &id, UserStatus::Disabled).await?,
    "USER_DISABLED",
  ))
}

/// Enable a user
#[utoipa::path(
  post,
  path = crate::constants::api::users::ENABLE,
  tag = "users",
  security(("bearerAuth" = [])),
  params(("id" = String, Path, description = "User ID with the usr_ prefix")),
  responses(
    (status = 200, description = "User enabled", body = inline(HttpResponseFormat<AdminUser>)),
    (status = 403, description = "Only admins and the service key", body = crate::http::ErrorBody),
    (status = 404, description = "No such user", body = crate::http::ErrorBody),
  ),
)]
pub async fn enable(
  State(state): State<AppState>,
  AdminIdentity(actor): AdminIdentity,
  Path(id): Path<String>,
) -> Result<HttpResponse<AdminUser>, UsersError> {
  Ok(HttpResponse::ok(
    service::set_status(&state, &actor, &id, UserStatus::Active).await?,
    "USER_ENABLED",
  ))
}

/// Send a password reset code
///
/// Email the user a 6-digit code they can reset their password with.
#[utoipa::path(
  post,
  path = crate::constants::api::users::PASSWORD_RESET,
  tag = "users",
  security(("bearerAuth" = [])),
  params(("id" = String, Path, description = "User ID with the usr_ prefix")),
  responses(
    (status = 200, description = "Code sent", body = inline(HttpResponseFormat<serde_json::Value>)),
    (status = 403, description = "Only admins and the service key", body = crate::http::ErrorBody),
    (status = 404, description = "No such user", body = crate::http::ErrorBody),
  ),
)]
pub async fn password_reset(
  State(state): State<AppState>,
  AdminIdentity(actor): AdminIdentity,
  Path(id): Path<String>,
) -> Result<HttpResponse<serde_json::Value>, UsersError> {
  service::send_password_reset(&state, &actor, &id).await?;
  Ok(HttpResponse::done("PASSWORD_RESET_SENT"))
}

/// List a user's sessions
#[utoipa::path(
  get,
  path = crate::constants::api::users::SESSIONS,
  tag = "users",
  security(("bearerAuth" = [])),
  params(("id" = String, Path, description = "User ID with the usr_ prefix")),
  responses(
    (status = 200, description = "Sessions fetched", body = inline(HttpResponseFormat<Vec<SessionResponse>>)),
    (status = 404, description = "No such user", body = crate::http::ErrorBody),
  ),
)]
pub async fn sessions(
  State(state): State<AppState>,
  AdminIdentity(_actor): AdminIdentity,
  Path(id): Path<String>,
) -> Result<HttpResponse<Vec<SessionResponse>>, UsersError> {
  Ok(HttpResponse::ok(
    service::sessions(&state, &id).await?,
    "SESSIONS_FETCHED",
  ))
}

/// Sign a user out everywhere
///
/// End every session of the account. Dopgate refuses their access tokens at
/// once; backends that verify offline accept them until they expire.
#[utoipa::path(
  delete,
  path = crate::constants::api::users::SESSIONS,
  tag = "users",
  security(("bearerAuth" = [])),
  params(("id" = String, Path, description = "User ID with the usr_ prefix")),
  responses(
    (status = 200, description = "Sessions ended", body = inline(HttpResponseFormat<serde_json::Value>)),
    (status = 403, description = "Only admins and the service key", body = crate::http::ErrorBody),
    (status = 404, description = "No such user", body = crate::http::ErrorBody),
  ),
)]
pub async fn revoke_sessions(
  State(state): State<AppState>,
  AdminIdentity(actor): AdminIdentity,
  Path(id): Path<String>,
) -> Result<HttpResponse<serde_json::Value>, UsersError> {
  service::revoke_sessions(&state, &actor, &id).await?;
  Ok(HttpResponse::done("SESSIONS_REVOKED"))
}
