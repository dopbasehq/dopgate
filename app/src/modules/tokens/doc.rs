use super::{controller, model::*};
use crate::http::{ErrorBody, HttpResponseFormat};
use utoipa::OpenApi;

#[derive(OpenApi)]
#[openapi(
  paths(controller::trade),
  components(schemas(
    TradeTokenRequest,
    TradedToken,
    ErrorBody,
    HttpResponseFormat<TradedToken>
  ))
)]
struct TokensApi;

pub fn build() -> utoipa::openapi::OpenApi {
  TokensApi::openapi()
}
