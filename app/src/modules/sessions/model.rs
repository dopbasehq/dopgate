use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

/// A signed-in device.
#[derive(Serialize, ToSchema, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SessionResponse {
  /// Session ID with the `ses_` prefix.
  pub id: String,
  /// How the user signed in: `password`, `otp`, or `sso`.
  pub method: String,
  pub ip_address: Option<String>,
  pub user_agent: Option<String>,
  /// True for the session of the access token making this request.
  pub current: bool,
  pub created_at: DateTime<Utc>,
  pub last_used_at: DateTime<Utc>,
  /// When the session ends at the latest.
  pub expires_at: DateTime<Utc>,
}

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
#[serde(rename_all = "camelCase")]
pub struct RevokeAllQuery {
  /// Keep the session making this request signed in.
  #[serde(default)]
  pub keep_current: bool,
}

/// How the user proved who they are.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SignInMethod {
  Password,
  Otp,
}

impl SignInMethod {
  pub fn as_str(self) -> &'static str {
    match self {
      Self::Password => "password",
      Self::Otp => "otp",
    }
  }
}
