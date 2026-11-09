use crate::state::AppState;
use axum::{
  Router,
  routing::{get, post},
};

pub mod controller;
pub mod defaults;
pub mod doc;
pub mod error;
pub mod model;
pub mod render;
mod repository;
pub mod service;

pub fn routes() -> Router<AppState> {
  use crate::constants::api::email_templates;
  Router::new()
    .route(email_templates::COLLECTION, get(controller::list))
    .route(
      email_templates::ITEM,
      get(controller::get)
        .put(controller::save)
        .delete(controller::reset),
    )
    .route(email_templates::PREVIEW, post(controller::preview))
    .route(email_templates::TEST, post(controller::test))
}
