//! Request extractors that resolve who is calling.

mod auth;

pub use auth::{AdminIdentity, RootIdentity, UserIdentity};
