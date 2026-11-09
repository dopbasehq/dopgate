//! Access tokens as a backend sees them: verified offline with the JWKS.

use axum::http::{Method, StatusCode};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode, decode_header};
use serde_json::Value;

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
  rules.validate_aud = false;
  Ok(decode::<Value>(token, &decoding, &rules)?.claims)
}

#[tokio::test]
async fn a_backend_verifies_tokens_with_the_key_set() {
  let app = TestApp::new().await;
  let token = app.root_token().await;
  let claims = verify_offline(&token, &jwks(&app).await, app.state.config.issuer()).unwrap();
  assert!(claims["sub"].as_str().unwrap().starts_with("usr_"));
  assert!(claims["sid"].as_str().unwrap().starts_with("ses_"));
  assert_eq!(claims["role"], "root");
  assert_eq!(claims["email_verified"], true);
  assert!(claims["exp"].as_i64().unwrap() > claims["iat"].as_i64().unwrap());
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
  let token = app.root_token().await;
  let mut parts: Vec<String> = token.split('.').map(str::to_owned).collect();
  let mut claims: Value =
    serde_json::from_slice(&URL_SAFE_NO_PAD.decode(&parts[1]).unwrap()).unwrap();
  claims["role"] = "member".into();
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
  let token = app.root_token().await;
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
  let old = app.root_token().await;
  let (status, body) = app
    .request_with(Method::POST, "/api/v1/admin/keys/rotate", None, Some(&old))
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
  let fresh = app
    .login(crate::support::ROOT_EMAIL, crate::support::PASSWORD)
    .await;
  assert_eq!(decode_header(&fresh).unwrap().kid.unwrap(), new_kid);
}
