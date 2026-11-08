use crate::state::AppState;
use axum::{
  Router,
  routing::{get, post},
};
pub mod controller;
pub mod doc;
pub mod error;
pub mod model;
mod repository;
pub mod service;
pub fn routes() -> Router<AppState> {
  Router::new()
    .route(
      crate::constants::api::bootstrap::STATUS,
      get(controller::status),
    )
    .route(
      crate::constants::api::bootstrap::ROOT,
      post(controller::create_root),
    )
}
