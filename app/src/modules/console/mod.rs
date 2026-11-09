//! Console sign-in and the signed-in admin's own account. These mirror the
//! account endpoints of `/api/v1/auth` in the console realm: they only find
//! admins, keep their own sessions, codes, and cookie, and return console
//! tokens, which no backend can verify.

use crate::state::AppState;
use axum::{
  Router,
  routing::{delete, get, post},
};

pub mod controller;
pub mod doc;
pub mod error;
pub mod model;
pub mod service;

pub fn routes() -> Router<AppState> {
  use crate::constants::api::console;
  Router::new()
    .route(console::LOGIN, post(controller::login))
    .route(console::REFRESH, post(controller::refresh))
    .route(console::LOGOUT, post(controller::logout))
    .route(console::CODES_SEND, post(controller::send_code))
    .route(console::CODES_CONFIRM, post(controller::confirm_code))
    .route(console::PASSWORD_FORGOT, post(controller::forgot_password))
    .route(console::PASSWORD_RESET, post(controller::reset_password))
    .route(console::PASSWORD_CHANGE, post(controller::change_password))
    .route(
      console::ME,
      get(controller::me).patch(controller::update_me),
    )
    .route(console::EMAIL_CHANGE, post(controller::change_email))
    .route(
      console::SESSIONS,
      get(controller::sessions).delete(controller::revoke_sessions),
    )
    .route(console::SESSION, delete(controller::revoke_session))
}
