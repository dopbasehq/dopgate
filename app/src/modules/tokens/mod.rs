//! `POST /auth/token`: trading a long-lived token for a short-lived access
//! token. There is no refresh token and no session: trade again when the
//! access token expires.

use crate::state::AppState;
use axum::{Router, routing::post};

pub mod controller;
pub mod doc;
pub mod error;
pub mod model;
pub mod service;

pub fn routes() -> Router<AppState> {
  Router::new().route(crate::constants::api::auth::TOKEN, post(controller::trade))
}
