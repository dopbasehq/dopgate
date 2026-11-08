use super::{controller, model::*};
use crate::{
  http::{ErrorBody, HttpResponseFormat},
  services::otp::{Method, Purpose},
};
use utoipa::OpenApi;

#[derive(OpenApi)]
#[openapi(
  paths(controller::send, controller::confirm),
  components(schemas(
    SendVerificationRequest,
    ConfirmVerificationRequest,
    VerificationResult,
    Purpose,
    Method,
    ErrorBody,
    HttpResponseFormat<VerificationResult>,
    HttpResponseFormat<serde_json::Value>
  )),
  tags((name = "verification", description = "Email codes and links: verification and passwordless sign-in"))
)]
struct VerificationApi;

pub fn build() -> utoipa::openapi::OpenApi {
  VerificationApi::openapi()
}
