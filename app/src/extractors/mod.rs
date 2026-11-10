//! Request extractors that resolve who is calling.

mod auth;
mod context;

pub use auth::{AdminIdentity, ConsoleIdentity, RootIdentity, UserIdentity};
pub use context::{RequestContext, SessionMode};
