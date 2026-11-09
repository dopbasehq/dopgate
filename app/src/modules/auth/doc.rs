use super::{controller, model::*};
use crate::{
  http::{ErrorBody, HttpResponseFormat},
  models::{Role, User, UserStatus},
};
use utoipa::OpenApi;

#[derive(OpenApi)]
#[openapi(
  paths(
    controller::methods,
    controller::signup,
    controller::login,
    controller::refresh,
    controller::logout,
    controller::me,
    controller::update_me,
    controller::change_password
  ),
  components(schemas(
    AuthMethods,
    SignupResult,
    crate::modules::settings::model::BrandingSettings,
    SignupRequest,
    LoginRequest,
    RefreshRequest,
    LogoutRequest,
    AuthTokens,
    UpdateProfileRequest,
    ChangePasswordRequest,
    User,
    Role,
    UserStatus,
    ErrorBody,
    HttpResponseFormat<AuthMethods>,
    HttpResponseFormat<AuthTokens>,
    HttpResponseFormat<SignupResult>,
    HttpResponseFormat<User>,
    HttpResponseFormat<serde_json::Value>
  )),
  tags((name = "auth", description = "Sign up, sign in, tokens, and the signed-in account"))
)]
struct AuthApi;

pub fn build() -> utoipa::openapi::OpenApi {
  AuthApi::openapi()
}
