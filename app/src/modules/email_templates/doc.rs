use super::{controller, model::*};
use crate::http::{ErrorBody, HttpResponseFormat};
use utoipa::OpenApi;

#[derive(OpenApi)]
#[openapi(
  paths(
    controller::list,
    controller::get,
    controller::save,
    controller::reset,
    controller::preview,
    controller::test
  ),
  components(schemas(
    TemplateSummary,
    TemplateDetail,
    TemplateContent,
    TemplateInput,
    ErrorBody,
    HttpResponseFormat<Vec<TemplateSummary>>,
    HttpResponseFormat<TemplateDetail>,
    HttpResponseFormat<TemplateContent>,
    HttpResponseFormat<serde_json::Value>
  )),
  tags((name = "email-templates", description = "Admin: the emails Dopgate sends"))
)]
struct EmailTemplatesApi;

pub fn build() -> utoipa::openapi::OpenApi {
  EmailTemplatesApi::openapi()
}
