use axum::Router;
use utoipa::openapi::OpenApi;

use crate::state::AppState;

pub mod accounts;
pub mod admins;
pub mod audit;
pub mod auth;
pub mod bootstrap;
pub mod console;
pub mod email_templates;
pub mod health;
pub mod keys;
pub mod mfa;
pub mod personal_tokens;
pub mod recovery;
pub mod sessions;
pub mod settings;
pub mod sso;
pub mod tokens;
pub mod users;
pub mod verification;

pub fn routes() -> Router<AppState> {
  Router::new()
    .merge(health::routes())
    .merge(bootstrap::routes())
    .merge(auth::routes())
    .merge(console::routes())
    .merge(tokens::routes())
    .merge(personal_tokens::routes())
    .merge(recovery::routes())
    .merge(verification::routes())
    .merge(sessions::routes())
    .merge(mfa::routes())
    .merge(sso::routes())
    .merge(users::routes())
    .merge(admins::routes())
    .merge(keys::routes())
    .merge(settings::routes())
    .merge(email_templates::routes())
    .merge(audit::routes())
}

/// The API description served at `/api/docs`. It lists only modules that
/// work today; planned ones live in [`planned_openapi`] until they are built.
pub fn openapi() -> OpenApi {
  let mut doc = health::doc::build();
  doc.merge(bootstrap::doc::build());
  doc.merge(auth::doc::build());
  doc.merge(console::doc::build());
  doc.merge(tokens::doc::build());
  doc.merge(personal_tokens::doc::build());
  doc.merge(recovery::doc::build());
  doc.merge(verification::doc::build());
  doc.merge(sessions::doc::build());
  doc.merge(users::doc::build());
  doc.merge(admins::doc::build());
  doc.merge(keys::doc::build());
  doc.merge(settings::doc::build());
  doc.merge(email_templates::doc::build());
  doc.merge(audit::doc::build());
  doc
}

/// Modules whose routes exist but answer `501 NOT_IMPLEMENTED`. Kept out of
/// the served docs; move a module into [`openapi`] once it works.
pub fn planned_openapi() -> OpenApi {
  let mut doc = mfa::doc::build();
  doc.merge(sso::doc::build());
  doc
}
