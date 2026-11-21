use crate::state::AppState;
use axum::{
  Router,
  routing::{get, post},
};
pub mod controller;
pub mod doc;
pub mod error;
pub mod model;
pub mod presets;
mod repository;
pub mod service;
pub fn routes() -> Router<AppState> {
  use crate::constants::api::sso;
  Router::new()
    .route(sso::PROVIDERS, get(controller::providers))
    .route(sso::START, get(controller::start))
    .route(sso::CALLBACK, get(controller::callback))
    .route(sso::EXCHANGE, post(controller::exchange))
    .route(sso::ADMIN_PRESETS, get(controller::presets))
    .route(
      sso::ADMIN_PROVIDERS,
      get(controller::admin_list).post(controller::admin_create),
    )
    .route(
      sso::ADMIN_PROVIDER,
      get(controller::admin_get)
        .patch(controller::admin_update)
        .delete(controller::admin_delete),
    )
}
