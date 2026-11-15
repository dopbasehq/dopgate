use std::convert::Infallible;

use axum::{
  extract::FromRequestParts,
  http::{
    header::{COOKIE, USER_AGENT},
    request::Parts,
  },
};

use crate::{
  constants::tokens::{
    CONSOLE_REFRESH_COOKIE, REFRESH_COOKIE, SESSION_MODE_COOKIE, SESSION_MODE_HEADER,
    USER_AGENT_MAX_CHARS,
  },
  middlewares::client_ip::RelayedAgent,
  state::AppState,
};

/// How the caller wants its refresh token delivered.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SessionMode {
  /// In the response body. Apps store it themselves.
  Body,
  /// In an HttpOnly cookie, as the console uses it.
  Cookie,
}

/// Details about the request that sign-ins record.
pub struct RequestContext {
  pub user_agent: Option<String>,
  pub session_mode: SessionMode,
  /// The refresh token from an app's refresh cookie, when one was sent.
  pub refresh_cookie: Option<String>,
  /// The refresh token from the console's cookie, when one was sent.
  pub console_refresh_cookie: Option<String>,
}

impl FromRequestParts<AppState> for RequestContext {
  type Rejection = Infallible;

  async fn from_request_parts(
    parts: &mut Parts,
    _state: &AppState,
  ) -> Result<Self, Self::Rejection> {
    // A backend's relayed visitor wins over the backend's own browser name.
    let user_agent = match parts.extensions.get::<RelayedAgent>() {
      Some(RelayedAgent(agent)) => Some(agent.clone()),
      None => parts
        .headers
        .get(USER_AGENT)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.chars().take(USER_AGENT_MAX_CHARS).collect()),
    };
    let session_mode = match parts
      .headers
      .get(SESSION_MODE_HEADER)
      .and_then(|value| value.to_str().ok())
    {
      Some(value) if value.eq_ignore_ascii_case(SESSION_MODE_COOKIE) => SessionMode::Cookie,
      _ => SessionMode::Body,
    };
    let cookie = |wanted: &str| {
      parts
        .headers
        .get_all(COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(';'))
        .filter_map(|pair| pair.trim().split_once('='))
        .find(|(name, _)| *name == wanted)
        .map(|(_, value)| value.to_owned())
        .filter(|value| !value.is_empty())
    };
    Ok(Self {
      user_agent,
      session_mode,
      refresh_cookie: cookie(REFRESH_COOKIE),
      console_refresh_cookie: cookie(CONSOLE_REFRESH_COOKIE),
    })
  }
}
