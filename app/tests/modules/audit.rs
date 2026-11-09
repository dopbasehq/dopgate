//! The audit list and verify services, and their routes.

use app::modules::audit::{
  model::{AuditQuery, ChainVerifyQuery},
  service::{self, Event},
};
use axum::http::StatusCode;

use crate::support::TestApp;

async fn record(
  app: &TestApp,
  action: &str,
  actor: &str,
) {
  let mut tx = app.state.db.pool().begin().await.unwrap();
  service::record(
    &mut tx,
    Event {
      actor_type: "admin",
      actor_id: Some(actor),
      actor_label: Some(actor),
      action,
      resource_type: None,
      resource_id: None,
      metadata: serde_json::json!({}),
    },
  )
  .await
  .unwrap();
  tx.commit().await.unwrap();
}

fn query(
  cursor: Option<String>,
  limit: u32,
  action: Option<&str>,
  actor: Option<&str>,
) -> AuditQuery {
  AuditQuery {
    cursor,
    limit: Some(limit),
    action: action.map(str::to_owned),
    actor: actor.map(str::to_owned),
  }
}

#[tokio::test]
async fn list_pages_newest_first_without_gaps() {
  let app = TestApp::new().await;
  for index in 0..5 {
    record(&app, &format!("test.event{index}"), "usr_a").await;
  }
  let mut seen = Vec::new();
  let mut cursor = None;
  loop {
    let page = service::list(&app.state, query(cursor, 2, None, None))
      .await
      .unwrap();
    assert!(page.items.len() <= 2);
    seen.extend(page.items.into_iter().map(|item| item.action));
    match page.next_cursor {
      Some(next) => cursor = Some(next),
      None => break,
    }
  }
  assert_eq!(
    seen,
    [
      "test.event4",
      "test.event3",
      "test.event2",
      "test.event1",
      "test.event0"
    ]
  );
}

#[tokio::test]
async fn list_filters_by_action_and_actor() {
  let app = TestApp::new().await;
  record(&app, "user.created", "usr_a").await;
  record(&app, "user.deleted", "usr_a").await;
  record(&app, "user.created", "usr_b").await;

  let page = service::list(&app.state, query(None, 50, Some("user.created"), None))
    .await
    .unwrap();
  assert_eq!(page.items.len(), 2);

  let page = service::list(&app.state, query(None, 50, None, Some("usr_b")))
    .await
    .unwrap();
  assert_eq!(page.items.len(), 1);
  assert_eq!(page.items[0].action, "user.created");
  assert!(page.items[0].seq.is_some());
}

#[tokio::test]
async fn list_refuses_a_forged_cursor() {
  let app = TestApp::new().await;
  let error = service::list(
    &app.state,
    query(Some("not base64!".into()), 10, None, None),
  )
  .await
  .err()
  .unwrap();
  assert_eq!(error.status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn verify_checks_an_anchor_and_refuses_half_of_one() {
  let app = TestApp::new().await;
  record(&app, "test.event", "usr_a").await;
  let report = service::verify(
    &app.state,
    ChainVerifyQuery {
      anchor_seq: None,
      anchor_hash: None,
    },
  )
  .await
  .unwrap();
  assert!(report.ok);

  let report = service::verify(
    &app.state,
    ChainVerifyQuery {
      anchor_seq: report.head_seq,
      anchor_hash: report.head_hash,
    },
  )
  .await
  .unwrap();
  assert!(report.ok);
  assert!(report.anchor.is_some());

  let error = service::verify(
    &app.state,
    ChainVerifyQuery {
      anchor_seq: Some(1),
      anchor_hash: None,
    },
  )
  .await
  .err()
  .unwrap();
  assert_eq!(error.status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn admins_read_the_log_over_http_and_members_do_not() {
  let app = TestApp::new().await;
  let root = app.root_token().await;
  let (status, body) = app
    .request_with(
      axum::http::Method::GET,
      "/api/v1/admin/audit-events?action=user.signed_in",
      None,
      Some(&root),
    )
    .await;
  assert_eq!(status, StatusCode::OK);
  assert_eq!(body["data"]["items"][0]["action"], "user.signed_in");
  assert_eq!(body["data"]["items"][0]["metadata"]["method"], "password");

  let (status, body) = app
    .request_with(
      axum::http::Method::GET,
      "/api/v1/admin/audit-events/verify",
      None,
      Some(&root),
    )
    .await;
  assert_eq!(status, StatusCode::OK);
  assert_eq!(body["data"]["ok"], true, "{body}");

  app.create_user(&root, "member@example.com", "member").await;
  let member = app
    .login("member@example.com", crate::support::PASSWORD)
    .await;
  let (status, _) = app
    .request_with(
      axum::http::Method::GET,
      "/api/v1/admin/audit-events",
      None,
      Some(&member),
    )
    .await;
  assert_eq!(status, StatusCode::FORBIDDEN);
}
