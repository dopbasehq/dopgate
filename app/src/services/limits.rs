//! Request limits: fixed windows counted in memory.
//!
//! Dopgate runs as one process per app, so counters live in memory and a
//! restart resets them. Account lockout, which has to survive a restart,
//! is stored on the user row instead.

use std::{
  collections::HashMap,
  sync::Arc,
  time::{Duration, Instant},
};

use tokio::sync::Mutex;

/// Past this many buckets, expired ones are swept before a new one is added.
const SWEEP_AT: usize = 50_000;

#[derive(Clone, Default)]
pub struct Limits {
  buckets: Arc<Mutex<HashMap<String, Bucket>>>,
}

struct Bucket {
  count: u32,
  started: Instant,
  window: Duration,
}

impl Bucket {
  fn expired(&self) -> bool {
    self.started.elapsed() >= self.window
  }
}

/// A limit was hit. Holds the seconds until the window resets.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Limited {
  pub retry_after: u64,
}

impl Limits {
  /// Count one request under `key`, allowing `max` per `window`.
  pub async fn hit(
    &self,
    key: &str,
    max: u32,
    window: Duration,
  ) -> Result<(), Limited> {
    let mut buckets = self.buckets.lock().await;
    if buckets.len() >= SWEEP_AT {
      buckets.retain(|_, bucket| !bucket.expired());
    }
    let bucket = buckets.entry(key.to_owned()).or_insert(Bucket {
      count: 0,
      started: Instant::now(),
      window,
    });
    if bucket.expired() {
      *bucket = Bucket {
        count: 0,
        started: Instant::now(),
        window,
      };
    }
    if bucket.count >= max.max(1) {
      let left = bucket.window.saturating_sub(bucket.started.elapsed());
      return Err(Limited {
        retry_after: left.as_secs().max(1),
      });
    }
    bucket.count += 1;
    Ok(())
  }

  /// Check `key` without counting.
  pub async fn peek(
    &self,
    key: &str,
    max: u32,
  ) -> Result<(), Limited> {
    let buckets = self.buckets.lock().await;
    match buckets.get(key) {
      Some(bucket) if !bucket.expired() && bucket.count >= max.max(1) => Err(Limited {
        retry_after: bucket
          .window
          .saturating_sub(bucket.started.elapsed())
          .as_secs()
          .max(1),
      }),
      _ => Ok(()),
    }
  }

  pub async fn reset(
    &self,
    key: &str,
  ) {
    self.buckets.lock().await.remove(key);
  }
}
