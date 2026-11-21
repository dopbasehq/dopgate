//! Capabilities: the flat key-value pairs an owner sets on an agent. They go
//! into the agent's access token, so they stay small and flat. Dopgate
//! stores them and never enforces them; your app decides what they mean.

use axum::http::StatusCode;
use serde_json::Value;

use crate::{constants::errors::CAPABILITIES_INVALID, http::HttpError};

const KEY_MAX_CHARS: usize = 64;
const LIST_MAX_ITEMS: usize = 100;
/// The whole object, as JSON.
pub const MAX_BYTES: usize = 4096;

fn refused(message: &str) -> HttpError {
  HttpError::new(
    StatusCode::UNPROCESSABLE_ENTITY,
    CAPABILITIES_INVALID,
    message,
  )
}

fn valid_key(key: &str) -> bool {
  !key.is_empty()
    && key.chars().count() <= KEY_MAX_CHARS
    && key
      .chars()
      .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | ':'))
}

/// Check that `value` is a flat object: keys of letters, digits, `_`, `.`,
/// or `:`, and values that are a string, number, true/false, or a list of
/// strings, 4 KB at most.
pub fn check(value: Value) -> Result<Value, HttpError> {
  let Value::Object(map) = &value else {
    return Err(refused("Capabilities must be a JSON object."));
  };
  for (key, item) in map {
    if !valid_key(key) {
      return Err(refused(&format!(
        "`{key}` isn't a valid key. Use 1 to 64 letters, digits, `_`, `.`, or `:`."
      )));
    }
    let ok = match item {
      Value::String(_) | Value::Number(_) | Value::Bool(_) => true,
      Value::Array(items) => items.len() <= LIST_MAX_ITEMS && items.iter().all(Value::is_string),
      Value::Null | Value::Object(_) => false,
    };
    if !ok {
      return Err(refused(&format!(
        "`{key}` must be a string, a number, true or false, or a list of up to 100 strings."
      )));
    }
  }
  if value.to_string().len() > MAX_BYTES {
    return Err(refused("Capabilities must be 4 KB or less."));
  }
  Ok(value)
}
