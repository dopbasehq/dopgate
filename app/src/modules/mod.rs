use axum::Router;
use utoipa::openapi::OpenApi;

use crate::state::AppState;

pub mod audit;
pub mod auth;
pub mod bootstrap;
pub mod health;
pub mod keys;
pub mod mfa;
pub mod recovery;
pub mod sessions;
pub mod settings;
pub mod sso;
pub mod users;
pub mod verification;

pub fn routes() -> Router<AppState> {
  Router::new()
    .merge(health::routes())
    .merge(bootstrap::routes())
    .merge(auth::routes())
    .merge(recovery::routes())
    .merge(verification::routes())
    .merge(sessions::routes())
    .merge(mfa::routes())
    .merge(sso::routes())
    .merge(users::routes())
    .merge(keys::routes())
    .merge(settings::routes())
    .merge(audit::routes())
}

pub fn openapi() -> OpenApi {
  let mut doc = health::doc::build();
  doc.merge(bootstrap::doc::build());
  doc.merge(auth::doc::build());
  doc.merge(recovery::doc::build());
  doc.merge(verification::doc::build());
  doc.merge(sessions::doc::build());
  doc.merge(mfa::doc::build());
  doc.merge(sso::doc::build());
  doc.merge(users::doc::build());
  doc.merge(keys::doc::build());
  doc.merge(settings::doc::build());
  doc.merge(audit::doc::build());
  doc
}
