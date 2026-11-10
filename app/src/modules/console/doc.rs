use super::{controller, model::*};
use crate::{
  http::{ErrorBody, HttpResponseFormat},
  models::{Admin, Role, UserStatus},
  modules::{
    auth::model::{
      ChangeEmailRequest, ChangePasswordRequest, LoginRequest, LogoutRequest, RefreshRequest,
    },
    recovery::model::{ForgotPasswordRequest, ResetPasswordRequest},
    sessions::model::SessionResponse,
  },
};
use utoipa::OpenApi;

#[derive(OpenApi)]
#[openapi(
  paths(
    controller::login,
    controller::refresh,
    controller::logout,
    controller::send_code,
    controller::confirm_code,
    controller::forgot_password,
    controller::reset_password,
    controller::change_password,
    controller::me,
    controller::update_me,
    controller::change_email,
    controller::sessions,
    controller::revoke_session,
    controller::revoke_sessions
  ),
  components(schemas(
    ConsoleTokens,
    ConsoleSendCodeRequest,
    ConsoleConfirmCodeRequest,
    ConsoleCodePurpose,
    UpdateConsoleProfileRequest,
    LoginRequest,
    RefreshRequest,
    LogoutRequest,
    ChangePasswordRequest,
    ChangeEmailRequest,
    ForgotPasswordRequest,
    ResetPasswordRequest,
    SessionResponse,
    Admin,
    Role,
    UserStatus,
    ErrorBody,
    HttpResponseFormat<ConsoleTokens>,
    HttpResponseFormat<Admin>,
    HttpResponseFormat<Vec<SessionResponse>>,
    HttpResponseFormat<serde_json::Value>
  )),
  tags((name = "console", description = "Console sign-in and the signed-in admin's account. Only the console calls these."))
)]
struct ConsoleApi;

pub fn build() -> utoipa::openapi::OpenApi {
  ConsoleApi::openapi()
}
