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
    SmtpSettings,
    SmtpSecurity,
    SmtpSource,
    BrandingSettings,
    UpdateSettingsRequest,
    UpdateSmtpSettings,
    SmtpTestRequest,
    ErrorBody,
    HttpResponseFormat<Settings>,
    HttpResponseFormat<serde_json::Value>
  )),
  tags((name = "settings", description = "Admin: SMTP, sign-up rules, token lifetimes, and branding"))
)]
struct SettingsApi;

pub fn build() -> utoipa::openapi::OpenApi {
  SettingsApi::openapi()
}
