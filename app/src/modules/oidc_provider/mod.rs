//! dopgate as an OpenID Connect provider, so other apps can offer "Sign in
//! with dopgate". Planned (phase 9).

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
  use crate::constants::api::oidc_provider;
  Router::new()
    .route(oidc_provider::DISCOVERY, get(controller::discovery))
    .route(oidc_provider::AUTHORIZE, get(controller::authorize))
    .route(oidc_provider::TOKEN, post(controller::token))
    .route(oidc_provider::USERINFO, get(controller::userinfo))
}
