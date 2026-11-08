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
  use crate::constants::api::settings;
  Router::new()
    .route(
      settings::ROOT,
      get(controller::get).patch(controller::update),
    )
    .route(settings::SMTP_TEST, post(controller::test_smtp))
}
