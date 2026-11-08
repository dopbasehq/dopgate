use std::convert::Infallible;

use axum::{extract::FromRequestParts, http::request::Parts};

/// The header apps send their publishable key in.
pub const CLIENT_KEY_HEADER: &str = "x-dopgate-client";

/// The publishable key the calling app sent, if any. Tokens issued to a
/// request that carries one are scoped to that client.
///
/// The key is only read here. Checking it against registered clients, their
/// allowed origins, and redirect URLs comes with the clients module.
pub struct ClientKey(pub Option<String>);

impl<S: Send + Sync> FromRequestParts<S> for ClientKey {
  type Rejection = Infallible;

  async fn from_request_parts(
    parts: &mut Parts,
    _state: &S,
  ) -> Result<Self, Self::Rejection> {
    Ok(Self(
      parts
        .headers
        .get(CLIENT_KEY_HEADER)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned),
    ))
  }
}
