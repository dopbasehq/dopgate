//! Request extractors that resolve who is calling.

mod auth;
mod client;

pub use auth::{AdminIdentity, RootIdentity};
pub use client::{CLIENT_KEY_HEADER, ClientKey};
