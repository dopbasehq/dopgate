use super::{error::OidcProviderError, model::*, service};
use crate::{models::AuthIdentity, state::AppState};
use axum::{
  Form, Json,
  extract::{Query, State},
  response::Redirect,
};

/// OpenID Connect discovery
///
/// The provider metadata other apps read to sign users in with dopgate.
#[utoipa::path(
  get,
  path = crate::constants::api::oidc_provider::DISCOVERY,
  tag = "oidc",
  responses(
    (status = 200, description = "Provider metadata", body = Object),
    (status = 501, description = "Not built yet", body = crate::http::ErrorBody),
  ),
)]
pub async fn discovery(
  State(state): State<AppState>
) -> Result<Json<serde_json::Value>, OidcProviderError> {
  Ok(Json(service::discovery(&state).await?))
}

/// Authorization endpoint
///
/// Start a sign-in for another app. Redirects back to it with a code.
#[utoipa::path(
  get,
  path = crate::constants::api::oidc_provider::AUTHORIZE,
  tag = "oidc",
  params(AuthorizeQuery),
  responses(
    (status = 302, description = "Redirect to sign-in or back to the app"),
    (status = 501, description = "Not built yet", body = crate::http::ErrorBody),
  ),
)]
pub async fn authorize(
  State(state): State<AppState>,
  Query(query): Query<AuthorizeQuery>,
) -> Result<Redirect, OidcProviderError> {
  Ok(Redirect::to(&service::authorize(&state, query).await?))
}

/// Token endpoint
///
/// Trade an authorization code or refresh token for tokens.
#[utoipa::path(
  post,
  path = crate::constants::api::oidc_provider::TOKEN,
  tag = "oidc",
  request_body(content = TokenRequest, content_type = "application/x-www-form-urlencoded"),
  responses(
    (status = 200, description = "Tokens", body = TokenResponse),
    (status = 400, description = "The grant is invalid", body = crate::http::ErrorBody),
    (status = 501, description = "Not built yet", body = crate::http::ErrorBody),
  ),
)]
pub async fn token(
  State(state): State<AppState>,
  Form(request): Form<TokenRequest>,
) -> Result<Json<TokenResponse>, OidcProviderError> {
  Ok(Json(service::token(&state, request).await?))
}

/// UserInfo endpoint
///
/// Claims about the user an access token belongs to.
#[utoipa::path(
  get,
  path = crate::constants::api::oidc_provider::USERINFO,
  tag = "oidc",
  security(("bearerAuth" = [])),
  responses(
    (status = 200, description = "User claims", body = Object),
    (status = 401, description = "Authentication is required", body = crate::http::ErrorBody),
    (status = 501, description = "Not built yet", body = crate::http::ErrorBody),
  ),
)]
pub async fn userinfo(
  State(state): State<AppState>,
  identity: AuthIdentity,
) -> Result<Json<serde_json::Value>, OidcProviderError> {
  Ok(Json(service::userinfo(&state, &identity).await?))
}
