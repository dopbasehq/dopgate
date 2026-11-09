use chrono::{DateTime, Utc};
use serde::Serialize;
use utoipa::ToSchema;

/// A JSON Web Key Set, as RFC 7517 defines it.
#[derive(Serialize, ToSchema)]
pub struct Jwks {
  /// Public keys in JWK form. Pick the one whose `kid` matches the token
  /// header.
  #[schema(value_type = Vec<Object>)]
  pub keys: Vec<serde_json::Value>,
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
