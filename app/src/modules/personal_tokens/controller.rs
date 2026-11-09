use super::{error::PersonalTokensError, model::*, service};
use crate::{
  extractors::{AdminIdentity, ConsoleIdentity, UserIdentity},
  http::{HttpResponse, HttpResponseFormat},
  state::AppState,
};
use axum::{
  Json,
  extract::{Path, State},
};

/// List your personal tokens
///
/// Newest first. Tokens themselves are never shown again; each has its last
/// four characters. Needs a password or code sign-in.
#[utoipa::path(
  get,
  path = crate::constants::api::personal_tokens::COLLECTION,
  tag = "personal-tokens",
  security(("bearerAuth" = [])),
  responses(
    (status = 200, description = "Tokens fetched", body = inline(HttpResponseFormat<PersonalTokenList>)),
    (status = 401, description = "Authentication is required", body = crate::http::ErrorBody),
    (status = 403, description = "Signed in with a personal token, or not a user", body = crate::http::ErrorBody),
  ),
)]
pub async fn list(
  State(state): State<AppState>,
  user: UserIdentity,
) -> Result<HttpResponse<PersonalTokenList>, PersonalTokensError> {
  Ok(HttpResponse::ok(
    service::list_own(&state, &user).await?,
    "PERSONAL_TOKENS_FETCHED",
  ))
}

/// Create a personal token
///
/// A token that signs in as you, for a script or another system. Trade it
/// at `/auth/token` for an access token. The token is in this answer only.
/// Needs a password or code sign-in, and `selfService.personalTokens` on.
#[utoipa::path(
  post,
  path = crate::constants::api::personal_tokens::COLLECTION,
  tag = "personal-tokens",
  security(("bearerAuth" = [])),
  request_body = CreatePersonalTokenRequest,
  responses(
    (status = 201, description = "Token created", body = inline(HttpResponseFormat<CreatedPersonalToken>)),
    (status = 401, description = "Authentication is required", body = crate::http::ErrorBody),
    (status = 403, description = "Personal tokens are off, or signed in with a personal token", body = crate::http::ErrorBody),
    (status = 409, description = "The name is taken, or the limit is reached", body = crate::http::ErrorBody),
    (status = 422, description = "The name or expiry was refused", body = crate::http::ErrorBody),
  ),
)]
pub async fn create(
  State(state): State<AppState>,
  user: UserIdentity,
  Json(request): Json<CreatePersonalTokenRequest>,
) -> Result<HttpResponse<CreatedPersonalToken>, PersonalTokensError> {
  Ok(HttpResponse::created(
    service::create(&state, &user, request).await?,
    "PERSONAL_TOKEN_CREATED",
  ))
}

/// Delete a personal token
///
/// The token stops signing in at once. Access tokens it already got stay
/// valid on backends that verify offline until they expire.
#[utoipa::path(
  delete,
  path = crate::constants::api::personal_tokens::ITEM,
  tag = "personal-tokens",
  security(("bearerAuth" = [])),
  params(("id" = String, Path, description = "Token ID with the pat_ prefix")),
  responses(
    (status = 200, description = "Token deleted", body = inline(HttpResponseFormat<serde_json::Value>)),
    (status = 401, description = "Authentication is required", body = crate::http::ErrorBody),
    (status = 404, description = "No such token of yours", body = crate::http::ErrorBody),
  ),
)]
pub async fn delete(
  State(state): State<AppState>,
  user: UserIdentity,
  Path(id): Path<String>,
) -> Result<HttpResponse<serde_json::Value>, PersonalTokensError> {
  service::delete_own(&state, &user, &id).await?;
  Ok(HttpResponse::done("PERSONAL_TOKEN_DELETED"))
}

/// List a user's personal tokens
///
/// For admins and the service key. Never includes a token.
#[utoipa::path(
  get,
  path = crate::constants::api::personal_tokens::ADMIN_COLLECTION,
  tag = "personal-tokens",
  security(("bearerAuth" = [])),
  params(("id" = String, Path, description = "User ID with the usr_ prefix")),
  responses(
    (status = 200, description = "Tokens fetched", body = inline(HttpResponseFormat<PersonalTokenList>)),
    (status = 404, description = "No such user", body = crate::http::ErrorBody),
  ),
)]
pub async fn admin_list(
  State(state): State<AppState>,
  AdminIdentity(_actor): AdminIdentity,
  Path(id): Path<String>,
) -> Result<HttpResponse<PersonalTokenList>, PersonalTokensError> {
  Ok(HttpResponse::ok(
    service::list_for_user(&state, &id).await?,
    "PERSONAL_TOKENS_FETCHED",
  ))
}

/// Revoke a user's personal token
///
/// For admins signed in to the console. The service key can't.
#[utoipa::path(
  delete,
  path = crate::constants::api::personal_tokens::ADMIN_ITEM,
  tag = "personal-tokens",
  security(("bearerAuth" = [])),
  params(
    ("id" = String, Path, description = "User ID with the usr_ prefix"),
    ("token_id" = String, Path, description = "Token ID with the pat_ prefix"),
  ),
  responses(
    (status = 200, description = "Token revoked", body = inline(HttpResponseFormat<serde_json::Value>)),
    (status = 403, description = "Only admins in the console", body = crate::http::ErrorBody),
    (status = 404, description = "No such user or token", body = crate::http::ErrorBody),
  ),
)]
pub async fn admin_revoke(
  State(state): State<AppState>,
  admin: ConsoleIdentity,
  Path((id, token_id)): Path<(String, String)>,
) -> Result<HttpResponse<serde_json::Value>, PersonalTokensError> {
  service::revoke_for_user(&state, &admin.identity(), &id, &token_id).await?;
  Ok(HttpResponse::done("PERSONAL_TOKEN_DELETED"))
}
