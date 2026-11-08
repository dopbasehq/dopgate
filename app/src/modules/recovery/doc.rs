use super::{controller, model::*};
use crate::{
  http::{ErrorBody, HttpResponseFormat},
  services::otp::Method,
};
use utoipa::OpenApi;

#[derive(OpenApi)]
#[openapi(
  paths(controller::forgot, controller::reset),
  components(schemas(
    ForgotPasswordRequest,
    ResetPasswordRequest,
    Method,
    ErrorBody,
    HttpResponseFormat<serde_json::Value>
  )),
  tags((name = "recovery", description = "Forgot and reset password"))
)]
struct RecoveryApi;

pub fn build() -> utoipa::openapi::OpenApi {
  RecoveryApi::openapi()
}
