use super::model::HealthResponse;
use crate::state::AppState;

pub async fn health(state: &AppState) -> (bool, HealthResponse) {
  let database_ok = state.db.ping().await.is_ok();
  (
    database_ok,
    HealthResponse {
      product: "dopgate",
      version: env!("CARGO_PKG_VERSION"),
      api_version: "v1",
      status: if database_ok { "ok" } else { "degraded" },
      database: if database_ok { "ok" } else { "unavailable" },
    },
  )
}
