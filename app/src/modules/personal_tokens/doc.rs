use super::{controller, model::*};
use crate::http::{ErrorBody, HttpResponseFormat};
use utoipa::OpenApi;

#[derive(OpenApi)]
#[openapi(
  paths(
    controller::list,
    controller::create,
    controller::delete,
    controller::admin_list,
    controller::admin_revoke
  ),
  components(schemas(
    PersonalToken,
    PersonalTokenList,
    CreatePersonalTokenRequest,
    CreatedPersonalToken,
    ErrorBody,
    HttpResponseFormat<PersonalTokenList>,
    HttpResponseFormat<CreatedPersonalToken>,
    HttpResponseFormat<serde_json::Value>
  )),
  tags((name = "personal-tokens", description = "Personal tokens: a user's own tokens that sign in as that user."))
)]
struct PersonalTokensApi;

pub fn build() -> utoipa::openapi::OpenApi {
  PersonalTokensApi::openapi()
}
