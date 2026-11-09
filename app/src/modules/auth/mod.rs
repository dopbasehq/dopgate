use crate::state::AppState;
use axum::{
  Router,
  routing::{get, post},
};

pub mod controller;
pub mod doc;
pub mod error;
pub mod model;
pub mod service;

pub fn routes() -> Router<AppState> {
  use crate::constants::api::auth;
  Router::new()
    .route(auth::METHODS, get(controller::methods))
    .route(auth::SIGNUP, post(controller::signup))
    .route(auth::LOGIN, post(controller::login))
    .route(auth::REFRESH, post(controller::refresh))
    .route(auth::LOGOUT, post(controller::logout))
    .route(auth::ME, get(controller::me).patch(controller::update_me))
    .route(auth::PASSWORD_CHANGE, post(controller::change_password))
}
