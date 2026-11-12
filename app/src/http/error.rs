use std::collections::BTreeMap;

use axum::{
  Json,
  http::StatusCode,
  response::{IntoResponse, Response},
};
use serde::Serialize;
use utoipa::ToSchema;

use crate::constants::errors::{INTERNAL_ERROR, NOT_IMPLEMENTED, NOT_IMPLEMENTED_MESSAGE};

#[derive(Clone, Debug, Serialize, ToSchema)]
pub struct ErrorBody {
  pub success: bool,
  pub error: BTreeMap<String, String>,
}

#[derive(Debug)]
pub struct HttpError {
  pub status: StatusCode,
  pub errors: BTreeMap<String, String>,
  /// Seconds to wait, sent as `Retry-After` on 429 responses.
  pub retry_after: Option<u64>,
}

impl HttpError {
  pub fn new(
    status: StatusCode,
    code: impl Into<String>,
    message: impl Into<String>,
  ) -> Self {
    Self {
      status,
      errors: BTreeMap::from([(code.into(), message.into())]),
      retry_after: None,
    }
  }

  pub fn validation(errors: BTreeMap<String, String>) -> Self {
    Self {
      status: StatusCode::UNPROCESSABLE_ENTITY,
      errors,
      retry_after: None,
    }
  }

  pub fn bad_request(
    code: &str,
    message: &str,
  ) -> Self {
    Self::new(StatusCode::BAD_REQUEST, code, message)
  }
  pub fn unauthorized(
    code: &str,
    message: &str,
  ) -> Self {
    Self::new(StatusCode::UNAUTHORIZED, code, message)
  }
  pub fn forbidden(
    code: &str,
    message: &str,
  ) -> Self {
    Self::new(StatusCode::FORBIDDEN, code, message)
  }
  pub fn not_found(
    code: &str,
    message: &str,
  ) -> Self {
    Self::new(StatusCode::NOT_FOUND, code, message)
  }
  pub fn conflict(
    code: &str,
    message: &str,
  ) -> Self {
    Self::new(StatusCode::CONFLICT, code, message)
  }
  /// A planned endpoint whose feature is not built yet.
  pub fn not_implemented() -> Self {
    Self::new(
      StatusCode::NOT_IMPLEMENTED,
      NOT_IMPLEMENTED,
      NOT_IMPLEMENTED_MESSAGE,
    )
  }
  /// Too many requests. The message says how long to wait.
  pub fn rate_limited(retry_after: u64) -> Self {
    let wait = if retry_after >= 120 {
      format!("{} minutes", retry_after.div_ceil(60))
    } else {
      format!("{retry_after} seconds")
    };
    let mut error = Self::new(
      StatusCode::TOO_MANY_REQUESTS,
      crate::constants::errors::RATE_LIMITED,
      format!("Too many attempts. Try again in {wait}."),
    );
    error.retry_after = Some(retry_after);
    error
  }

  pub fn internal() -> Self {
    Self::new(
      StatusCode::INTERNAL_SERVER_ERROR,
      INTERNAL_ERROR,
      "An internal error occurred.",
    )
  }
}

impl IntoResponse for HttpError {
  fn into_response(self) -> Response {
    let mut response = (
      self.status,
      Json(ErrorBody {
        success: false,
        error: self.errors,
      }),
    )
      .into_response();
    if let Some(seconds) = self.retry_after
      && let Ok(value) = axum::http::HeaderValue::from_str(&seconds.to_string())
    {
      response
        .headers_mut()
        .insert(axum::http::header::RETRY_AFTER, value);
    }
    response
  }
}

impl std::fmt::Display for HttpError {
  fn fmt(
    &self,
    formatter: &mut std::fmt::Formatter<'_>,
  ) -> std::fmt::Result {
    let message = self
      .errors
      .values()
      .next()
      .map(String::as_str)
      .unwrap_or("request failed");
    formatter.write_str(message)
  }
}

impl std::error::Error for HttpError {}

impl From<sqlx::Error> for HttpError {
  fn from(error: sqlx::Error) -> Self {
    tracing::error!(%error, "database operation failed");
    Self::internal()
  }
}
