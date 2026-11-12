use super::{error::ConsoleError, model::*, service};
use crate::{
  constants::errors::TOKEN_INVALID,
  extractors::{ConsoleIdentity, RequestContext, SessionMode},
  http::{HttpError, HttpResponse, HttpResponseFormat},
  models::{Admin, Realm},
  modules::{
    audit,
    auth::{
      self,
      model::{
        ChangeEmailRequest, ChangePasswordRequest, LoginRequest, LogoutRequest, RefreshRequest,
      },
    },
    recovery::{
      self,
      model::{ForgotPasswordRequest, ResetPasswordRequest},
    },
    sessions::{
      self,
      model::{RevokeAllQuery, SessionResponse},
    },
  },
  state::AppState,
};
use axum::{
  Json,
  extract::{Path, Query, State},
  http::StatusCode,
  response::{IntoResponse, Response},
};

/// Console sign-in
///
/// Sign an admin in to the console with an email and password. App users
/// get the same answer as a wrong password.
#[utoipa::path(
  post,
  path = crate::constants::api::console::LOGIN,
  tag = "console",
  request_body = LoginRequest,
  responses(
    (status = 200, description = "Signed in", body = inline(HttpResponseFormat<ConsoleTokens>)),
    (status = 401, description = "The email or password is wrong, or the account is locked", body = crate::http::ErrorBody),
    (status = 403, description = "The account is disabled", body = crate::http::ErrorBody),
    (status = 429, description = "Too many attempts", body = crate::http::ErrorBody),
  ),
)]
pub async fn login(
  State(state): State<AppState>,
  context: RequestContext,
  Json(request): Json<LoginRequest>,
) -> Result<HttpResponse<ConsoleTokens>, ConsoleError> {
  let tokens = service::login(&state, request, context.user_agent.as_deref()).await?;
  sessions::service::deliver(
    &state,
    &context,
    Realm::Console,
    tokens,
    "SIGNED_IN",
    StatusCode::OK,
  )
  .await
}

/// Refresh console tokens
///
/// Trade the console's refresh token (its cookie, or `refreshToken`) for new
/// tokens. Presenting a used one ends the session.
#[utoipa::path(
  post,
  path = crate::constants::api::console::REFRESH,
  tag = "console",
  request_body = RefreshRequest,
  responses(
    (status = 200, description = "Tokens refreshed", body = inline(HttpResponseFormat<ConsoleTokens>)),
    (status = 401, description = "The refresh token is invalid, used, or expired", body = crate::http::ErrorBody),
    (status = 403, description = "The account is disabled", body = crate::http::ErrorBody),
  ),
)]
pub async fn refresh(
  State(state): State<AppState>,
  context: RequestContext,
  request: Option<Json<RefreshRequest>>,
) -> Result<HttpResponse<ConsoleTokens>, ConsoleError> {
  let request = request.map(|Json(request)| request).unwrap_or_default();
  let token = request
    .refresh_token
    .or_else(|| context.console_refresh_cookie.clone())
    .ok_or_else(|| {
      HttpError::unauthorized(TOKEN_INVALID, "Your session has ended. Sign in again.")
    })?;
  let (admin, grant) = sessions::service::refresh(&state, Realm::Console, &token).await?;
  let tokens = service::console_tokens(&state, &admin.id, grant).await?;
  sessions::service::deliver(
    &state,
    &context,
    Realm::Console,
    tokens,
    "TOKENS_REFRESHED",
    StatusCode::OK,
  )
  .await
}

