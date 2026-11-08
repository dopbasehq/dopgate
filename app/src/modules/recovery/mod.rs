use crate::state::AppState;
use axum::{Router, routing::post};
pub mod controller;
pub mod doc;
pub mod error;
pub mod model;
mod repository;
pub mod service;
pub fn routes() -> Router<AppState> {
  use crate::constants::api::recovery;
  Router::new()
    .route(recovery::FORGOT, post(controller::forgot))
    .route(recovery::RESET, post(controller::reset))
}
