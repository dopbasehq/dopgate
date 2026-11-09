use super::{error::AuthError, model::*, service};
use crate::{
  extractors::{AnyUserIdentity, RequestContext, SessionMode, UserIdentity},
  http::{HttpError, HttpResponse, HttpResponseFormat},
  models::{Realm, User},
  modules::sessions,
  state::AppState,
};
use axum::{
  Json,
  extract::State,
  http::StatusCode,
  response::{IntoResponse, Response},
};

/// Sign-in methods
///
/// What your app's sign-in screen should offer, and the app name.
#[utoipa::path(
  get,
  path = crate::constants::api::auth::METHODS,
  tag = "auth",
  responses(
    (status = 200, description = "Methods fetched", body = inline(HttpResponseFormat<AuthMethods>)),
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
/// Create an account with an email and password, and email a 6-digit
/// verification code. When settings require a verified email (the
/// default), `tokens` is null: confirm the code with
/// `/auth/verification/confirm` to sign in.
#[utoipa::path(
  post,
  path = crate::constants::api::auth::SIGNUP,
  tag = "auth",
  request_body = SignupRequest,
  responses(
    (status = 201, description = "Account created", body = inline(HttpResponseFormat<SignupResult>)),
    (status = 403, description = "Sign-up is turned off", body = crate::http::ErrorBody),
    (status = 409, description = "An account with this email exists", body = crate::http::ErrorBody),
    (status = 422, description = "The email, password, or name was refused", body = crate::http::ErrorBody),
    (status = 429, description = "Too many attempts", body = crate::http::ErrorBody),
  ),
)]
pub async fn signup(
  State(state): State<AppState>,
  context: RequestContext,
  Json(request): Json<SignupRequest>,
) -> Result<HttpResponse<SignupResult>, AuthError> {
  Ok(HttpResponse::created(
    service::signup(&state, request, context.user_agent.as_deref()).await?,
    "SIGNED_UP",
  ))
}

/// Sign in
///
/// Sign in with an email and password. After too many wrong passwords the
/// account is locked for a while, and every attempt gets the same answer as
/// a wrong password until the lock ends.
#[utoipa::path(
  post,
  path = crate::constants::api::auth::LOGIN,
  tag = "auth",
  request_body = LoginRequest,
  responses(
    (status = 200, description = "Signed in", body = inline(HttpResponseFormat<AuthTokens>)),
    (status = 401, description = "The email or password is wrong, or the account is locked", body = crate::http::ErrorBody),
    (status = 403, description = "The account is disabled, or its email is not verified", body = crate::http::ErrorBody),
    (status = 429, description = "Too many attempts", body = crate::http::ErrorBody),
  ),
)]
pub async fn login(
  State(state): State<AppState>,
  context: RequestContext,
  Json(request): Json<LoginRequest>,
) -> Result<HttpResponse<AuthTokens>, AuthError> {
  let tokens = service::login(&state, request, context.user_agent.as_deref()).await?;
  sessions::service::deliver(
    &state,
    &context,
    Realm::App,
    tokens,
    "SIGNED_IN",
    StatusCode::OK,
  )
  .await
}

/// Refresh tokens
///
/// Trade a refresh token for a new access token and refresh token. A refresh
/// token works once. Presenting a used one ends the whole session, because
/// it means the token was copied.
#[utoipa::path(
  post,
  path = crate::constants::api::auth::REFRESH,
  tag = "auth",
  request_body = RefreshRequest,
  responses(
    (status = 200, description = "Tokens refreshed", body = inline(HttpResponseFormat<AuthTokens>)),
    (status = 401, description = "The refresh token is invalid, used, or expired", body = crate::http::ErrorBody),
    (status = 403, description = "The account is disabled", body = crate::http::ErrorBody),
  ),
)]
pub async fn refresh(
  State(state): State<AppState>,
  context: RequestContext,
  request: Option<Json<RefreshRequest>>,
) -> Result<HttpResponse<AuthTokens>, AuthError> {
  let request = request.map(|Json(request)| request).unwrap_or_default();
  let token = request
    .refresh_token
    .or_else(|| context.refresh_cookie.clone())
    .ok_or_else(|| {
      HttpError::unauthorized(
        crate::constants::errors::TOKEN_INVALID,
        "Your session has ended. Sign in again.",
      )
    })?;
  let (user, grant) = sessions::service::refresh(&state, Realm::App, &token).await?;
  let tokens = service::app_tokens(&state, &user.id, grant).await?;
  sessions::service::deliver(
    &state,
    &context,
    Realm::App,
    tokens,
    "TOKENS_REFRESHED",
    StatusCode::OK,
  )
  .await
}