/// Console sign-out
///
/// End the current console session, or every one with `allSessions`.
/// Works with only the refresh cookie once the access token has expired.
#[utoipa::path(
  post,
  path = crate::constants::api::console::LOGOUT,
  tag = "console",
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
  admin: Result<ConsoleIdentity, HttpError>,
  request: Option<Json<LogoutRequest>>,
) -> Result<Response, ConsoleError> {
  let request = request.map(|Json(request)| request).unwrap_or_default();
  let refresh_token = request
    .refresh_token
    .or_else(|| context.console_refresh_cookie.clone());
  let current = admin
    .as_ref()
    .ok()
    .map(|admin| (admin.admin_id.as_str(), admin.session_id.as_str()));
  let result = auth::service::logout(
    &state,
    Realm::Console,
    current,
    refresh_token.as_deref(),
    request.all_sessions,
  )
  .await;
  let mut response = match result {
    Ok(()) => HttpResponse::done("SIGNED_OUT").into_response(),
    Err(error) => error.into_response(),
  };
  if context.session_mode == SessionMode::Cookie || context.console_refresh_cookie.is_some() {
    let (name, value) = sessions::service::clear_cookie(&state, Realm::Console);
    response.headers_mut().append(name, value);
  }
  Ok(response)
}

/// Send a console sign-in code
///
/// Email a 6-digit sign-in code to an admin. The answer is the same whether
/// or not an admin uses the email.
#[utoipa::path(
  post,
  path = crate::constants::api::console::CODES_SEND,
  tag = "console",
  request_body = ConsoleSendCodeRequest,
  responses(
    (status = 200, description = "A code was sent if an admin uses the email", body = inline(HttpResponseFormat<serde_json::Value>)),
    (status = 422, description = "The email was refused", body = crate::http::ErrorBody),
    (status = 429, description = "Too many codes; see Retry-After", body = crate::http::ErrorBody),
  ),
)]
pub async fn send_code(
  State(state): State<AppState>,
  Json(request): Json<ConsoleSendCodeRequest>,
) -> Result<HttpResponse<serde_json::Value>, ConsoleError> {
  service::send_code(&state, request).await?;
  Ok(HttpResponse::done("CODE_SENT"))
}

/// Confirm a console code
///
/// `login` signs the admin in. `email_change` moves the account to the new
/// address (pass it as `email`) and returns the admin.
#[utoipa::path(
  post,
  path = crate::constants::api::console::CODES_CONFIRM,
  tag = "console",
  request_body = ConsoleConfirmCodeRequest,
  responses(
    (status = 200, description = "Confirmed. Tokens for login, the admin for email_change", body = inline(HttpResponseFormat<ConsoleTokens>)),
    (status = 400, description = "The code is wrong, used up, or expired", body = crate::http::ErrorBody),
    (status = 403, description = "The account is disabled", body = crate::http::ErrorBody),
    (status = 409, description = "The new email is taken", body = crate::http::ErrorBody),
    (status = 429, description = "Too many attempts", body = crate::http::ErrorBody),
  ),
)]
pub async fn confirm_code(
  State(state): State<AppState>,
  context: RequestContext,
  Json(request): Json<ConsoleConfirmCodeRequest>,
) -> Result<Response, ConsoleError> {
  match service::confirm_code(&state, request, context.user_agent.as_deref()).await? {
    service::Confirmed::SignedIn(tokens) => Ok(
      sessions::service::deliver(
        &state,
        &context,
        Realm::Console,
        tokens,
        "SIGNED_IN",
        StatusCode::OK,
      )
      .await?
      .into_response(),
    ),
    service::Confirmed::EmailChanged(admin) => {
      Ok(HttpResponse::ok(admin, "EMAIL_CHANGED").into_response())
    }
  }
}

/// Console forgot password
///
/// Email a 6-digit reset code to an admin. The answer is the same whether or
/// not an admin uses the email.
#[utoipa::path(
  post,
  path = crate::constants::api::console::PASSWORD_FORGOT,
  tag = "console",
  request_body = ForgotPasswordRequest,
  responses(
    (status = 200, description = "If an admin uses this email, a code is on its way", body = inline(HttpResponseFormat<serde_json::Value>)),
    (status = 422, description = "The email is not valid", body = crate::http::ErrorBody),
    (status = 429, description = "Too many requests", body = crate::http::ErrorBody),
  ),
)]
pub async fn forgot_password(
  State(state): State<AppState>,
  Json(request): Json<ForgotPasswordRequest>,
) -> Result<HttpResponse<serde_json::Value>, ConsoleError> {
  recovery::service::forgot(&state, Realm::Console, request).await?;
  Ok(HttpResponse::done("PASSWORD_RESET_SENT"))
}

