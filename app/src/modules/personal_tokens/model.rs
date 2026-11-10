use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// A personal token as lists show it. The token itself is never shown
/// again after it is created.
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PersonalToken {
  /// Token ID with the `pat_` prefix.
  pub id: String,
  pub name: String,
  /// The token's last four characters, to tell tokens apart.
  pub last_four: String,
  /// `null` for a token that never expires.
  pub expires_at: Option<DateTime<Utc>>,
  /// The token is past `expiresAt` and no longer signs in.
  pub expired: bool,
  pub last_used_at: Option<DateTime<Utc>>,
  pub created_at: DateTime<Utc>,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PersonalTokenList {
  /// Newest first.
  pub items: Vec<PersonalToken>,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreatePersonalTokenRequest {
  /// 1 to 64 characters, unique among the user's tokens.
  pub name: String,
  /// When the token stops working, an RFC 3339 time in the future, up to
  /// 3 years ahead. Leave out for a token that never expires.
  pub expires_at: Option<DateTime<Utc>>,
}

/// A new personal token. `token` is shown this once.
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreatedPersonalToken {
  /// The token, `dgp_` and 43 characters. Store it now: Dopgate keeps only
  /// a hash.
  pub token: String,
  pub personal_token: PersonalToken,
}
