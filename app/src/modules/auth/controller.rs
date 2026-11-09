use super::{error::AuthError, model::*, service};
use crate::{
  http::{HttpResponse, HttpResponseFormat},
  models::{AuthIdentity, User},
  state::AppState,
};
use axum::{Json, extract::State};

/// Sign-in methods
///
/// List the ways users can sign up and in, so your app can draw its
/// sign-in screen.
#[utoipa::path(
  get,
  path = crate::constants::api::auth::METHODS,
  tag = "auth",
  responses(
    (status = 200, description = "Methods fetched", body = inline(HttpResponseFormat<AuthMethods>)),
    (status = 501, description = "Not built yet", body = crate::http::ErrorBody),
  ),
)]
pub async fn methods(
  State(state): State<AppState>
) -> Result<HttpResponse<AuthMethods>, AuthError> {
  Ok(HttpResponse::ok(
    service::methods(&state).await?,
    "AUTH_METHODS_FETCHED",
  ))
}

/// Sign up
///
/// Create a member account with an email and password and sign it in. When
/// settings require a verified email, the account gets a verification
/// message and the tokens only work once it is confirmed.
#[utoipa::path(
  post,
  path = crate::constants::api::auth::SIGNUP,
  tag = "auth",
  security((), ("clientKey" = [])),
  request_body = SignupRequest,
  responses(
    (status = 201, description = "Account created and signed in", body = inline(HttpResponseFormat<AuthTokens>)),
    (status = 400, description = "The email or password was refused", body = crate::http::ErrorBody),
    (status = 403, description = "Sign-up is turned off", body = crate::http::ErrorBody),
    (status = 409, description = "An account with this email exists", body = crate::http::ErrorBody),
    (status = 429, description = "Too many attempts", body = crate::http::ErrorBody),
    (status = 501, description = "Not built yet", body = crate::http::ErrorBody),
  ),
)]
pub async fn signup(
  State(state): State<AppState>,
  Json(request): Json<SignupRequest>,
) -> Result<HttpResponse<AuthTokens>, AuthError> {
  Ok(HttpResponse::created(
    service::signup(&state, None, request).await?,
    "SIGNED_UP",
  ))
}

/// Sign in
///
/// Sign in with an email and password. Repeated failures lock the account
/// for a while.
#[utoipa::path(
  post,
  path = crate::constants::api::auth::LOGIN,
  tag = "auth",
  security((), ("clientKey" = [])),
  request_body = LoginRequest,
  responses(
    (status = 200, description = "Signed in", body = inline(HttpResponseFormat<AuthTokens>)),
    (status = 401, description = "The email or password is wrong", body = crate::http::ErrorBody),
    (status = 403, description = "The account is disabled", body = crate::http::ErrorBody),
    (status = 429, description = "Too many attempts", body = crate::http::ErrorBody),
    (status = 501, description = "Not built yet", body = crate::http::ErrorBody),
  ),
)]
pub async fn login(
  State(state): State<AppState>,
  Json(request): Json<LoginRequest>,
) -> Result<HttpResponse<AuthTokens>, AuthError> {
  Ok(HttpResponse::ok(
    service::login(&state, None, request).await?,
    "SIGNED_IN",
  ))
}

/// Refresh tokens
///
/// Trade a refresh token for a new access token and refresh token. A
/// refresh token works once. Presenting a used one ends the whole session,
/// because it means the token was copied.
#[utoipa::path(
  post,
  path = crate::constants::api::auth::REFRESH,
  tag = "auth",
  request_body = RefreshRequest,
  responses(
    (status = 200, description = "Tokens refreshed", body = inline(HttpResponseFormat<AuthTokens>)),
    (status = 401, description = "The refresh token is invalid, used, or expired", body = crate::http::ErrorBody),
    (status = 501, description = "Not built yet", body = crate::http::ErrorBody),
  ),
)]
pub async fn refresh(
  State(state): State<AppState>,
  Json(request): Json<RefreshRequest>,
) -> Result<HttpResponse<AuthTokens>, AuthError> {
  Ok(HttpResponse::ok(
    service::refresh(&state, request).await?,
    "TOKENS_REFRESHED",
  ))
}

