use super::{controller, model::*};
use crate::http::ErrorBody;
use utoipa::OpenApi;

#[derive(OpenApi)]
#[openapi(
  paths(
    controller::discovery,
    controller::authorize,
    controller::token,
    controller::userinfo
  ),
  components(schemas(TokenRequest, TokenResponse, ErrorBody)),
  tags((name = "oidc", description = "dopgate as an OpenID Connect provider (planned)"))
)]
struct OidcProviderApi;

pub fn build() -> utoipa::openapi::OpenApi {
  OidcProviderApi::openapi()
}
