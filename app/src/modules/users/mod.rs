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
  use crate::constants::api::users;
  Router::new()
    .route(
      users::COLLECTION,
      get(controller::list).post(controller::create),
    )
    .route(
      users::ITEM,
      get(controller::get)
        .patch(controller::update)
        .delete(controller::delete),
    )
    .route(
      users::SESSIONS,
      get(controller::sessions).delete(controller::revoke_sessions),
    )
    .route(users::DISABLE, post(controller::disable))
    .route(users::ENABLE, post(controller::enable))
    .route(users::PASSWORD_RESET, post(controller::password_reset))
}