/// Console reset password
///
/// Set a new admin password with the emailed code. Every console session of
/// the account ends.
#[utoipa::path(
  post,
  path = crate::constants::api::console::PASSWORD_RESET,
  tag = "console",
  request_body = ResetPasswordRequest,
  responses(
    (status = 200, description = "Password changed", body = inline(HttpResponseFormat<serde_json::Value>)),
    (status = 400, description = "The code is wrong, used up, or expired", body = crate::http::ErrorBody),
    (status = 422, description = "The new password was refused", body = crate::http::ErrorBody),
    (status = 429, description = "Too many attempts", body = crate::http::ErrorBody),
  ),
)]
pub async fn reset_password(
  State(state): State<AppState>,
  Json(request): Json<ResetPasswordRequest>,
) -> Result<HttpResponse<serde_json::Value>, ConsoleError> {
  recovery::service::reset(&state, Realm::Console, request).await?;
  Ok(HttpResponse::done("PASSWORD_RESET"))
}

/// Change the console password
///
/// Set a new password after confirming the current one. Every other console
/// session ends, and a notice goes to the admin's email.
#[utoipa::path(
  post,
  path = crate::constants::api::console::PASSWORD_CHANGE,
  tag = "console",
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
  admin: ConsoleIdentity,
  Json(request): Json<ChangePasswordRequest>,
) -> Result<HttpResponse<serde_json::Value>, ConsoleError> {
  auth::service::change_password(
    &state,
    Realm::Console,
    &admin.admin_id,
    &admin.session_id,
    request,
  )
  .await?;
  Ok(HttpResponse::done("PASSWORD_CHANGED"))
}

/// Current admin
///
/// The admin the console token belongs to.
#[utoipa::path(
  get,
  path = crate::constants::api::console::ME,
  tag = "console",
  security(("bearerAuth" = [])),
  responses(
    (status = 200, description = "Account fetched", body = inline(HttpResponseFormat<Admin>)),
    (status = 401, description = "Authentication is required", body = crate::http::ErrorBody),
  ),
)]
pub async fn me(
  State(state): State<AppState>,
  admin: ConsoleIdentity,
) -> Result<HttpResponse<Admin>, ConsoleError> {
  Ok(HttpResponse::ok(
    service::me(&state, &admin).await?,
    "ACCOUNT_FETCHED",
  ))
}

/// Update the admin's profile
#[utoipa::path(
  patch,
  path = crate::constants::api::console::ME,
  tag = "console",
  security(("bearerAuth" = [])),
  request_body = UpdateConsoleProfileRequest,
  responses(
    (status = 200, description = "Profile updated", body = inline(HttpResponseFormat<Admin>)),
    (status = 401, description = "Authentication is required", body = crate::http::ErrorBody),
    (status = 422, description = "A value was refused", body = crate::http::ErrorBody),
  ),
)]
pub async fn update_me(
  State(state): State<AppState>,
  admin: ConsoleIdentity,
  Json(request): Json<UpdateConsoleProfileRequest>,
) -> Result<HttpResponse<Admin>, ConsoleError> {
  Ok(HttpResponse::ok(
    service::update_me(&state, &admin, request).await?,
    "PROFILE_UPDATED",
  ))
}

