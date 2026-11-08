use serde::Serialize;
use utoipa::ToSchema;

/// A signed-in device.
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SessionResponse {
  /// Session ID with the `ses_` prefix.
  pub id: String,
  /// How the user signed in: `password`, `otp`, `link`, or `sso`.
  pub method: String,
  pub client_id: Option<String>,
  pub ip_address: Option<String>,
  pub user_agent: Option<String>,
  /// True for the session of the access token making this request.
  pub current: bool,
  pub created_at: String,
  pub last_used_at: String,
  pub expires_at: String,
}
