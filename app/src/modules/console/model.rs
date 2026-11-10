use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::models::Admin;

/// What a console sign-in returns.
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ConsoleTokens {
  /// A short-lived token for the console. It only works on Dopgate's own
  /// endpoints: it is signed with a secret that is not in the JWKS.
  pub access_token: String,
  /// Always `Bearer`.
  pub token_type: String,
  /// Seconds until the access token expires.
  pub expires_in: i64,
  /// `null` in cookie mode, where an HttpOnly cookie carries it.
  pub refresh_token: Option<String>,
  pub admin: Admin,
}

impl crate::modules::sessions::service::CarriesRefresh for ConsoleTokens {
  fn take_refresh_token(&mut self) -> Option<String> {
    self.refresh_token.take()
  }
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ConsoleSendCodeRequest {
  /// The admin's email. The answer is the same whether or not an admin uses
  /// it.
  pub email: String,
}

/// What a confirmed code does: `login` signs the admin in; `email_change`
/// moves the account to the new address (pass the new address as `email`).
#[derive(Clone, Copy, Deserialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ConsoleCodePurpose {
  Login,
  EmailChange,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ConsoleConfirmCodeRequest {
  pub email: String,
  pub purpose: ConsoleCodePurpose,
  /// The 6-digit code. Spaces and dashes are ignored.
  pub code: String,
}

/// Fields left out stay as they are. An empty string clears them.
#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateConsoleProfileRequest {
  pub display_name: Option<String>,
  pub avatar_url: Option<String>,
}
