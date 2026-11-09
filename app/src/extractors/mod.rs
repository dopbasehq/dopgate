//! Request extractors that resolve who is calling.

mod auth;
mod context;

pub use auth::{AdminIdentity, RootIdentity, UserIdentity};
pub use context::{RequestContext, SessionMode};
