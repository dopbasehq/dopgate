use crate::state::AppState;
use axum::{
  Router,
  routing::{delete, get},
};

pub mod controller;
pub mod doc;
pub mod error;
pub mod model;
pub(crate) mod repository;
pub mod service;

pub fn routes() -> Router<AppState> {
  use crate::constants::api::sessions;
  Router::new()
    .route(
      sessions::COLLECTION,
      get(controller::list).delete(controller::revoke_all),
    )
    .route(sessions::ITEM, delete(controller::revoke))
}
