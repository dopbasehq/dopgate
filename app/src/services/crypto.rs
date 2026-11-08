use std::{
  fs::{self, OpenOptions},
  io::Write,
  path::Path,
  sync::{Arc, RwLock},
};

use anyhow::{Context, Result, bail};
use chacha20poly1305::{
  KeyInit, XChaCha20Poly1305, XNonce,
  aead::{Aead, Payload},
};
use chrono::Utc;
use sqlx::SqlitePool;
use zeroize::Zeroizing;

const VERIFICATION_TEXT: &[u8] = b"dopgate-master-key-v1";

#[derive(Clone)]
pub struct CryptoService {
  master_key: Arc<RwLock<Zeroizing<Vec<u8>>>>,
}

impl CryptoService {
  pub async fn initialize(
    pool: &SqlitePool,
    path: &Path,
  ) -> Result<Self> {
    let record: Option<(Vec<u8>, Vec<u8>)> = sqlx::query_as(
      "SELECT verification_ciphertext, verification_nonce FROM instance_metadata WHERE id = 1",
    )
    .fetch_optional(pool)
    .await?;

    let key = if record.is_none() && !path.exists() {
      generate_key_file(path)?
    } else {
      read_key_file(path)?
    };
    let service = Self {
      master_key: Arc::new(RwLock::new(Zeroizing::new(key))),
    };

    if let Some((ciphertext, nonce)) = record {
      let clear = service
        .decrypt_master(&ciphertext, &nonce, b"instance-verification")
        .context("configured master key does not match this database")?;
      if clear != VERIFICATION_TEXT {
        bail!("configured master key does not match this database");
      }
    } else {
      let (ciphertext, nonce) =
        service.encrypt_master(VERIFICATION_TEXT, b"instance-verification")?;
      sqlx::query("INSERT INTO instance_metadata(id, verification_ciphertext, verification_nonce, created_at) VALUES(1, ?, ?, ?)")
                .bind(ciphertext).bind(nonce).bind(Utc::now().to_rfc3339()).execute(pool).await?;
    }
    Ok(service)
  }

  pub fn master_key_bytes(&self) -> Vec<u8> {
    self.master_key.read().unwrap().to_vec()
  }

  pub fn replace_master_key(
    &self,
    path: &Path,
    new_key: &[u8],
  ) -> Result<()> {
    if new_key.len() != 32 {
      bail!("master key must contain exactly 32 bytes");
    }
    write_key_file(path, new_key)?;
    let mut lock = self.master_key.write().unwrap();
    *lock = Zeroizing::new(new_key.to_vec());
    Ok(())
  }

  pub fn encrypt_master(
    &self,
    value: &[u8],
    aad: &[u8],
  ) -> Result<(Vec<u8>, Vec<u8>)> {
    let nonce = random_nonce()?;
    let key = self.master_key.read().unwrap();
    let cipher = XChaCha20Poly1305::new_from_slice(&key).expect("32-byte key");
    let ciphertext = cipher
      .encrypt(XNonce::from_slice(&nonce), Payload { msg: value, aad })
      .map_err(|_| anyhow::anyhow!("key wrapping failed"))?;
    Ok((ciphertext, nonce))
  }

  pub fn decrypt_master(
    &self,
    ciphertext: &[u8],
    nonce: &[u8],
    aad: &[u8],
  ) -> Result<Vec<u8>> {
    if nonce.len() != 24 {
      bail!("invalid nonce");
    }
    let key = self.master_key.read().unwrap();
    let cipher = XChaCha20Poly1305::new_from_slice(&key).expect("32-byte key");
    cipher
      .decrypt(
        XNonce::from_slice(nonce),
        Payload {
          msg: ciphertext,
          aad,
        },
      )
      .map_err(|_| anyhow::anyhow!("key authentication failed"))
  }

