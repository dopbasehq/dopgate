//! The ES256 keys that sign access tokens.
//!
//! Keys live in `signing_keys`. The first start generates one. Rotation
//! makes a new active key and moves the old one to `retiring`, where it
//! still verifies the tokens it signed. A retiring key is retired once no
//! token it signed can still be valid: access tokens last at most a day.
//! The public halves of active and retiring keys form the JWKS.
//!
//! Console access tokens use a separate HS256 secret in `console_keys`. It
//! never leaves Dopgate and is not in the JWKS. Rotation replaces it too;
//! the console then refreshes its token.

use std::{collections::HashMap, sync::Arc};

use anyhow::{Context, Result};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use jsonwebtoken::{DecodingKey, EncodingKey};
use p256::{
  SecretKey,
  elliptic_curve::sec1::ToEncodedPoint,
  pkcs8::{EncodePrivateKey, LineEnding},
};
use serde_json::{Value, json};
use sqlx::{PgConnection, PgPool};
use tokio::sync::RwLock;

use crate::{
  constants::tokens::{CONSOLE_KEY_ID_PREFIX, SIGNING_KEY_ID_PREFIX},
  services::token,
};

/// A retiring key verifies tokens for this long after rotation, the longest
/// an access token can last.
pub const RETIRING_HOURS: i64 = 24;

#[derive(Clone, Default)]
pub struct KeyStore {
  cache: Arc<RwLock<Cache>>,
}

#[derive(Default)]
struct Cache {
  signing: Option<(String, EncodingKey)>,
  verifying: HashMap<String, DecodingKey>,
  jwks: Vec<Value>,
  /// The active console secret and its ID.
  console: Option<(String, Vec<u8>)>,
}

/// A freshly generated key, ready to insert.
pub struct NewKey {
  pub id: String,
  pub public_jwk: Value,
  pub private_pem: String,
}

/// Generate a P-256 key pair.
pub fn generate() -> Result<NewKey> {
  let secret = SecretKey::random(&mut rand_core::OsRng);
  let private_pem = secret
    .to_pkcs8_pem(LineEnding::LF)
    .context("failed to encode the signing key")?
    .to_string();
  let point = secret.public_key().to_encoded_point(false);
  let id = token::public_id(SIGNING_KEY_ID_PREFIX);
  let x = point.x().context("signing key has no x coordinate")?;
  let y = point.y().context("signing key has no y coordinate")?;
  let public_jwk = json!({
    "kty": "EC",
    "crv": "P-256",
    "x": URL_SAFE_NO_PAD.encode(x),
    "y": URL_SAFE_NO_PAD.encode(y),
    "kid": id,
    "alg": "ES256",
    "use": "sig",
  });
  Ok(NewKey {
    id,
    public_jwk,
    private_pem,
  })
}

/// Insert a key as the active one. The caller has already moved any active
/// key aside.
pub async fn insert_active(
  connection: &mut PgConnection,
  key: &NewKey,
) -> Result<(), sqlx::Error> {
  sqlx::query(
    "INSERT INTO signing_keys(id,algorithm,public_jwk,private_pem,status,created_at) VALUES($1,'ES256',$2,$3,'active',now())",
  )
  .bind(&key.id)
  .bind(&key.public_jwk)
  .bind(&key.private_pem)
  .execute(connection)
  .await
  .map(|_| ())
}

/// Make a new console secret the active one, retiring the old one. Tokens
/// it signed stop verifying, and the console refreshes them.
pub async fn rotate_console_key(connection: &mut PgConnection) -> Result<(), sqlx::Error> {
  sqlx::query("LOCK TABLE console_keys IN SHARE ROW EXCLUSIVE MODE")
    .execute(&mut *connection)
    .await?;
  sqlx::query("UPDATE console_keys SET status='retired', retired_at=now() WHERE status='active'")
    .execute(&mut *connection)
    .await?;
  insert_console_key(connection).await
}

async fn insert_console_key(connection: &mut PgConnection) -> Result<(), sqlx::Error> {
  let mut secret = [0_u8; 32];
  getrandom::fill(&mut secret).map_err(|error| sqlx::Error::Protocol(error.to_string()))?;
  sqlx::query("INSERT INTO console_keys(id,secret,status,created_at) VALUES($1,$2,'active',now())")
    .bind(token::public_id(CONSOLE_KEY_ID_PREFIX))
    .bind(secret.as_slice())
    .execute(connection)
    .await
    .map(|_| ())
}

