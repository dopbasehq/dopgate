//! A stand-in for the Pwned Passwords range API.

use std::sync::{Arc, Mutex};

use axum::{
  Router,
  extract::{Path, State},
  http::HeaderMap,
  routing::get,
};
use sha1::{Digest, Sha1};

/// One lookup the server made: the path it asked for and its `Add-Padding`
/// header.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Lookup {
  pub path: String,
  pub padding: Option<String>,
}

#[derive(Clone, Default)]
struct List {
  /// Uppercase SHA-1 hashes on the list, with how often each was seen.
  hashes: Arc<Vec<(String, u64)>>,
  lookups: Arc<Mutex<Vec<Lookup>>>,
}

pub struct FakeBreachList {
  pub url: String,
  list: List,
}

pub fn sha1_hex(password: &str) -> String {
  hex::encode_upper(Sha1::digest(password.as_bytes()))
}

impl FakeBreachList {
  /// A list holding `leaked`, plus `padding`: entries with a count of 0,
  /// which the real API adds so that every answer has a similar size.
  pub async fn start(
    leaked: &[&str],
    padding: &[&str],
  ) -> Self {
    let hashes = leaked
      .iter()
      .map(|password| (sha1_hex(password), 7))
      .chain(padding.iter().map(|password| (sha1_hex(password), 0)))
      .collect();
    let list = List {
      hashes: Arc::new(hashes),
      lookups: Arc::default(),
    };
    let router = Router::new()
      .route("/range/{prefix}", get(range))
      .with_state(list.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move {
      axum::serve(listener, router).await.unwrap();
    });
    Self { url, list }
  }

  /// Every lookup made so far.
  pub fn lookups(&self) -> Vec<Lookup> {
    self.list.lookups.lock().unwrap().clone()
  }
}

async fn range(
  State(list): State<List>,
  Path(prefix): Path<String>,
  headers: HeaderMap,
) -> String {
  list.lookups.lock().unwrap().push(Lookup {
    path: format!("/range/{prefix}"),
    padding: headers
      .get("add-padding")
      .and_then(|value| value.to_str().ok())
      .map(str::to_owned),
  });
  list
    .hashes
    .iter()
    .filter(|(hash, _)| hash.starts_with(&prefix.to_uppercase()))
    .map(|(hash, seen)| format!("{}:{seen}\r\n", &hash[prefix.len()..]))
    .collect()
}
