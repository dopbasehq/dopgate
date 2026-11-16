//! Access tokens as a backend sees them: verified offline with the JWKS.

use axum::http::{Method, StatusCode};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode, decode_header};
use serde_json::{Value, json};

use crate::support::TestApp;

async fn jwks(app: &TestApp) -> Value {
  app
    .send(Method::GET, "/.well-known/jwks.json", &[], "")
    .await
    .json
}

fn verify_offline(
  token: &str,
  jwks: &Value,
  issuer: &str,
) -> Result<Value, jsonwebtoken::errors::Error> {
  let kid = decode_header(token)?.kid.unwrap();
  let key = jwks["keys"]
    .as_array()
    .unwrap()
    .iter()
    .find(|key| key["kid"] == kid.as_str())
    .expect("the token's key is in the key set");
  let decoding =
    DecodingKey::from_ec_components(key["x"].as_str().unwrap(), key["y"].as_str().unwrap())?;
  let mut rules = Validation::new(Algorithm::ES256);
  rules.set_issuer(&[issuer]);
  // The audience is the same URL as the issuer.
  rules.set_audience(&[issuer]);
  rules.set_required_spec_claims(&["exp", "iss", "sub", "aud"]);
  Ok(decode::<Value>(token, &decoding, &rules)?.claims)
}

/// A user of your app, signed in, and their access token.
async fn user_token(app: &TestApp) -> String {
  let root = app.root_token().await;
  app.create_user(&root, "ada@example.com").await;
  app.login("ada@example.com", crate::support::PASSWORD).await
}

#[tokio::test]
async fn a_backend_verifies_tokens_with_the_key_set() {
  let app = TestApp::new().await;
  let token = user_token(&app).await;
  let claims = verify_offline(&token, &jwks(&app).await, app.state.config.issuer()).unwrap();
  assert!(claims["sub"].as_str().unwrap().starts_with("usr_"));
  assert!(claims["sid"].as_str().unwrap().starts_with("ses_"));
  assert_eq!(claims["iss"], app.state.config.issuer());
  assert_eq!(claims["aud"], app.state.config.issuer());
  assert!(claims["jti"].as_str().unwrap().starts_with("jti_"));
  assert_eq!(claims["kind"], "human");
  assert!(claims.get("role").is_none());
  // Nothing was recorded about this person, so the claim is left out.
  assert!(claims.get("public_metadata").is_none());
  assert_eq!(claims["email_verified"], true);
  assert!(claims["exp"].as_i64().unwrap() > claims["iat"].as_i64().unwrap());
}

#[tokio::test]
async fn a_token_carries_what_the_backend_recorded() {
  let app = TestApp::new().await;
  let root = app.root_token().await;
  let id = app.create_user(&root, "ada@example.com").await;
  let (status, body) = app
    .request_with(
      Method::PATCH,
      &format!("/api/v1/admin/users/{id}"),
      Some(json!({
        "publicMetadata": { "role": "manager", "plan": "pro" },
        "privateMetadata": { "note": "private-marker" },
      })),
      Some(&root),
    )
    .await;
  assert_eq!(status, StatusCode::OK, "{body}");
  let session = app.login("ada@example.com", crate::support::PASSWORD).await;
  let (status, body) = app
    .request_with(
      Method::PATCH,
      "/api/v1/auth/me",
      Some(json!({ "userMetadata": { "theme": "user-marker" } })),
      Some(&session),
    )
    .await;
  assert_eq!(status, StatusCode::OK, "{body}");

  let token = app.login("ada@example.com", crate::support::PASSWORD).await;
  let claims = verify_offline(&token, &jwks(&app).await, app.state.config.issuer()).unwrap();
  // A backend reads the role without calling Dopgate.
  assert_eq!(
    claims["public_metadata"],
    json!({ "role": "manager", "plan": "pro" })
  );
  // What only admins see, and what the user wrote, stay out of the token.
  let everything = claims.to_string();
  assert!(!everything.contains("private-marker"), "{everything}");
  assert!(!everything.contains("user-marker"), "{everything}");
}

