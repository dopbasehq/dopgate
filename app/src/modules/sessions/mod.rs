use crate::state::AppState;
use axum::{
  Router,
  routing::{delete, get},
};
pub mod controller;
pub mod doc;
pub mod error;
pub mod model;
mod repository;
pub mod service;
pub fn routes() -> Router<AppState> {
  use crate::constants::api::sessions;
  Router::new()
    .route(sessions::COLLECTION, get(controller::list))
    .route(sessions::ITEM, delete(controller::revoke))
}
