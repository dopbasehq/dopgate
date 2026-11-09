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
  use crate::constants::api::personal_tokens;
  Router::new()
    .route(
      personal_tokens::COLLECTION,
      get(controller::list).post(controller::create),
    )
    .route(personal_tokens::ITEM, delete(controller::delete))
    .route(
      personal_tokens::ADMIN_COLLECTION,
      get(controller::admin_list),
    )
    .route(
      personal_tokens::ADMIN_ITEM,
      delete(controller::admin_revoke),
    )
}