#[tokio::test]
async fn every_token_has_its_own_id() {
  let app = TestApp::new().await;
  let first = user_token(&app).await;
  let second = app.login("ada@example.com", crate::support::PASSWORD).await;
  let set = jwks(&app).await;
  let issuer = app.state.config.issuer();
  let first = verify_offline(&first, &set, issuer).unwrap();
  let second = verify_offline(&second, &set, issuer).unwrap();
  assert_ne!(first["jti"], second["jti"]);
}

#[tokio::test]
async fn a_token_for_another_audience_is_refused() {
  let app = TestApp::new().await;
  let token = user_token(&app).await;
  let payload = URL_SAFE_NO_PAD
    .decode(token.split('.').nth(1).unwrap())
    .unwrap();
  let mut claims: app::models::AccessClaims = serde_json::from_slice(&payload).unwrap();

  // Signed again with the real key and nothing changed, it still works.
  let same = app::services::jwt::sign(&app.state, &claims).await.unwrap();
  let (status, _) = app
    .request_with(Method::GET, "/api/v1/auth/me", None, Some(&same))
    .await;
  assert_eq!(status, StatusCode::OK);

  // The same token made out to someone else does not, here or in a backend.
  claims.aud = "https://another.example.com".into();
  let other = app::services::jwt::sign(&app.state, &claims).await.unwrap();
  let (status, body) = app
    .request_with(Method::GET, "/api/v1/auth/me", None, Some(&other))
    .await;
  assert_eq!(status, StatusCode::UNAUTHORIZED);
  assert!(body["error"]["TOKEN_INVALID"].is_string());
  assert!(verify_offline(&other, &jwks(&app).await, app.state.config.issuer()).is_err());
}

#[tokio::test]
async fn the_discovery_document_points_at_the_key_set() {
  let app = TestApp::new().await;
  let reply = app
    .send(Method::GET, "/.well-known/openid-configuration", &[], "")
    .await;
  assert_eq!(reply.status, StatusCode::OK);
  assert_eq!(reply.headers["cache-control"], "public, max-age=300");
  let issuer = app.state.config.issuer();
  assert_eq!(
    reply.json,
    json!({
      "issuer": issuer,
      "jwks_uri": format!("{issuer}/.well-known/jwks.json"),
      "response_types_supported": ["id_token"],
      "subject_types_supported": ["public"],
      "id_token_signing_alg_values_supported": ["ES256"],
    }),
    "five fields and nothing that claims a sign-in page"
  );

  // A tool that starts from the issuer of a token ends up at the keys that
  // verify it.
  let token = user_token(&app).await;
  let path = reply.json["jwks_uri"]
    .as_str()
    .unwrap()
    .strip_prefix(issuer)
    .unwrap();
  let set = app.send(Method::GET, path, &[], "").await.json;
  let claims = verify_offline(&token, &set, reply.json["issuer"].as_str().unwrap()).unwrap();
  assert_eq!(claims["iss"], reply.json["issuer"]);
}

#[tokio::test]
async fn no_backend_can_verify_a_console_token() {
  let app = TestApp::new().await;
  let console = app.root_token().await;
  let header = decode_header(&console).unwrap();
  assert_eq!(header.alg, Algorithm::HS256);
  let set = jwks(&app).await;
  let kid = header.kid.unwrap();
  assert!(
    set["keys"]
      .as_array()
      .unwrap()
      .iter()
      .all(|key| key["kid"] != kid.as_str()),
    "the console key must never be in the key set"
  );
}

#[tokio::test]
async fn the_key_set_is_cacheable_and_has_only_public_halves() {
  let app = TestApp::new().await;
  let reply = app
    .send(Method::GET, "/.well-known/jwks.json", &[], "")
    .await;
  assert_eq!(reply.status, StatusCode::OK);
  assert_eq!(reply.headers["cache-control"], "public, max-age=300");
  let key = &reply.json["keys"][0];
  assert_eq!(key["kty"], "EC");
  assert_eq!(key["alg"], "ES256");
  assert!(
    key.get("d").is_none(),
    "the private scalar must never be published"
  );
}

