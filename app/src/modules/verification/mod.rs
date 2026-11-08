use crate::state::AppState;
use axum::{Router, routing::post};
pub mod controller;
pub mod doc;
pub mod error;
pub mod model;
mod repository;
pub mod service;
pub fn routes() -> Router<AppState> {
  use crate::constants::api::verification;
  Router::new()
    .route(verification::SEND, post(controller::send))
    .route(verification::CONFIRM, post(controller::confirm))
}
