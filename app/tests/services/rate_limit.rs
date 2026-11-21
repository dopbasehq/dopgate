use app::services::rate_limit::RateLimiter;

#[tokio::test]
async fn five_failures_lock_a_key_until_cleared() {
  let limiter = RateLimiter::default();
  for _ in 0..4 {
    limiter.failure("setup:203.0.113.1").await;
  }
  assert!(limiter.check("setup:203.0.113.1").await);
  limiter.failure("setup:203.0.113.1").await;
  assert!(!limiter.check("setup:203.0.113.1").await);
  // Other keys are not affected.
  assert!(limiter.check("setup:203.0.113.2").await);
  limiter.clear("setup:203.0.113.1").await;
  assert!(limiter.check("setup:203.0.113.1").await);
}

/// A flood of new keys cannot grow the map without bound: past the hard
/// limit, keys without a bucket are refused.
#[tokio::test]
async fn a_full_limiter_refuses_new_keys() {
  let limiter = RateLimiter::with_capacity(2, 2);
  for key in ["a", "b"] {
    for _ in 0..5 {
      limiter.failure(key).await;
    }
  }
  assert!(!limiter.check("c").await);
}
