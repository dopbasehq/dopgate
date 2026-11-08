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
  use crate::constants::api::backups;
  Router::new()
    .route(
      backups::COLLECTION,
      get(controller::list).post(controller::create),
    )
    .route(
      backups::ITEM,
      get(controller::download).delete(controller::delete),
    )
    .route(backups::RESTORE, post(controller::restore))
    .route(backups::EXPORT, get(controller::export))
    .route(backups::IMPORT, post(controller::import))
}