  pub fn encrypt_backup(
    &self,
    payload: &[u8],
  ) -> Result<Vec<u8>> {
    let nonce = random_nonce()?;
    let key = self.master_key.read().unwrap();
    let cipher = XChaCha20Poly1305::new_from_slice(&key).expect("32-byte key");
    let ciphertext = cipher
      .encrypt(
        XNonce::from_slice(&nonce),
        Payload {
          msg: payload,
          aad: b"dopgate-backup-v1",
        },
      )
      .map_err(|_| anyhow::anyhow!("backup encryption failed"))?;
    let mut out = Vec::with_capacity(12 + 24 + ciphertext.len());
    out.extend_from_slice(b"DOPGATE_BK1\0");
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ciphertext);
    Ok(out)
  }

  pub fn decrypt_backup(
    &self,
    data: &[u8],
  ) -> Result<Vec<u8>> {
    let key = self.master_key.read().unwrap();
    Self::decrypt_backup_payload(data, &key)
  }

  pub fn decrypt_backup_with_key(
    data: &[u8],
    key: &[u8],
  ) -> Result<Vec<u8>> {
    Self::decrypt_backup_payload(data, key)
  }

  fn decrypt_backup_payload(
    data: &[u8],
    key: &[u8],
  ) -> Result<Vec<u8>> {
    const MAGIC: &[u8] = b"DOPGATE_BK1\0";
    if key.len() != 32 {
      bail!("master key must contain exactly 32 bytes");
    }
    if data.len() < MAGIC.len() + 24 + 16 {
      bail!("invalid backup file: file too short");
    }
    if &data[..MAGIC.len()] != MAGIC {
      bail!("invalid backup file: magic header mismatch");
    }
    let nonce = &data[MAGIC.len()..MAGIC.len() + 24];
    let ciphertext = &data[MAGIC.len() + 24..];
    let cipher = XChaCha20Poly1305::new_from_slice(key).expect("32-byte key");
    cipher
      .decrypt(
        XNonce::from_slice(nonce),
        Payload {
          msg: ciphertext,
          aad: b"dopgate-backup-v1",
        },
      )
      .map_err(|_| anyhow::anyhow!("backup decryption/authentication failed"))
  }

  pub fn from_key(key: Vec<u8>) -> Self {
    Self {
      master_key: Arc::new(RwLock::new(Zeroizing::new(key))),
    }
  }
}

pub async fn rekey_database(
  pool: &SqlitePool,
  old_master_key: &[u8],
  new_master_key: &[u8],
) -> Result<()> {
  if old_master_key == new_master_key {
    return Ok(());
  }
  if old_master_key.len() != 32 || new_master_key.len() != 32 {
    bail!("master keys must be exactly 32 bytes");
  }

  let old_crypto = CryptoService::from_key(old_master_key.to_vec());
  let new_crypto = CryptoService::from_key(new_master_key.to_vec());
  let mut tx = pool.begin().await?;

  // 1. Re-key instance verification metadata
  let meta: Option<(Vec<u8>, Vec<u8>)> = sqlx::query_as(
    "SELECT verification_ciphertext, verification_nonce FROM instance_metadata WHERE id = 1",
  )
  .fetch_optional(&mut *tx)
  .await?;

  if let Some((ciphertext, nonce)) = meta {
    let clear = old_crypto
      .decrypt_master(&ciphertext, &nonce, b"instance-verification")
      .context("provided master key cannot decrypt instance metadata")?;
    if clear != VERIFICATION_TEXT {
      bail!("provided master key verification text mismatch");
    }
    let (new_cipher, new_nonce) =
      new_crypto.encrypt_master(VERIFICATION_TEXT, b"instance-verification")?;
    sqlx::query(
      "UPDATE instance_metadata SET verification_ciphertext = ?, verification_nonce = ? WHERE id = 1",
    )
    .bind(new_cipher)
    .bind(new_nonce)
    .execute(&mut *tx)
    .await?;
  }

  // 2. Re-encrypt secret settings, such as the SMTP password.
  let rows: Vec<(String, Vec<u8>, Vec<u8>)> =
    sqlx::query_as("SELECT key, ciphertext, nonce FROM settings WHERE ciphertext IS NOT NULL")
      .fetch_all(&mut *tx)
      .await?;

  for (key, ciphertext, nonce) in rows {
    let setting_aad = setting_aad(&key);
    let clear = Zeroizing::new(
      old_crypto
        .decrypt_master(&ciphertext, &nonce, &setting_aad)
        .with_context(|| format!("failed to decrypt setting {key} with provided master key"))?,
    );
    let (new_ciphertext, new_nonce) = new_crypto.encrypt_master(&clear, &setting_aad)?;
    sqlx::query("UPDATE settings SET ciphertext = ?, nonce = ? WHERE key = ?")
      .bind(new_ciphertext)
      .bind(new_nonce)
      .bind(&key)
      .execute(&mut *tx)
      .await?;
  }

  // 3. Re-encrypt token signing keys.
  let rows: Vec<(String, Vec<u8>, Vec<u8>)> =
    sqlx::query_as("SELECT id, private_ciphertext, private_nonce FROM signing_keys")
      .fetch_all(&mut *tx)
      .await?;

  for (key_id, ciphertext, nonce) in rows {
    let key_aad = signing_key_aad(&key_id);
    let clear = Zeroizing::new(
      old_crypto
        .decrypt_master(&ciphertext, &nonce, &key_aad)
        .with_context(|| {
          format!("failed to decrypt signing key {key_id} with provided master key")
        })?,
    );
    let (new_ciphertext, new_nonce) = new_crypto.encrypt_master(&clear, &key_aad)?;
    sqlx::query("UPDATE signing_keys SET private_ciphertext = ?, private_nonce = ? WHERE id = ?")
      .bind(new_ciphertext)
      .bind(new_nonce)
      .bind(&key_id)
      .execute(&mut *tx)
      .await?;
  }

  // 4. Re-encrypt single sign-on client secrets.
  let rows: Vec<(String, Vec<u8>, Vec<u8>)> =
    sqlx::query_as("SELECT id, client_secret_ciphertext, client_secret_nonce FROM sso_providers")
      .fetch_all(&mut *tx)
      .await?;

  for (provider_id, ciphertext, nonce) in rows {
    let provider_aad = sso_client_secret_aad(&provider_id);
    let secret = old_crypto
      .decrypt_master(&ciphertext, &nonce, &provider_aad)
      .with_context(|| {
        format!("failed to decrypt the SSO client secret of {provider_id} with provided master key")
      })?;
    let (new_ciphertext, new_nonce) = new_crypto.encrypt_master(&secret, &provider_aad)?;
    sqlx::query(
      "UPDATE sso_providers SET client_secret_ciphertext = ?, client_secret_nonce = ? WHERE id = ?",
    )
    .bind(new_ciphertext)
    .bind(new_nonce)
    .bind(&provider_id)
    .execute(&mut *tx)
    .await?;
  }

  tx.commit().await?;
  Ok(())
}

