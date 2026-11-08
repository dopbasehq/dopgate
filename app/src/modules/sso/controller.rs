use super::{error::SsoError, model::*, service};
use crate::{
  extractors::AdminIdentity,
  http::{HttpResponse, HttpResponseFormat},
  modules::auth::model::AuthTokens,
  state::AppState,
};
use axum::{
  Json,
  extract::{Path, Query, State},
  response::Redirect,
};

/// Sign-in providers
///
/// The enabled single sign-on providers, for drawing sign-in buttons.
#[utoipa::path(
  get,
  path = crate::constants::api::sso::PROVIDERS,
  tag = "sso",
  responses(
    (status = 200, description = "Providers fetched", body = inline(HttpResponseFormat<Vec<PublicProvider>>)),
    (status = 501, description = "Not built yet", body = crate::http::ErrorBody),
  ),
)]
pub async fn providers(
  State(state): State<AppState>
) -> Result<HttpResponse<Vec<PublicProvider>>, SsoError> {
  Ok(HttpResponse::ok(
    service::providers(&state).await?,
    "SSO_PROVIDERS_FETCHED",
  ))
}

/// Start a provider sign-in
///
/// Send the browser here. It goes on to the provider and comes back to
/// `redirectUrl` with a handoff code.
#[utoipa::path(
  get,
  path = crate::constants::api::sso::START,
  tag = "sso",
  params(
    ("provider_id" = String, Path, description = "Provider ID with the sso_ prefix"),
    StartQuery
  ),
  responses(
    (status = 302, description = "Redirect to the provider"),
    (status = 400, description = "The redirect URL is not allowed", body = crate::http::ErrorBody),
    (status = 404, description = "No such enabled provider", body = crate::http::ErrorBody),
    (status = 501, description = "Not built yet", body = crate::http::ErrorBody),
  ),
)]
pub async fn start(
  State(state): State<AppState>,
  Path(provider_id): Path<String>,
  Query(query): Query<StartQuery>,
) -> Result<Redirect, SsoError> {
  Ok(Redirect::to(
    &service::start(&state, &provider_id, query).await?,
  ))
}

/// Provider callback
///
/// The provider sends the browser here. Register this URL with the
/// provider. Users never call it directly.
#[utoipa::path(
  get,
  path = crate::constants::api::sso::CALLBACK,
  tag = "sso",
  params(CallbackQuery),
  responses(
    (status = 302, description = "Redirect back to the app with a handoff code"),
    (status = 400, description = "The sign-in failed or expired", body = crate::http::ErrorBody),
    (status = 501, description = "Not built yet", body = crate::http::ErrorBody),
  ),
)]
pub async fn callback(
  State(state): State<AppState>,
  Query(query): Query<CallbackQuery>,
) -> Result<Redirect, SsoError> {
  Ok(Redirect::to(&service::callback(&state, query).await?))
}

/// Finish a provider sign-in
///
/// Trade the handoff code for tokens. A code works once, for a minute.
#[utoipa::path(
  post,
  path = crate::constants::api::sso::EXCHANGE,
  tag = "sso",
  request_body = ExchangeRequest,
  responses(
    (status = 200, description = "Signed in", body = inline(HttpResponseFormat<AuthTokens>)),
    (status = 400, description = "The handoff code is wrong, used, or expired", body = crate::http::ErrorBody),
    (status = 501, description = "Not built yet", body = crate::http::ErrorBody),
  ),
)]
pub async fn exchange(
  State(state): State<AppState>,
  Json(request): Json<ExchangeRequest>,
) -> Result<HttpResponse<AuthTokens>, SsoError> {
  Ok(HttpResponse::ok(
    service::exchange(&state, request).await?,
    "SIGNED_IN",
  ))
}

/// Provider presets
///
/// Templates for common providers, with setup hints.
#[utoipa::path(
  get,
  path = crate::constants::api::sso::ADMIN_PRESETS,
  tag = "sso",
  security(("bearerAuth" = [])),
  responses(
    (status = 200, description = "Presets fetched", body = inline(HttpResponseFormat<Vec<PresetResponse>>)),
    (status = 401, description = "Authentication is required", body = crate::http::ErrorBody),
    (status = 403, description = "Only root and admins may configure SSO", body = crate::http::ErrorBody),
  ),
)]
pub async fn presets(
  AdminIdentity(_actor): AdminIdentity
) -> Result<HttpResponse<Vec<PresetResponse>>, SsoError> {
  Ok(HttpResponse::ok(service::presets(), "SSO_PRESETS_FETCHED"))
}

/// List providers
#[utoipa::path(
  get,
  path = crate::constants::api::sso::ADMIN_PROVIDERS,
  tag = "sso",
  security(("bearerAuth" = [])),
  responses(
    (status = 200, description = "Providers fetched", body = inline(HttpResponseFormat<Vec<ProviderResponse>>)),
    (status = 401, description = "Authentication is required", body = crate::http::ErrorBody),
    (status = 403, description = "Only root and admins may configure SSO", body = crate::http::ErrorBody),
    (status = 501, description = "Not built yet", body = crate::http::ErrorBody),
  ),
)]
pub async fn admin_list(
  State(state): State<AppState>,
  AdminIdentity(_actor): AdminIdentity,
) -> Result<HttpResponse<Vec<ProviderResponse>>, SsoError> {
  Ok(HttpResponse::ok(
    service::admin_list(&state).await?,
    "SSO_PROVIDERS_FETCHED",
  ))
}

