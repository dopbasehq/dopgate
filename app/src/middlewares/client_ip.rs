use std::net::SocketAddr;

use axum::{
  extract::{ConnectInfo, Request, State},
  http::HeaderMap,
  middleware::Next,
  response::{IntoResponse, Response},
};

use crate::{
  constants::{
    errors::{BACKEND_KEY_INVALID, REQUEST_INVALID},
    tokens::{BACKEND_KEY_HEADER, CLIENT_AGENT_HEADER, CLIENT_IP_HEADER, USER_AGENT_MAX_CHARS},
  },
  http::HttpError,
  services::{client_ip, token},
  state::AppState,
};

/// Resolve the client address once per request so audit records can store
/// it. Requests that arrive without connection info, as in-process tests
/// send them, have no address.
pub async fn capture(
  State(state): State<AppState>,
  request: Request,
  next: Next,
) -> Response {
  let peer = request
    .extensions()
    .get::<ConnectInfo<SocketAddr>>()
    .map(|ConnectInfo(address)| address.ip());
  // Proxies may append their own header line instead of extending the
  // existing one; both read as one list.
  let forwarded_for = request
    .headers()
    .get_all("x-forwarded-for")
    .iter()
    .filter_map(|value| value.to_str().ok())
    .collect::<Vec<_>>()
    .join(",");
  let address = client_ip::resolve(peer, &forwarded_for, &state.config.trusted_proxies);
  client_ip::scope(address, next.run(request)).await
}

/// The visitor's browser, passed on by a backend in
/// `X-Dopgate-Client-Agent`. Sign-ins record it in place of the backend's
/// own `User-Agent`.
#[derive(Clone, Debug)]
pub struct RelayedAgent(pub String);

/// A backend that signs people in for them sends the service key in
/// `X-Dopgate-Backend-Key`. With a valid key, the visitor's address and
/// browser come from `X-Dopgate-Client-IP` and `X-Dopgate-Client-Agent`, so
/// limits, lockouts, the device list and the audit log describe the person
/// and not the backend. Without the key those headers are ignored. A wrong
/// key is refused, so a misconfigured backend fails loudly instead of
/// sharing one address limit between all of its users. The refusal has its
/// own code, `BACKEND_KEY_INVALID`: on a sign-in it would otherwise read
/// like the visitor's wrong password.
///
/// Runs inside [`capture`], so its address replaces the resolved one.
pub async fn relay(
  State(state): State<AppState>,
  mut request: Request,
  next: Next,
) -> Response {
  let Some(key) = request.headers().get(BACKEND_KEY_HEADER) else {
    return next.run(request).await;
  };
  let valid = match (&state.config.service_key, key.to_str()) {
    (Some(expected), Ok(given)) => token::constant_time_eq(expected, given),
    _ => false,
  };
  if !valid {
    return HttpError::unauthorized(
      BACKEND_KEY_INVALID,
      "The backend key is wrong. Send this Dopgate's DOPGATE_SERVICE_KEY in X-Dopgate-Backend-Key.",
    )
    .into_response();
  }
  let address = match relayed_address(request.headers()) {
    Ok(Some(address)) => Some(address),
    Ok(None) => client_ip::current(),
    Err(error) => return error.into_response(),
  };
  if let Some(agent) = relayed_agent(request.headers()) {
    request.extensions_mut().insert(RelayedAgent(agent));
  }
  client_ip::scope(address, next.run(request)).await
}

fn relayed_address(headers: &HeaderMap) -> Result<Option<std::net::IpAddr>, HttpError> {
  let Some(value) = headers.get(CLIENT_IP_HEADER) else {
    return Ok(None);
  };
  value
    .to_str()
    .ok()
    .and_then(client_ip::parse_relayed)
    .map(Some)
    .ok_or_else(|| {
      HttpError::bad_request(
        REQUEST_INVALID,
        "X-Dopgate-Client-IP must be an IP address.",
      )
    })
}

fn relayed_agent(headers: &HeaderMap) -> Option<String> {
  let agent: String = headers
    .get(CLIENT_AGENT_HEADER)?
    .to_str()
    .ok()?
    .trim()
    .chars()
    .take(USER_AGENT_MAX_CHARS)
    .collect();
  (!agent.is_empty()).then_some(agent)
}