/// Binds an encrypted client secret to its provider row.
pub fn sso_client_secret_aad(provider_id: &str) -> Vec<u8> {
  format!("sso_provider:{provider_id}:client_secret").into_bytes()
}

/// Binds an encrypted setting value to its key.
pub fn setting_aad(key: &str) -> Vec<u8> {
  format!("setting:{key}").into_bytes()
}

/// Binds an encrypted private signing key to its key ID.
pub fn signing_key_aad(key_id: &str) -> Vec<u8> {
  format!("signing_key:{key_id}:private").into_bytes()
}

pub fn parse_master_key(input: &[u8]) -> Result<Vec<u8>> {
  if input.len() == 32 {
    return Ok(input.to_vec());
  }
  let trimmed = std::str::from_utf8(input).map(|s| s.trim()).unwrap_or("");
  if trimmed.len() == 64
    && let Ok(bytes) = hex::decode(trimmed)
    && bytes.len() == 32
  {
    return Ok(bytes);
  }
  bail!("master key must contain 32 raw bytes or 64-character hex string");
}

pub fn write_key_file(
  path: &Path,
  bytes: &[u8],
) -> Result<()> {
  if bytes.len() != 32 {
    bail!("master key must contain exactly 32 bytes");
  }
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent)?;
  }
  let temp_path = path.with_extension("tmp");
  let mut options = OpenOptions::new();
  options.write(true).create(true).truncate(true);
  #[cfg(unix)]
  {
    use std::os::unix::fs::OpenOptionsExt;
    options.mode(0o600);
  }
  let mut file = options
    .open(&temp_path)
    .with_context(|| format!("failed to create temp master key {}", temp_path.display()))?;
  file.write_all(bytes)?;
  file.sync_all()?;
  fs::rename(&temp_path, path)
    .with_context(|| format!("failed to atomically replace master key {}", path.display()))?;
  Ok(())
}

fn random_nonce() -> Result<Vec<u8>> {
  let mut nonce = vec![0_u8; 24];
  getrandom::fill(&mut nonce)?;
  Ok(nonce)
}

fn read_key_file(path: &Path) -> Result<Vec<u8>> {
  let bytes =
    fs::read(path).with_context(|| format!("failed to read master key {}", path.display()))?;
  if bytes.len() != 32 {
    bail!("master key must contain exactly 32 bytes");
  }
  Ok(bytes)
}

fn generate_key_file(path: &Path) -> Result<Vec<u8>> {
  let mut bytes = vec![0_u8; 32];
  getrandom::fill(&mut bytes)?;
  write_key_file(path, &bytes)?;
  Ok(bytes)
}
