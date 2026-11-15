//! The router around the modules: error shapes, headers, CORS, and the
//! console fallback.

use axum::http::{Method, StatusCode, header};

use crate::support::TestApp;

#[tokio::test]
async fn responses_carry_hardening_headers_and_a_request_id() {
  let app = TestApp::new().await;
  let reply = app.send(Method::GET, "/api/v1/health", &[], "").await;
  let header = |name: &str| {
    reply
      .headers
      .get(name)
      .unwrap()
      .to_str()
      .unwrap()
      .to_owned()
  };
  assert_eq!(header("x-content-type-options"), "nosniff");
  assert_eq!(header("x-frame-options"), "DENY");
  assert_eq!(header("referrer-policy"), "no-referrer");
  assert_eq!(header("cache-control"), "no-store");
  assert!(header("content-security-policy").contains("frame-ancestors 'none'"));
  assert!(!header("x-request-id").is_empty());
}

#[tokio::test]
async fn malformed_json_gets_a_json_error() {
  let app = TestApp::new().await;
  let reply = app
    .send(
      Method::POST,
      "/api/v1/auth/login",
      &[(header::CONTENT_TYPE.as_str(), "application/json")],
      "{",
    )
    .await;
  assert_eq!(reply.status, StatusCode::BAD_REQUEST);
  assert!(reply.json["error"]["REQUEST_INVALID"].is_string());
  assert_eq!(reply.json["success"], false);
}

#[tokio::test]
async fn unknown_routes_and_wrong_methods_get_json_errors() {
  let app = TestApp::new().await;
  let reply = app
    .send(Method::GET, "/api/v1/no-such-route", &[], "")
    .await;
  assert_eq!(reply.status, StatusCode::NOT_FOUND);
  assert!(reply.json["error"]["REQUEST_INVALID"].is_string());

  let reply = app.send(Method::DELETE, "/api/v1/health", &[], "").await;
  assert_eq!(reply.status, StatusCode::METHOD_NOT_ALLOWED);
  assert!(reply.json["error"]["REQUEST_INVALID"].is_string());
}

#[tokio::test]
async fn pages_are_not_served_while_the_web_ui_is_off() {
  let app = TestApp::with(|config| config.web_ui_enabled = false).await;
  let reply = app.send(Method::GET, "/sign-in", &[], "").await;
  assert_eq!(reply.status, StatusCode::NOT_FOUND);
  assert!(reply.json["error"]["REQUEST_INVALID"].is_string());
}

#[tokio::test]
async fn missing_assets_are_404_not_the_page() {
  let app = TestApp::new().await;
  let reply = app
    .send(Method::GET, "/assets/missing-file.js", &[], "")
    .await;
  assert_eq!(reply.status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn allowed_origins_pass_cors_and_others_do_not() {
  let app = TestApp::with(|config| {
    config.allowed_origins = vec!["https://app.example.com".into()];
  })
  .await;
  let preflight = |origin: &'static str| {
    let app = &app;
    async move {
      app
        .send(
          Method::OPTIONS,
          "/api/v1/auth/login",
          &[
            ("origin", origin),
            ("access-control-request-method", "POST"),
            ("access-control-request-headers", "content-type"),
          ],
          "",
        )
        .await
    }
  };
  let allowed = preflight("https://app.example.com").await;
  assert_eq!(
    allowed.headers.get("access-control-allow-origin").unwrap(),
    "https://app.example.com"
  );
  let refused = preflight("https://evil.example.com").await;
  assert!(refused.headers.get("access-control-allow-origin").is_none());
}

/// An error message can end up in front of a person: an app may show it as
/// it is, and a backend that signs people in for them passes it on. So a
/// message says what happened in plain words. It never names one of
/// Dopgate's routes, which mean nothing to someone using another app's
/// pages. What a developer should call is in the docs for the error code.
#[test]
fn error_messages_name_no_routes() {
  fn sources(
    dir: &std::path::Path,
    found: &mut Vec<std::path::PathBuf>,
  ) {
    for entry in std::fs::read_dir(dir).unwrap() {
      let path = entry.unwrap().path();
      if path.is_dir() {
        sources(&path, found);
      } else if path.extension().is_some_and(|extension| extension == "rs") {
        found.push(path);
      }
    }
  }
  let src = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
  let mut files = Vec::new();
  for folder in ["modules", "middlewares", "extractors", "http"] {
    sources(&src.join(folder), &mut files);
  }
  assert!(files.len() > 40, "the source folders moved");

  let mut offenders = Vec::new();
  for file in files {
    // Handlers and API docs describe routes on purpose. Messages are made
    // in services, middleware and extractors.
    let name = file.file_name().unwrap().to_str().unwrap();
    if matches!(name, "controller.rs" | "doc.rs" | "mod.rs" | "model.rs") {
      continue;
    }
    let code = std::fs::read_to_string(&file).unwrap();
    for (number, line) in code.lines().enumerate() {
      if line.trim_start().starts_with("//") {
        continue;
      }
      // The odd pieces of a line split on quotes are its string literals.
      let names_a_route = line.split('"').skip(1).step_by(2).any(|literal| {
        ["/auth/", "/console/", "/admin/", "/api/"]
          .iter()
          .any(|route| literal.contains(route))
      });
      if names_a_route {
        offenders.push(format!(
          "{}:{}: {}",
          file.display(),
          number + 1,
          line.trim()
        ));
      }
    }
  }
  assert!(
    offenders.is_empty(),
    "messages that name a route:\n{}",
    offenders.join("\n")
  );
}