/// Sign out
///
/// End the current session, or every session of the account.
#[utoipa::path(
  post,
  path = crate::constants::api::auth::LOGOUT,
  tag = "auth",
  security(("bearerAuth" = [])),
  request_body = LogoutRequest,
  responses(
    (status = 200, description = "Signed out", body = inline(HttpResponseFormat<serde_json::Value>)),
    (status = 401, description = "Authentication is required", body = crate::http::ErrorBody),
    (status = 501, description = "Not built yet", body = crate::http::ErrorBody),
  ),
)]
pub async fn logout(
  State(state): State<AppState>,
  identity: AuthIdentity,
  Json(request): Json<LogoutRequest>,
) -> Result<HttpResponse<serde_json::Value>, AuthError> {
  service::logout(&state, &identity, request).await?;
  Ok(HttpResponse::done("SIGNED_OUT"))
}

/// Current user
///
/// Return the account the access token belongs to.
#[utoipa::path(
  get,
  path = crate::constants::api::auth::ME,
  tag = "auth",
  security(("bearerAuth" = [])),
  responses(
    (status = 200, description = "Account fetched", body = inline(HttpResponseFormat<User>)),
    (status = 401, description = "Authentication is required", body = crate::http::ErrorBody),
    (status = 501, description = "Not built yet", body = crate::http::ErrorBody),
  ),
)]
pub async fn me(
  State(state): State<AppState>,
  identity: AuthIdentity,
) -> Result<HttpResponse<User>, AuthError> {
  Ok(HttpResponse::ok(
    service::me(&state, &identity).await?,
    "ACCOUNT_FETCHED",
  ))
}

/// Update profile
///
/// Change the display name, avatar, or public metadata of the signed-in
/// account. Changing the email goes through verification instead.
#[utoipa::path(
  patch,
  path = crate::constants::api::auth::ME,
  tag = "auth",
  security(("bearerAuth" = [])),
  request_body = UpdateProfileRequest,
  responses(
    (status = 200, description = "Profile updated", body = inline(HttpResponseFormat<User>)),
    (status = 401, description = "Authentication is required", body = crate::http::ErrorBody),
    (status = 501, description = "Not built yet", body = crate::http::ErrorBody),
  ),
)]
pub async fn update_me(
  State(state): State<AppState>,
  identity: AuthIdentity,
  Json(request): Json<UpdateProfileRequest>,
) -> Result<HttpResponse<User>, AuthError> {
  Ok(HttpResponse::ok(
    service::update_me(&state, &identity, request).await?,
    "PROFILE_UPDATED",
  ))
}

/// Change password
///
/// Set a new password after confirming the current one. Every other
/// session of the account ends.
#[utoipa::path(
  post,
  path = crate::constants::api::auth::PASSWORD_CHANGE,
  tag = "auth",
  security(("bearerAuth" = [])),
  request_body = ChangePasswordRequest,
  responses(
    (status = 200, description = "Password changed", body = inline(HttpResponseFormat<serde_json::Value>)),
    (status = 400, description = "The new password was refused", body = crate::http::ErrorBody),
    (status = 401, description = "Authentication is required, or the current password is wrong", body = crate::http::ErrorBody),
    (status = 501, description = "Not built yet", body = crate::http::ErrorBody),
  ),
)]
pub async fn change_password(
  State(state): State<AppState>,
  identity: AuthIdentity,
  Json(request): Json<ChangePasswordRequest>,
) -> Result<HttpResponse<serde_json::Value>, AuthError> {
  service::change_password(&state, &identity, request).await?;
  Ok(HttpResponse::done("PASSWORD_CHANGED"))
}