#[tokio::test]
async fn a_tampered_token_is_refused() {
  let app = TestApp::new().await;
  let token = user_token(&app).await;
  let mut parts: Vec<String> = token.split('.').map(str::to_owned).collect();
  let mut claims: Value =
    serde_json::from_slice(&URL_SAFE_NO_PAD.decode(&parts[1]).unwrap()).unwrap();
  claims["sub"] = "usr_someone_else".into();
  parts[1] = URL_SAFE_NO_PAD.encode(claims.to_string());
  let forged = parts.join(".");
  let (status, body) = app
    .request_with(Method::GET, "/api/v1/auth/me", None, Some(&forged))
    .await;
  assert_eq!(status, StatusCode::UNAUTHORIZED);
  assert!(body["error"]["TOKEN_INVALID"].is_string());
}

#[tokio::test]
async fn an_unsigned_token_is_refused() {
  let app = TestApp::new().await;
  let token = user_token(&app).await;
  let payload = token.split('.').nth(1).unwrap();
  let header = URL_SAFE_NO_PAD.encode(r#"{"alg":"none","typ":"JWT"}"#);
  let unsigned = format!("{header}.{payload}.");
  let (status, _) = app
    .request_with(Method::GET, "/api/v1/auth/me", None, Some(&unsigned))
    .await;
  assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn rotation_keeps_old_tokens_valid_and_signs_with_the_new_key() {
  let app = TestApp::new().await;
  let old = user_token(&app).await;
  let root = app
    .console_login(crate::support::ROOT_EMAIL, crate::support::PASSWORD)
    .await;
  let (status, body) = app
    .request_with(Method::POST, "/api/v1/admin/keys/rotate", None, Some(&root))
    .await;
  assert_eq!(status, StatusCode::OK, "{body}");
  let new_kid = body["data"]["id"].as_str().unwrap().to_owned();
  let set = jwks(&app).await;
  assert_eq!(set["keys"].as_array().unwrap().len(), 2);
  assert!(verify_offline(&old, &set, app.state.config.issuer()).is_ok());
  let (status, _) = app
    .request_with(Method::GET, "/api/v1/auth/me", None, Some(&old))
    .await;
  assert_eq!(status, StatusCode::OK);
  let fresh = app.login("ada@example.com", crate::support::PASSWORD).await;
  assert_eq!(decode_header(&fresh).unwrap().kid.unwrap(), new_kid);
  // Rotation also replaces the console secret: the console refreshes.
  let (status, _) = app
    .request_with(Method::GET, "/api/v1/console/me", None, Some(&root))
    .await;
  assert_eq!(status, StatusCode::UNAUTHORIZED);
}

/// A console key rotated by the CLI or another server applies at once,
/// without this server reloading its keys.
#[tokio::test]
async fn a_console_key_rotated_elsewhere_applies_at_once() {
  let app = TestApp::new().await;
  let old = app.root_token().await;
  let old_kid = decode_header(&old).unwrap().kid.unwrap();
  let mut tx = app.state.db.pool().begin().await.unwrap();
  app::services::keys::rotate_console_key(&mut tx)
    .await
    .unwrap();
  tx.commit().await.unwrap();

  let (status, _) = app
    .request_with(Method::GET, "/api/v1/console/me", None, Some(&old))
    .await;
  assert_eq!(status, StatusCode::UNAUTHORIZED);
  let fresh = app
    .console_login(crate::support::ROOT_EMAIL, crate::support::PASSWORD)
    .await;
  assert_ne!(decode_header(&fresh).unwrap().kid.unwrap(), old_kid);
  let (status, _) = app
    .request_with(Method::GET, "/api/v1/console/me", None, Some(&fresh))
    .await;
  assert_eq!(status, StatusCode::OK);
}
