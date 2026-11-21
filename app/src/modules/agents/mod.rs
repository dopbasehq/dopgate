use crate::state::AppState;
use axum::{
  Router,
  routing::{get, post},
};

pub mod capabilities;
pub mod controller;
pub mod doc;
pub mod error;
pub mod model;
pub(crate) mod repository;
pub mod service;

pub fn routes() -> Router<AppState> {
  use crate::constants::api::agents;
  Router::new()
    .route(
      agents::OWN_COLLECTION,
      get(controller::list_own).post(controller::create_own),
    )
    .route(
      agents::OWN_ITEM,
      get(controller::get_own)
        .patch(controller::update_own)
        .delete(controller::delete_own),
    )
    .route(agents::OWN_REGENERATE, post(controller::regenerate_own))
    .route(agents::OWN_DISABLE, post(controller::disable_own))
    .route(agents::OWN_ENABLE, post(controller::enable_own))
    .route(
      agents::ADMIN_COLLECTION,
      get(controller::list).post(controller::create),
    )
    .route(
      agents::ADMIN_ITEM,
      get(controller::get)
        .patch(controller::update)
        .delete(controller::delete),
    )
    .route(agents::ADMIN_REGENERATE, post(controller::regenerate))
    .route(agents::ADMIN_DISABLE, post(controller::disable))
    .route(agents::ADMIN_ENABLE, post(controller::enable))
}