/// Show a provider
#[utoipa::path(
  get,
  path = crate::constants::api::sso::ADMIN_PROVIDER,
  tag = "sso",
  security(("bearerAuth" = [])),
  params(("id" = String, Path, description = "Provider ID with the sso_ prefix")),
  responses(
    (status = 200, description = "Provider fetched", body = inline(HttpResponseFormat<ProviderResponse>)),
    (status = 401, description = "Authentication is required", body = crate::http::ErrorBody),
    (status = 403, description = "Only root and admins may configure SSO", body = crate::http::ErrorBody),
    (status = 404, description = "No such provider", body = crate::http::ErrorBody),
    (status = 501, description = "Not built yet", body = crate::http::ErrorBody),
  ),
)]
pub async fn admin_get(
  State(state): State<AppState>,
  AdminIdentity(_actor): AdminIdentity,
  Path(id): Path<String>,
) -> Result<HttpResponse<ProviderResponse>, SsoError> {
  Ok(HttpResponse::ok(
    service::admin_get(&state, &id).await?,
    "SSO_PROVIDER_FETCHED",
  ))
}

/// Add a provider
///
/// The provider starts disabled. Run a test sign-in, then enable it.
#[utoipa::path(
  post,
  path = crate::constants::api::sso::ADMIN_PROVIDERS,
  tag = "sso",
  security(("bearerAuth" = [])),
  request_body = CreateProviderRequest,
  responses(
    (status = 201, description = "Provider added", body = inline(HttpResponseFormat<ProviderResponse>)),
    (status = 400, description = "The issuer could not be discovered, or a field was refused", body = crate::http::ErrorBody),
    (status = 401, description = "Authentication is required", body = crate::http::ErrorBody),
    (status = 403, description = "Only root and admins may configure SSO", body = crate::http::ErrorBody),
    (status = 501, description = "Not built yet", body = crate::http::ErrorBody),
  ),
)]
pub async fn admin_create(
  State(state): State<AppState>,
  AdminIdentity(actor): AdminIdentity,
  Json(request): Json<CreateProviderRequest>,
) -> Result<HttpResponse<ProviderResponse>, SsoError> {
  Ok(HttpResponse::created(
    service::admin_create(&state, &actor, request).await?,
    "SSO_PROVIDER_CREATED",
  ))
}

/// Update a provider
#[utoipa::path(
  patch,
  path = crate::constants::api::sso::ADMIN_PROVIDER,
  tag = "sso",
  security(("bearerAuth" = [])),
  params(("id" = String, Path, description = "Provider ID with the sso_ prefix")),
  request_body = UpdateProviderRequest,
  responses(
    (status = 200, description = "Provider updated", body = inline(HttpResponseFormat<ProviderResponse>)),
    (status = 400, description = "A field was refused, or the provider is not verified", body = crate::http::ErrorBody),
    (status = 401, description = "Authentication is required", body = crate::http::ErrorBody),
    (status = 403, description = "Only root and admins may configure SSO", body = crate::http::ErrorBody),
    (status = 404, description = "No such provider", body = crate::http::ErrorBody),
    (status = 501, description = "Not built yet", body = crate::http::ErrorBody),
  ),
)]
pub async fn admin_update(
  State(state): State<AppState>,
  AdminIdentity(actor): AdminIdentity,
  Path(id): Path<String>,
  Json(request): Json<UpdateProviderRequest>,
) -> Result<HttpResponse<ProviderResponse>, SsoError> {
  Ok(HttpResponse::ok(
    service::admin_update(&state, &actor, &id, request).await?,
    "SSO_PROVIDER_UPDATED",
  ))
}

/// Remove a provider
///
/// Linked identities go with it. Accounts stay and can still sign in any
/// other way they have.
#[utoipa::path(
  delete,
  path = crate::constants::api::sso::ADMIN_PROVIDER,
  tag = "sso",
  security(("bearerAuth" = [])),
  params(("id" = String, Path, description = "Provider ID with the sso_ prefix")),
  responses(
    (status = 200, description = "Provider removed", body = inline(HttpResponseFormat<serde_json::Value>)),
    (status = 401, description = "Authentication is required", body = crate::http::ErrorBody),
    (status = 403, description = "Only root and admins may configure SSO", body = crate::http::ErrorBody),
    (status = 404, description = "No such provider", body = crate::http::ErrorBody),
    (status = 501, description = "Not built yet", body = crate::http::ErrorBody),
  ),
)]
pub async fn admin_delete(
  State(state): State<AppState>,
  AdminIdentity(actor): AdminIdentity,
  Path(id): Path<String>,
) -> Result<HttpResponse<serde_json::Value>, SsoError> {
  service::admin_delete(&state, &actor, &id).await?;
  Ok(HttpResponse::done("SSO_PROVIDER_DELETED"))
}