/// Sign out
///
/// End the current session, or every session with `allSessions`. Works with
/// an access token, or with only a refresh token once the access token has
/// expired.
#[utoipa::path(
  post,
  path = crate::constants::api::auth::LOGOUT,
  tag = "auth",
  security((), ("bearerAuth" = [])),
  request_body = LogoutRequest,
  responses(
    (status = 200, description = "Signed out", body = inline(HttpResponseFormat<serde_json::Value>)),
    (status = 401, description = "No access token or refresh token was sent", body = crate::http::ErrorBody),
  ),
)]
pub async fn logout(
  State(state): State<AppState>,
  context: RequestContext,
  user: Result<UserIdentity, HttpError>,
  request: Option<Json<LogoutRequest>>,
) -> Result<Response, AuthError> {
  let request = request.map(|Json(request)| request).unwrap_or_default();
  let refresh_token = request
    .refresh_token
    .or_else(|| context.refresh_cookie.clone());
  let current = user
    .as_ref()
    .ok()
    .map(|user| (user.user_id.as_str(), user.session_id.as_str()));
  let result = service::logout(
    &state,
    Realm::App,
    current,
    refresh_token.as_deref(),
    request.all_sessions,
  )
  .await;
  let mut response = match result {
    Ok(()) => HttpResponse::done("SIGNED_OUT").into_response(),
    Err(error) => error.into_response(),
  };
  if context.session_mode == SessionMode::Cookie || context.refresh_cookie.is_some() {
    let (name, value) = sessions::service::clear_cookie(&state, Realm::App);
    response.headers_mut().append(name, value);
  }
  Ok(response)
}

/// Current user
///
/// The account the access token belongs to.
#[utoipa::path(
  get,
  path = crate::constants::api::auth::ME,
  tag = "auth",
  security(("bearerAuth" = [])),
  responses(
    (status = 200, description = "Account fetched", body = inline(HttpResponseFormat<User>)),
    (status = 401, description = "Authentication is required", body = crate::http::ErrorBody),
  ),
)]
pub async fn me(
  State(state): State<AppState>,
  user: AnyUserIdentity,
) -> Result<HttpResponse<User>, AuthError> {
  Ok(HttpResponse::ok(
    service::me(&state, &user.user_id).await?,
    "ACCOUNT_FETCHED",
  ))
}

/// Update profile
///
/// Change the display name, avatar URL, or user metadata of the signed-in
/// account. Changing the email goes through `/auth/email/change`.
#[utoipa::path(
  patch,
  path = crate::constants::api::auth::ME,
  tag = "auth",
  security(("bearerAuth" = [])),
  request_body = UpdateProfileRequest,
  responses(
    (status = 200, description = "Profile updated", body = inline(HttpResponseFormat<User>)),
    (status = 401, description = "Authentication is required", body = crate::http::ErrorBody),
    (status = 422, description = "A value was refused", body = crate::http::ErrorBody),
  ),
)]
pub async fn update_me(
  State(state): State<AppState>,
  user: AnyUserIdentity,
  Json(request): Json<UpdateProfileRequest>,
) -> Result<HttpResponse<User>, AuthError> {
  Ok(HttpResponse::ok(
    service::update_me(&state, &user.user_id, request).await?,
    "PROFILE_UPDATED",
  ))
}

/// Change password
///
/// Set a new password after confirming the current one. Every other session
/// of the account ends, and a notice goes to the account's email.
#[utoipa::path(
  post,
  path = crate::constants::api::auth::PASSWORD_CHANGE,
  tag = "auth",
  security(("bearerAuth" = [])),
  request_body = ChangePasswordRequest,
  responses(
    (status = 200, description = "Password changed", body = inline(HttpResponseFormat<serde_json::Value>)),
    (status = 401, description = "Authentication is required, or the current password is wrong", body = crate::http::ErrorBody),
    (status = 422, description = "The new password was refused", body = crate::http::ErrorBody),
  ),
)]
pub async fn change_password(
  State(state): State<AppState>,
  user: UserIdentity,
  Json(request): Json<ChangePasswordRequest>,
) -> Result<HttpResponse<serde_json::Value>, AuthError> {
  service::change_password(&state, Realm::App, &user.user_id, &user.session_id, request).await?;
  Ok(HttpResponse::done("PASSWORD_CHANGED"))
}

/// Change email
///
/// Email a 6-digit code to the new address. Confirm it with
/// `/auth/verification/confirm` (purpose `email_change`, the new address as
/// `email`) to move the account. A notice then goes to the old address.
#[utoipa::path(
  post,
  path = crate::constants::api::auth::EMAIL_CHANGE,
  tag = "auth",
  security(("bearerAuth" = [])),
  request_body = ChangeEmailRequest,
  responses(
    (status = 200, description = "Code sent to the new address", body = inline(HttpResponseFormat<serde_json::Value>)),
    (status = 401, description = "Authentication is required, or the password is wrong", body = crate::http::ErrorBody),
    (status = 409, description = "Another account uses the new email", body = crate::http::ErrorBody),
    (status = 422, description = "The new email was refused", body = crate::http::ErrorBody),
    (status = 429, description = "Too many codes", body = crate::http::ErrorBody),
  ),
)]
pub async fn change_email(
  State(state): State<AppState>,
  user: UserIdentity,
  Json(request): Json<ChangeEmailRequest>,
) -> Result<HttpResponse<serde_json::Value>, AuthError> {
  service::change_email(&state, Realm::App, &user.user_id, request).await?;
  Ok(HttpResponse::done("EMAIL_CHANGE_CODE_SENT"))
}