/// Change the admin's email
///
/// Email a code to the new address. Confirm it at `/console/codes/confirm`
/// with purpose `email_change`.
#[utoipa::path(
  post,
  path = crate::constants::api::console::EMAIL_CHANGE,
  tag = "console",
  security(("bearerAuth" = [])),
  request_body = ChangeEmailRequest,
  responses(
    (status = 200, description = "Code sent to the new address", body = inline(HttpResponseFormat<serde_json::Value>)),
    (status = 401, description = "Authentication is required, or the password is wrong", body = crate::http::ErrorBody),
    (status = 409, description = "Another admin uses the new email", body = crate::http::ErrorBody),
    (status = 422, description = "The new email was refused", body = crate::http::ErrorBody),
    (status = 429, description = "Too many codes", body = crate::http::ErrorBody),
  ),
)]
pub async fn change_email(
  State(state): State<AppState>,
  admin: ConsoleIdentity,
  Json(request): Json<ChangeEmailRequest>,
) -> Result<HttpResponse<serde_json::Value>, ConsoleError> {
  auth::service::change_email(&state, Realm::Console, &admin.admin_id, request).await?;
  Ok(HttpResponse::done("EMAIL_CHANGE_CODE_SENT"))
}

/// List console sessions
#[utoipa::path(
  get,
  path = crate::constants::api::console::SESSIONS,
  tag = "console",
  security(("bearerAuth" = [])),
  responses(
    (status = 200, description = "Sessions fetched", body = inline(HttpResponseFormat<Vec<SessionResponse>>)),
    (status = 401, description = "Authentication is required", body = crate::http::ErrorBody),
  ),
)]
pub async fn sessions(
  State(state): State<AppState>,
  admin: ConsoleIdentity,
) -> Result<HttpResponse<Vec<SessionResponse>>, ConsoleError> {
  Ok(HttpResponse::ok(
    sessions::service::list(
      &state,
      Realm::Console,
      &admin.admin_id,
      Some(&admin.session_id),
    )
    .await?,
    "SESSIONS_FETCHED",
  ))
}

/// Sign out a console device
#[utoipa::path(
  delete,
  path = crate::constants::api::console::SESSION,
  tag = "console",
  security(("bearerAuth" = [])),
  params(("id" = String, Path, description = "Session ID with the ses_ prefix")),
  responses(
    (status = 200, description = "Session ended", body = inline(HttpResponseFormat<serde_json::Value>)),
    (status = 401, description = "Authentication is required", body = crate::http::ErrorBody),
    (status = 404, description = "No such session on this account", body = crate::http::ErrorBody),
  ),
)]
pub async fn revoke_session(
  State(state): State<AppState>,
  admin: ConsoleIdentity,
  Path(id): Path<String>,
) -> Result<HttpResponse<serde_json::Value>, ConsoleError> {
  sessions::service::revoke_own(
    &state,
    Realm::Console,
    &admin.admin_id,
    &admin.email,
    admin.role.as_str(),
    &id,
  )
  .await?;
  Ok(HttpResponse::done("SESSION_REVOKED"))
}

/// Sign out of the console everywhere
///
/// With `keepCurrent=true`, the session making this request stays signed in.
#[utoipa::path(
  delete,
  path = crate::constants::api::console::SESSIONS,
  tag = "console",
  security(("bearerAuth" = [])),
  params(RevokeAllQuery),
  responses(
    (status = 200, description = "Sessions ended", body = inline(HttpResponseFormat<serde_json::Value>)),
    (status = 401, description = "Authentication is required", body = crate::http::ErrorBody),
  ),
)]
pub async fn revoke_sessions(
  State(state): State<AppState>,
  admin: ConsoleIdentity,
  Query(query): Query<RevokeAllQuery>,
) -> Result<HttpResponse<serde_json::Value>, ConsoleError> {
  let keep = query.keep_current.then_some(admin.session_id.as_str());
  let mut tx = state.db.pool().begin().await?;
  let ended = sessions::service::revoke_all(
    &mut tx,
    Realm::Console,
    &admin.admin_id,
    keep,
    "signed_out_everywhere",
  )
  .await?;
  audit::service::record(
    &mut tx,
    audit::service::Event::account(
      Realm::Console,
      &admin.admin_id,
      &admin.email,
      admin.role.as_str(),
      "session.revoked_all",
    )
    .metadata(serde_json::json!({ "sessions": ended, "keptCurrent": query.keep_current })),
  )
  .await?;
  tx.commit().await?;
  Ok(HttpResponse::done("SESSIONS_REVOKED"))
}
