//! Single sign-on with OpenID Connect providers. The preset catalog works
//! now; the rest is planned (phase 6).

use super::{model::*, presets};
use crate::{
  http::HttpError, models::AuthIdentity, modules::auth::model::AuthTokens, state::AppState,
};

pub fn presets() -> Vec<PresetResponse> {
  presets::all()
    .iter()
    .map(|preset| PresetResponse {
      id: preset.id.clone(),
      label: preset.label.clone(),
      button_label: preset.button_label.clone(),
      issuer: preset.issuer.clone(),
      hint: preset.hint.clone(),
    })
    .collect()
}

pub async fn providers(_state: &AppState) -> Result<Vec<PublicProvider>, HttpError> {
  Err(HttpError::not_implemented())
}

/// The provider's authorization URL to redirect the browser to.
pub async fn start(
  _state: &AppState,
  _provider_id: &str,
  _query: StartQuery,
) -> Result<String, HttpError> {
  Err(HttpError::not_implemented())
}

/// The app URL, with a handoff code, to send the browser back to.
pub async fn callback(
  _state: &AppState,
  _query: CallbackQuery,
) -> Result<String, HttpError> {
  Err(HttpError::not_implemented())
}

pub async fn exchange(
  _state: &AppState,
  _request: ExchangeRequest,
) -> Result<AuthTokens, HttpError> {
  Err(HttpError::not_implemented())
}

pub async fn admin_list(_state: &AppState) -> Result<Vec<ProviderResponse>, HttpError> {
  Err(HttpError::not_implemented())
}

pub async fn admin_get(
  _state: &AppState,
  _id: &str,
) -> Result<ProviderResponse, HttpError> {
  Err(HttpError::not_implemented())
}

pub async fn admin_create(
  _state: &AppState,
  _actor: &AuthIdentity,
  _request: CreateProviderRequest,
) -> Result<ProviderResponse, HttpError> {
  Err(HttpError::not_implemented())
}

pub async fn admin_update(
  _state: &AppState,
  _actor: &AuthIdentity,
  _id: &str,
  _request: UpdateProviderRequest,
) -> Result<ProviderResponse, HttpError> {
  Err(HttpError::not_implemented())
}

pub async fn admin_delete(
  _state: &AppState,
  _actor: &AuthIdentity,
  _id: &str,
) -> Result<(), HttpError> {
  Err(HttpError::not_implemented())
}
