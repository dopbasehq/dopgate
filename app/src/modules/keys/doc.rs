use super::{controller, model::*};
use crate::http::{ErrorBody, HttpResponseFormat};
use utoipa::OpenApi;

#[derive(OpenApi)]
#[openapi(
  paths(controller::jwks, controller::list, controller::rotate),
  components(schemas(
    Jwks,
    SigningKeyResponse,
    ErrorBody,
    HttpResponseFormat<Vec<SigningKeyResponse>>,
    HttpResponseFormat<SigningKeyResponse>
  )),
  tags((name = "keys", description = "Keys that sign access tokens"))
)]
struct KeysApi;

pub fn build() -> utoipa::openapi::OpenApi {
  KeysApi::openapi()
}
