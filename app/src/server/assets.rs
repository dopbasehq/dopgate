use axum::{
  extract::State,
  http::{StatusCode, Uri},
  response::{IntoResponse, Response},
};

use crate::{
  constants::{api, errors::REQUEST_INVALID},
  http::HttpError,
  state::AppState,
};

/// Serve the Admin UI for any route the API does not own.
pub async fn static_fallback(
  State(state): State<AppState>,
  uri: Uri,
) -> Response {
  if uri.path().starts_with(api::PREFIX) {
    return HttpError::not_found(REQUEST_INVALID, "The requested API route was not found.")
      .into_response();
  }
  if !state.config.web_ui_enabled {
    return HttpError::not_found(REQUEST_INVALID, "The requested route was not found.")
      .into_response();
  }
  embedded_asset(uri.path()).unwrap_or_else(|| {
    // Asset-looking paths must 404 instead of falling back to
    // index.html — serving HTML for a missing .js/.css masks broken
    // asset URLs as a silently blank page.
    if looks_like_asset(uri.path()) {
      return StatusCode::NOT_FOUND.into_response();
    }
    embedded_asset("/index.html").unwrap_or_else(|| StatusCode::NOT_FOUND.into_response())
  })
}

/// The Admin UI build. The folder may not exist yet; the server then has
/// no UI to serve and every page route returns 404.
#[derive(rust_embed::RustEmbed)]
#[folder = "../ui/dist/"]
#[allow_missing = true]
struct AdminAssets;

fn looks_like_asset(path: &str) -> bool {
  const ASSET_EXTENSIONS: [&str; 12] = [
    "js", "mjs", "css", "map", "woff", "woff2", "ttf", "otf", "svg", "png", "jpg", "ico",
  ];
  let name = path.rsplit('/').next().unwrap_or(path);
  name
    .split_once('.')
    .is_some_and(|(_, ext)| ASSET_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
}

fn embedded_asset(path: &str) -> Option<Response> {
  use axum::http::{HeaderValue, header};
  let key = path.trim_start_matches('/');
  let key = if key.is_empty() { "index.html" } else { key };
  let asset = AdminAssets::get(key)?;
  let mime = mime_guess::from_path(key).first_or_octet_stream();
  let mut response = asset.data.into_owned().into_response();
  response.headers_mut().insert(
    header::CONTENT_TYPE,
    HeaderValue::from_str(mime.as_ref()).ok()?,
  );
  let cache = if key == "index.html" {
    "no-cache"
  } else {
    "public, max-age=31536000, immutable"
  };
  response
    .headers_mut()
    .insert(header::CACHE_CONTROL, HeaderValue::from_static(cache));
  Some(response)
}
