use super::{controller, model::*};
use crate::{
  http::{ErrorBody, HttpResponseFormat},
  modules::auth::model::AuthTokens,
};
use utoipa::OpenApi;

#[derive(OpenApi)]
#[openapi(
  paths(
    controller::providers,
    controller::start,
    controller::callback,
    controller::exchange,
    controller::presets,
    controller::admin_list,
    controller::admin_get,
    controller::admin_create,
    controller::admin_update,
    controller::admin_delete
  ),
  components(schemas(
    PublicProvider,
    ExchangeRequest,
    PresetResponse,
    ProviderResponse,
    CreateProviderRequest,
    UpdateProviderRequest,
    AuthTokens,
    ErrorBody,
    HttpResponseFormat<Vec<PublicProvider>>,
    HttpResponseFormat<AuthTokens>,
    HttpResponseFormat<Vec<PresetResponse>>,
    HttpResponseFormat<Vec<ProviderResponse>>,
    HttpResponseFormat<ProviderResponse>,
    HttpResponseFormat<serde_json::Value>
  )),
  tags((name = "sso", description = "Single sign-on with OpenID Connect providers"))
)]
struct SsoApi;

pub fn build() -> utoipa::openapi::OpenApi {
  SsoApi::openapi()
}