impl KeyStore {
  /// Make sure an active key exists, retire keys past their window, and
  /// load everything into the cache. Runs at startup.
  pub async fn initialize(
    &self,
    pool: &PgPool,
  ) -> Result<()> {
    let mut tx = pool.begin().await?;
    // Two servers starting at once must not both generate a key.
    sqlx::query("LOCK TABLE signing_keys IN SHARE ROW EXCLUSIVE MODE")
      .execute(&mut *tx)
      .await?;
    let active: bool =
      sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM signing_keys WHERE status='active')")
        .fetch_one(&mut *tx)
        .await?;
    if !active {
      let key = generate()?;
      insert_active(&mut tx, &key).await?;
      tracing::info!(kid = %key.id, "generated a signing key");
    }
    sqlx::query("LOCK TABLE console_keys IN SHARE ROW EXCLUSIVE MODE")
      .execute(&mut *tx)
      .await?;
    let console: bool =
      sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM console_keys WHERE status='active')")
        .fetch_one(&mut *tx)
        .await?;
    if !console {
      insert_console_key(&mut tx).await?;
    }
    tx.commit().await?;
    self.reload(pool).await
  }

  /// Read the keys from the database again.
  pub async fn reload(
    &self,
    pool: &PgPool,
  ) -> Result<()> {
    sqlx::query(&format!(
      "UPDATE signing_keys SET status='retired', retired_at=now() WHERE status='retiring' AND rotated_at < now() - interval '{RETIRING_HOURS} hours'"
    ))
    .execute(pool)
    .await?;
    let rows: Vec<(String, Value, String, String)> = sqlx::query_as(
      "SELECT id, public_jwk, private_pem, status FROM signing_keys WHERE status IN ('active','retiring') ORDER BY created_at DESC",
    )
    .fetch_all(pool)
    .await?;
    let mut cache = Cache::default();
    for (id, jwk, pem, status) in rows {
      let x = jwk["x"].as_str().context("stored key has no x")?;
      let y = jwk["y"].as_str().context("stored key has no y")?;
      cache
        .verifying
        .insert(id.clone(), DecodingKey::from_ec_components(x, y)?);
      if status == "active" {
        cache.signing = Some((id.clone(), EncodingKey::from_ec_pem(pem.as_bytes())?));
      }
      cache.jwks.push(jwk);
    }
    cache.console = sqlx::query_as("SELECT id, secret FROM console_keys WHERE status='active'")
      .fetch_optional(pool)
      .await?;
    *self.cache.write().await = cache;
    Ok(())
  }

  /// The key ID and key that sign new tokens.
  pub async fn signing_key(&self) -> Option<(String, EncodingKey)> {
    self.cache.read().await.signing.clone()
  }

  /// The key that verifies tokens with `kid`. A miss reloads once, since
  /// another server may have rotated.
  pub async fn verifying_key(
    &self,
    pool: &PgPool,
    kid: &str,
  ) -> Option<DecodingKey> {
    if let Some(key) = self.cache.read().await.verifying.get(kid) {
      return Some(key.clone());
    }
    if let Err(error) = self.reload(pool).await {
      tracing::warn!(%error, "failed to reload signing keys");
    }
    self.cache.read().await.verifying.get(kid).cloned()
  }

  /// The ID and secret that sign console tokens.
  pub async fn console_key(&self) -> Option<(String, Vec<u8>)> {
    self.cache.read().await.console.clone()
  }

  /// The console secret with this ID, if it is the active one. A miss
  /// reloads once, since another server may have rotated.
  pub async fn console_secret(
    &self,
    pool: &PgPool,
    kid: &str,
  ) -> Option<Vec<u8>> {
    let matching = |cache: &Cache| {
      cache
        .console
        .as_ref()
        .filter(|(id, _)| id == kid)
        .map(|(_, secret)| secret.clone())
    };
    if let Some(secret) = matching(&*self.cache.read().await) {
      return Some(secret);
    }
    if let Err(error) = self.reload(pool).await {
      tracing::warn!(%error, "failed to reload signing keys");
    }
    matching(&*self.cache.read().await)
  }

  /// The JSON Web Key Set apps verify tokens with.
  pub async fn jwks(&self) -> Value {
    json!({ "keys": self.cache.read().await.jwks })
  }
}
