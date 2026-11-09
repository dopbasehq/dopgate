use super::{controller, model::*};
use crate::{
  http::{ErrorBody, HttpResponseFormat},
  modules::auth::model::AuthTokens,
};
use utoipa::OpenApi;

#[derive(OpenApi)]
#[openapi(
  paths(controller::send, controller::confirm),
  components(schemas(
    SendCodeRequest,
    ConfirmCodeRequest,
    Purpose,
    AuthTokens,
    ErrorBody,
    HttpResponseFormat<AuthTokens>,
    HttpResponseFormat<serde_json::Value>
  )),
  tags((name = "verification", description = "Emailed codes: verify an email or sign in without a password"))
)]
struct VerificationApi;

pub fn build() -> utoipa::openapi::OpenApi {
  VerificationApi::openapi()
}
