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
    }
  }

  pub fn validation(errors: BTreeMap<String, String>) -> Self {
    Self {
      status: StatusCode::UNPROCESSABLE_ENTITY,
      errors,
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
    (
      self.status,
      Json(ErrorBody {
        success: false,
        error: self.errors,
      }),
    )
      .into_response()
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
