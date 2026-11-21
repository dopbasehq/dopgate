use super::{controller, model::*};
use crate::http::{ErrorBody, HttpResponseFormat};
use utoipa::OpenApi;

#[derive(OpenApi)]
#[openapi(
  paths(controller::status, controller::create_root),
  components(schemas(
    BootstrapStatus,
    CreateRootRequest,
    RootCreated,
    ErrorBody,
    HttpResponseFormat<BootstrapStatus>,
    HttpResponseFormat<RootCreated>
  )),
  tags((name = "bootstrap", description = "First-run setup"))
)]
struct BootstrapApi;

pub fn build() -> utoipa::openapi::OpenApi {
  BootstrapApi::openapi()
}
