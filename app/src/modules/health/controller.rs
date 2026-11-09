use super::{error::HealthError, model::HealthResponse, service};
use crate::{
  http::{HttpResponse, HttpResponseFormat},
  state::AppState,
};
use axum::{extract::State, http::StatusCode};

/// Health check
///
/// Report the service identity, version, and whether the database answers.
/// Answers 503 while the database is unreachable, so container health
/// checks and load balancers notice.
#[utoipa::path(
  get,
  path = crate::constants::api::health::ROOT,
  tag = "health",
  responses(
    (status = 200, description = "Service is healthy", body = inline(HttpResponseFormat<HealthResponse>)),
    (status = 503, description = "The database is unreachable", body = inline(HttpResponseFormat<HealthResponse>)),
  ),
)]
pub async fn health(
  State(state): State<AppState>
) -> Result<HttpResponse<HealthResponse>, HealthError> {
  let (healthy, report) = service::health(&state).await;
  Ok(if healthy {
    HttpResponse::ok(report, "HEALTH_OK")
  } else {
    HttpResponse::new(
      "HEALTH_DEGRADED",
      StatusCode::SERVICE_UNAVAILABLE,
      Some(report),
    )
  })
}
