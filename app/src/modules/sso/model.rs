use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

/// A sign-in button your app can show.
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PublicProvider {
  /// Provider ID with the `sso_` prefix.
  pub id: String,
  pub display_name: String,
  pub preset: String,
}

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
#[serde(rename_all = "camelCase")]
pub struct StartQuery {
  /// Where to send the user afterwards, with a handoff code. Must be one of
  /// the client's redirect URLs.
  pub redirect_url: String,
  /// The app's publishable key. Browsers cannot send headers on a
  /// redirect, so it travels in the query here.
  pub client: Option<String>,
}

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct CallbackQuery {
  pub code: Option<String>,
  pub state: Option<String>,
  pub error: Option<String>,
  pub error_description: Option<String>,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExchangeRequest {
  /// The `code` query parameter your redirect URL received.
  pub handoff_code: String,
}

/// A provider template from presets.toml.
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PresetResponse {
  pub id: String,
  pub label: String,
  pub button_label: String,
  /// An example issuer URL.
  pub issuer: String,
  pub hint: String,
}

/// A provider as admins see it. The client secret is never returned.
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProviderResponse {
  pub id: String,
  pub preset: String,
  pub display_name: String,
  pub issuer: String,
  pub client_id: String,
  pub enabled: bool,
  /// Create a member account for a first-time user.
  pub allow_signup: bool,
  /// When a test sign-in last succeeded. Needed before enabling.
  pub verified_at: Option<String>,
  pub created_at: String,
  pub updated_at: String,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateProviderRequest {
  pub preset: String,
  pub display_name: Option<String>,
  pub issuer: String,
  pub client_id: String,
  pub client_secret: String,
  #[serde(default = "enabled")]
  pub allow_signup: bool,
}

/// Fields left out stay as they are. Changing the issuer or client clears
/// `verifiedAt` and disables the provider.
#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProviderRequest {
  pub display_name: Option<String>,
  pub issuer: Option<String>,
  pub client_id: Option<String>,
  pub client_secret: Option<String>,
  pub enabled: Option<bool>,
  pub allow_signup: Option<bool>,
}

fn enabled() -> bool {
  true
}
