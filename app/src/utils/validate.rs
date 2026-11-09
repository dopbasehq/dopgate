//! Input checks shared by the account endpoints. Each returns a 422 with a
//! message the app can show as is.

use axum::http::StatusCode;
use serde_json::Value;

use crate::{
  constants::{
    errors::{
      EMAIL_INVALID, EMAIL_INVALID_MESSAGE, METADATA_INVALID, PASSWORD_INVALID, PROFILE_INVALID,
    },
    limits::{METADATA_MAX_BYTES, TEXT_MAX_CHARS, URL_MAX_CHARS},
  },
  http::HttpError,
  services::password,
  utils::email as email_utils,
};

fn unprocessable(
  code: &str,
  message: impl Into<String>,
) -> HttpError {
  HttpError::new(StatusCode::UNPROCESSABLE_ENTITY, code, message)
}

/// A normalized email address.
pub fn email(raw: &str) -> Result<String, HttpError> {
  email_utils::normalize(raw).ok_or_else(|| unprocessable(EMAIL_INVALID, EMAIL_INVALID_MESSAGE))
}

/// A new password against the policy.
pub fn new_password(
  raw: &str,
  min_length: u32,
) -> Result<(), HttpError> {
  password::check_policy_with(raw, min_length as usize)
    .map_err(|violation| unprocessable(PASSWORD_INVALID, violation.0))
}

/// `Some(None)` clears the name; text is trimmed and kept to one line.
pub fn display_name(raw: Option<String>) -> Result<Option<Option<String>>, HttpError> {
  let Some(raw) = raw else {
    return Ok(None);
  };
  let value = raw.trim();
  if value.is_empty() {
    return Ok(Some(None));
  }
  if value.chars().count() > TEXT_MAX_CHARS || value.chars().any(char::is_control) {
    return Err(unprocessable(
      PROFILE_INVALID,
      "The display name must be one line of at most 255 characters.",
    ));
  }
  Ok(Some(Some(value.to_owned())))
}

/// `Some(None)` clears the avatar; otherwise an http(s) URL.
pub fn avatar_url(raw: Option<String>) -> Result<Option<Option<String>>, HttpError> {
  let Some(raw) = raw else {
    return Ok(None);
  };
  let value = raw.trim();
  if value.is_empty() {
    return Ok(Some(None));
  }
  let valid = value.chars().count() <= URL_MAX_CHARS
    && url::Url::parse(value).is_ok_and(|url| matches!(url.scheme(), "https" | "http"));
  if !valid {
    return Err(unprocessable(
      PROFILE_INVALID,
      "The avatar URL must start with https:// or http://.",
    ));
  }
  Ok(Some(Some(value.to_owned())))
}

/// A metadata object of at most 16 KB.
pub fn metadata(
  name: &str,
  value: Value,
) -> Result<Value, HttpError> {
  if !value.is_object() {
    return Err(unprocessable(
      METADATA_INVALID,
      format!("{name} must be a JSON object."),
    ));
  }
  if value.to_string().len() > METADATA_MAX_BYTES {
    return Err(unprocessable(
      METADATA_INVALID,
      format!("{name} must be at most 16 KB."),
    ));
  }
  Ok(value)
}
