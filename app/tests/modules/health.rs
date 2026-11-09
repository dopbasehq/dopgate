use axum::http::{Method, StatusCode};

use crate::support::TestApp;

#[tokio::test]
async fn health_reports_dopgate() {
  let app = TestApp::new().await;
  let (status, body) = app.request(Method::GET, "/api/v1/health", None).await;
  assert_eq!(status, StatusCode::OK);
  assert_eq!(body["data"]["product"], "dopgate");
  assert_eq!(body["data"]["status"], "ok");
  assert_eq!(body["data"]["database"], "ok");
  assert_eq!(body["data"]["version"], env!("CARGO_PKG_VERSION"));
}
