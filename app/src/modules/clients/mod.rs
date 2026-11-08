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
  use crate::constants::api::clients;
  Router::new()
    .route(
      clients::COLLECTION,
      get(controller::list).post(controller::create),
    )
    .route(
      clients::ITEM,
      get(controller::get)
        .patch(controller::update)
        .delete(controller::delete),
    )
    .route(clients::SECRET, post(controller::rotate_secret))
}
