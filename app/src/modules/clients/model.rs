use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// An app registered to use this instance.
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ClientResponse {
  /// Client ID with the `cli_` prefix.
  pub id: String,
  pub name: String,
  /// Send it from your app in the `X-Dopgate-Client` header. Safe to ship.
  pub publishable_key: String,
  /// The last four characters of the secret key, to tell keys apart.
  pub secret_key_hint: Option<String>,
  /// Where sign-in links and single sign-on may send users back to.
  pub redirect_urls: Vec<String>,
  /// Browser origins allowed to call the API.
  pub allowed_origins: Vec<String>,
  pub created_at: String,
  pub updated_at: String,
}

/// Returned once, when a secret key is created. Store it in your backend.
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ClientWithSecret {
  pub client: ClientResponse,
  /// Starts with `sk_`. dopgate keeps only a hash and cannot show it again.
  pub secret_key: String,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateClientRequest {
  pub name: String,
  #[serde(default)]
  pub redirect_urls: Vec<String>,
  #[serde(default)]
  pub allowed_origins: Vec<String>,
}

/// Fields left out stay as they are.
#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateClientRequest {
  pub name: Option<String>,
  pub redirect_urls: Option<Vec<String>>,
  pub allowed_origins: Option<Vec<String>>,
}
