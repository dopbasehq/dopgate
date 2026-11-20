use chrono::{DateTime, Utc};
use serde::Serialize;
use utoipa::ToSchema;

/// A JSON Web Key Set, as RFC 7517 defines it.
#[derive(Serialize, ToSchema)]
pub struct Jwks {
  /// Public keys in JWK form. Pick the one whose `kid` matches the token
  /// header.
  #[schema(value_type = Vec<Object>)]
  pub keys: Vec<crate::services::keys::PublicJwk>,
}

/// The discovery document: where a tool that only knows the issuer URL
/// finds the key set. Dopgate is not an OpenID Connect provider, so the
/// document holds the five fields the format requires and nothing else.
#[derive(Serialize, ToSchema)]
pub struct Discovery {
  /// The `iss` and `aud` of every access token.
  pub issuer: String,
  /// The address of the JSON Web Key Set.
  pub jwks_uri: String,
  /// Always `["id_token"]`. The format requires the field; Dopgate has no
  /// authorization endpoint.
  pub response_types_supported: Vec<&'static str>,
  /// Always `["public"]`: `sub` is the same for every backend.
  pub subject_types_supported: Vec<&'static str>,
  /// Always `["ES256"]`.
  pub id_token_signing_alg_values_supported: Vec<&'static str>,
}

#[derive(Serialize, ToSchema, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SigningKeyResponse {
  /// The key ID, also the JWT `kid`.
  pub id: String,
  pub algorithm: String,
  /// `active` signs new tokens. `retiring` only verifies tokens it signed.
  /// `retired` is out of the key set.
  pub status: String,
  pub created_at: DateTime<Utc>,
  pub rotated_at: Option<DateTime<Utc>>,
  pub retired_at: Option<DateTime<Utc>>,
}
