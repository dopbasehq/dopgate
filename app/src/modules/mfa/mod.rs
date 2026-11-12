use crate::state::AppState;
use axum::{
  Router,
  routing::{delete, post},
};
pub mod controller;
pub mod doc;
pub mod error;
pub mod model;
mod repository;
pub mod service;
pub fn routes() -> Router<AppState> {
  use crate::constants::api::mfa;
  Router::new()
    .route(mfa::TOTP_ENROLL, post(controller::enroll))
    .route(mfa::TOTP_VERIFY, post(controller::verify))
    .route(mfa::TOTP, delete(controller::remove))
    .route(mfa::CHALLENGE, post(controller::challenge))
}
