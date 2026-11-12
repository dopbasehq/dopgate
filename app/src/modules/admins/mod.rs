use crate::state::AppState;
use axum::{
  Router,
  routing::{get, post},
};

pub mod controller;
pub mod doc;
pub mod error;
pub mod model;
pub(crate) mod repository;
pub mod service;

pub fn routes() -> Router<AppState> {
  use crate::constants::api::admins;
  Router::new()
    .route(
      admins::COLLECTION,
      get(controller::list).post(controller::create),
    )
    .route(
      admins::ITEM,
      get(controller::get)
        .patch(controller::update)
        .delete(controller::delete),
    )
    .route(admins::DISABLE, post(controller::disable))
    .route(admins::ENABLE, post(controller::enable))
}
