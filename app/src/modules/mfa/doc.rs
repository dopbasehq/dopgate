use super::{controller, model::*};
use crate::{
  http::{ErrorBody, HttpResponseFormat},
  modules::auth::model::AuthTokens,
};
use utoipa::OpenApi;

#[derive(OpenApi)]
#[openapi(
  paths(
    controller::enroll,
    controller::verify,
    controller::remove,
    controller::challenge
  ),
  components(schemas(
    TotpEnrollment,
    TotpCodeRequest,
    RecoveryCodes,
    MfaChallengeRequest,
    ErrorBody,
    HttpResponseFormat<TotpEnrollment>,
    HttpResponseFormat<RecoveryCodes>,
    HttpResponseFormat<AuthTokens>,
    HttpResponseFormat<serde_json::Value>
  )),
  tags((name = "mfa", description = "Second factor with an authenticator app"))
)]
struct MfaApi;

pub fn build() -> utoipa::openapi::OpenApi {
  MfaApi::openapi()
}
