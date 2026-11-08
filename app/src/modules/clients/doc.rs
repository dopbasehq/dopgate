use super::{controller, model::*};
use crate::http::{ErrorBody, HttpResponseFormat};
use utoipa::OpenApi;

#[derive(OpenApi)]
#[openapi(
  paths(
    controller::list,
    controller::get,
    controller::create,
    controller::update,
    controller::delete,
    controller::rotate_secret
  ),
  components(schemas(
    ClientResponse,
    ClientWithSecret,
    CreateClientRequest,
    UpdateClientRequest,
    ErrorBody,
    HttpResponseFormat<Vec<ClientResponse>>,
    HttpResponseFormat<ClientResponse>,
    HttpResponseFormat<ClientWithSecret>,
    HttpResponseFormat<serde_json::Value>
  )),
  tags((name = "clients", description = "Admin: the apps that use this instance"))
)]
struct ClientsApi;

pub fn build() -> utoipa::openapi::OpenApi {
  ClientsApi::openapi()
}
