use super::{error::TokensError, model::*, service};
use crate::{
  http::{HttpResponse, HttpResponseFormat},
  state::AppState,
};
use axum::{Json, extract::State};

/// Trade a token
///
/// Trade a personal token (`dgp_…`) or an agent token (`dga_…`) for a
/// short-lived access token. A personal token signs in as its user, with
/// `via: "pat"`; an agent token as the agent, with `kind: "agent"`, `owner`,
/// and `capabilities`. There is no refresh token: trade again when the
/// access token expires.
#[utoipa::path(
  post,
  path = crate::constants::api::auth::TOKEN,
  tag = "auth",
  request_body = TradeTokenRequest,
  responses(
    (status = 200, description = "Token traded", body = inline(HttpResponseFormat<TradedToken>)),
    (status = 401, description = "The token is wrong, revoked, or expired", body = crate::http::ErrorBody),
    (status = 403, description = "The account, the agent, or its owner is disabled", body = crate::http::ErrorBody),
    (status = 429, description = "Too many attempts", body = crate::http::ErrorBody),
  ),
)]
pub async fn trade(
  State(state): State<AppState>,
  Json(request): Json<TradeTokenRequest>,
) -> Result<HttpResponse<TradedToken>, TokensError> {
  Ok(HttpResponse::ok(
    service::trade(&state, request).await?,
    "TOKEN_TRADED",
  ))
}
