//! Cross-origin requests from your app's frontend.
//!
//! Only the origins in `DOPGATE_ALLOWED_ORIGINS` pass. Apps send tokens in
//! the `Authorization` header, never cookies, so credentials stay off.

use axum::http::{HeaderName, HeaderValue, Method, header};
use tower_http::cors::{AllowOrigin, CorsLayer};

pub fn layer(origins: &[String]) -> CorsLayer {
  let origins: Vec<HeaderValue> = origins
    .iter()
    .filter_map(|origin| HeaderValue::from_str(origin).ok())
    .collect();
  CorsLayer::new()
    .allow_origin(AllowOrigin::list(origins))
    .allow_methods([
      Method::GET,
      Method::POST,
      Method::PUT,
      Method::PATCH,
      Method::DELETE,
    ])
    .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE])
    .expose_headers([header::RETRY_AFTER, HeaderName::from_static("x-request-id")])
    .max_age(std::time::Duration::from_secs(600))
}
