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
  use crate::constants::api::keys;
  Router::new()
    .route(keys::JWKS, get(controller::jwks))
    .route(keys::COLLECTION, get(controller::list))
    .route(keys::ROTATE, post(controller::rotate))
}
