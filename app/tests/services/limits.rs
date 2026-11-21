use std::time::Duration;

use app::services::limits::Limits;

#[tokio::test]
async fn a_window_allows_its_budget_then_reports_the_wait() {
  let limits = Limits::default();
  for _ in 0..3 {
    assert!(limits.hit("key", 3, Duration::from_secs(60)).await.is_ok());
  }
  let limited = limits
    .hit("key", 3, Duration::from_secs(60))
    .await
    .unwrap_err();
  assert!((1..=60).contains(&limited.retry_after));
  // Other keys have their own budget.
  assert!(
    limits
      .hit("other", 3, Duration::from_secs(60))
      .await
      .is_ok()
  );
}

#[tokio::test]
async fn a_window_resets_after_it_passes() {
  let limits = Limits::default();
  assert!(
    limits
      .hit("key", 1, Duration::from_millis(50))
      .await
      .is_ok()
  );
  assert!(
    limits
      .hit("key", 1, Duration::from_millis(50))
      .await
      .is_err()
  );
  tokio::time::sleep(Duration::from_millis(60)).await;
  assert!(
    limits
      .hit("key", 1, Duration::from_millis(50))
      .await
      .is_ok()
  );
}

#[tokio::test]
async fn reset_clears_a_key() {
  let limits = Limits::default();
  assert!(limits.hit("key", 1, Duration::from_secs(60)).await.is_ok());
  assert!(limits.peek("key", 1).await.is_err());
  limits.reset("key").await;
  assert!(limits.peek("key", 1).await.is_ok());
}
