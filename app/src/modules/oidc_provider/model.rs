use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

/// The parameters of an authorization request (OpenID Connect Core 3.1.2.1).
#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct AuthorizeQuery {
  pub response_type: String,
  pub client_id: String,
  pub redirect_uri: String,
  pub scope: String,
  pub state: Option<String>,
  pub nonce: Option<String>,
  pub code_challenge: Option<String>,
  pub code_challenge_method: Option<String>,
}

/// A token request, form-encoded (RFC 6749 4.1.3).
#[derive(Deserialize, ToSchema)]
pub struct TokenRequest {
  pub grant_type: String,
  pub code: Option<String>,
  pub redirect_uri: Option<String>,
  pub client_id: Option<String>,
  pub client_secret: Option<String>,
  pub code_verifier: Option<String>,
  pub refresh_token: Option<String>,
}

#[derive(Serialize, ToSchema)]
pub struct TokenResponse {
  pub access_token: String,
  pub token_type: String,
  pub expires_in: i64,
  pub id_token: String,
  pub refresh_token: Option<String>,
}
