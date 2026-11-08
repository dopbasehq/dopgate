use super::{controller, model::*};
use crate::http::{ErrorBody, HttpResponseFormat};
use utoipa::OpenApi;

#[derive(OpenApi)]
#[openapi(
  paths(controller::list, controller::revoke),
  components(schemas(
    SessionResponse,
    ErrorBody,
    HttpResponseFormat<Vec<SessionResponse>>,
    HttpResponseFormat<serde_json::Value>
  )),
  tags((name = "sessions", description = "The signed-in user's devices"))
)]
struct SessionsApi;

pub fn build() -> utoipa::openapi::OpenApi {
  SessionsApi::openapi()
}
