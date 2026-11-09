use super::{controller, model::*};
use crate::{
  http::{ErrorBody, HttpResponseFormat},
  services::mailer::SmtpSecurity,
};
use utoipa::OpenApi;

#[derive(OpenApi)]
#[openapi(
  paths(controller::get, controller::update, controller::test_smtp),
  components(schemas(
    Settings,
    SignupSettings,
    PasswordSettings,
    TokenSettings,
    LimitSettings,
    SmtpSettings,
    SmtpSecurity,
    SmtpSource,
    SmtpSettingsInput,
    BrandingSettings,
    UpdateSettingsRequest,
    SmtpTestRequest,
    ErrorBody,
    HttpResponseFormat<Settings>,
    HttpResponseFormat<serde_json::Value>
  )),
  tags((name = "settings", description = "Admin: sign-up rules, limits, token lifetimes, branding, and SMTP"))
)]
struct SettingsApi;

pub fn build() -> utoipa::openapi::OpenApi {
  SettingsApi::openapi()
}
