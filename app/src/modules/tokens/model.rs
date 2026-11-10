use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TradeTokenRequest {
  /// A personal token, `dgp_` and 43 characters.
  pub token: String,
}

/// A short-lived access token. Trade the token again when it expires.
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TradedToken {
  /// An ES256 JWT. Send it as `Authorization: Bearer <token>`.
  pub access_token: String,
  /// Always `Bearer`.
  pub token_type: String,
  /// Seconds until the access token expires.
  pub expires_in: i64,
}
