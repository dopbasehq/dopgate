use app::services::{
  crypto::{self, CryptoService},
  db::DbClient,
};
use tempfile::TempDir;

async fn database(directory: &TempDir) -> DbClient {
  let url = app::config::sqlite_url(&directory.path().join("test.db"));
  let db = DbClient::connect(&url).await.unwrap();
  db.migrate().await.unwrap();
  db
}

#[tokio::test]
async fn first_start_writes_a_private_key_and_later_starts_reuse_it() {
  let directory = TempDir::new().unwrap();
  let db = database(&directory).await;
  let key_path = directory.path().join("master.key");
  let first = CryptoService::initialize(db.pool(), &key_path)
    .await
    .unwrap();
  assert_eq!(std::fs::read(&key_path).unwrap().len(), 32);
  #[cfg(unix)]
  {
    use std::os::unix::fs::PermissionsExt;
    let mode = std::fs::metadata(&key_path).unwrap().permissions().mode();
    assert_eq!(mode & 0o777, 0o600);
  }
  let second = CryptoService::initialize(db.pool(), &key_path)
    .await
    .unwrap();
  assert_eq!(first.master_key_bytes(), second.master_key_bytes());
}

#[tokio::test]
async fn a_different_key_is_refused() {
  let directory = TempDir::new().unwrap();
  let db = database(&directory).await;
  let key_path = directory.path().join("master.key");
  CryptoService::initialize(db.pool(), &key_path)
    .await
    .unwrap();
  crypto::write_key_file(&key_path, &[7; 32]).unwrap();
  let error = CryptoService::initialize(db.pool(), &key_path)
    .await
    .err()
    .unwrap();
  assert!(format!("{error:#}").contains("does not match this database"));
}

#[test]
fn master_encryption_is_bound_to_its_context() {
  let service = CryptoService::from_key(vec![1; 32]);
  let (ciphertext, nonce) = service
    .encrypt_master(b"smtp-password", b"setting:smtp")
    .unwrap();
  assert_eq!(
    service
      .decrypt_master(&ciphertext, &nonce, b"setting:smtp")
      .unwrap(),
    b"smtp-password"
  );
  assert!(
    service
      .decrypt_master(&ciphertext, &nonce, b"setting:other")
      .is_err()
  );
  let other = CryptoService::from_key(vec![2; 32]);
  assert!(
    other
      .decrypt_master(&ciphertext, &nonce, b"setting:smtp")
      .is_err()
  );
}

#[test]
fn backups_round_trip_and_detect_tampering() {
  let service = CryptoService::from_key(vec![1; 32]);
  let mut sealed = service.encrypt_backup(b"database bytes").unwrap();
  assert!(sealed.starts_with(b"DOPGATE_BK1\0"));
  assert_eq!(service.decrypt_backup(&sealed).unwrap(), b"database bytes");
  assert!(CryptoService::decrypt_backup_with_key(&sealed, &[2; 32]).is_err());
  let last = sealed.len() - 1;
  sealed[last] ^= 1;
  assert!(service.decrypt_backup(&sealed).is_err());
  assert!(service.decrypt_backup(b"short").is_err());
}

#[test]
fn master_keys_parse_from_raw_bytes_or_hex() {
  assert_eq!(crypto::parse_master_key(&[9; 32]).unwrap(), vec![9; 32]);
  let hex = format!("{}\n", "ab".repeat(32));
  assert_eq!(
    crypto::parse_master_key(hex.as_bytes()).unwrap(),
    vec![0xab; 32]
  );
  assert!(crypto::parse_master_key(b"too short").is_err());
}

/// Rekeying re-encrypts every value the master key protects: settings,
/// signing keys, and provider secrets.
#[tokio::test]
async fn rekey_moves_every_encrypted_value_to_the_new_key() {
  let directory = TempDir::new().unwrap();
  let db = database(&directory).await;
  let key_path = directory.path().join("master.key");
  let old = CryptoService::initialize(db.pool(), &key_path)
    .await
    .unwrap();
  let now = "2026-01-01T00:00:00+00:00";

  let (setting, setting_nonce) = old
    .encrypt_master(b"smtp-secret", &crypto::setting_aad("smtp.password"))
    .unwrap();
  sqlx::query(
    "INSERT INTO settings(key,ciphertext,nonce,updated_at) VALUES('smtp.password',?,?,?)",
  )
  .bind(&setting)
  .bind(&setting_nonce)
  .bind(now)
  .execute(db.pool())
  .await
  .unwrap();
  let (signing, signing_nonce) = old
    .encrypt_master(b"private-key", &crypto::signing_key_aad("key_1"))
    .unwrap();
  sqlx::query("INSERT INTO signing_keys(id,algorithm,public_jwk,private_ciphertext,private_nonce,status,created_at) VALUES('key_1','ES256','{}',?,?,'active',?)")
    .bind(&signing)
    .bind(&signing_nonce)
    .bind(now)
    .execute(db.pool())
    .await
    .unwrap();
  let (provider, provider_nonce) = old
    .encrypt_master(b"client-secret", &crypto::sso_client_secret_aad("sso_1"))
    .unwrap();
  sqlx::query("INSERT INTO sso_providers(id,preset,display_name,issuer,client_id,client_secret_ciphertext,client_secret_nonce,created_at,updated_at) VALUES('sso_1','generic','Test','https://idp.example','client',?,?,?,?)")
    .bind(&provider)
    .bind(&provider_nonce)
    .bind(now)
    .bind(now)
    .execute(db.pool())
    .await
    .unwrap();

  let new_key = [5_u8; 32];
  crypto::rekey_database(db.pool(), &old.master_key_bytes(), &new_key)
    .await
    .unwrap();
  let new = CryptoService::from_key(new_key.to_vec());

  let (ciphertext, nonce): (Vec<u8>, Vec<u8>) =
    sqlx::query_as("SELECT ciphertext, nonce FROM settings WHERE key='smtp.password'")
      .fetch_one(db.pool())
      .await
      .unwrap();
  let aad = crypto::setting_aad("smtp.password");
  assert_eq!(
    new.decrypt_master(&ciphertext, &nonce, &aad).unwrap(),
    b"smtp-secret"
  );
  assert!(old.decrypt_master(&ciphertext, &nonce, &aad).is_err());

  let (ciphertext, nonce): (Vec<u8>, Vec<u8>) =
    sqlx::query_as("SELECT private_ciphertext, private_nonce FROM signing_keys")
      .fetch_one(db.pool())
      .await
      .unwrap();
  assert_eq!(
    new
      .decrypt_master(&ciphertext, &nonce, &crypto::signing_key_aad("key_1"))
      .unwrap(),
    b"private-key"
  );

  let (ciphertext, nonce): (Vec<u8>, Vec<u8>) =
    sqlx::query_as("SELECT client_secret_ciphertext, client_secret_nonce FROM sso_providers")
      .fetch_one(db.pool())
      .await
      .unwrap();
  assert_eq!(
    new
      .decrypt_master(&ciphertext, &nonce, &crypto::sso_client_secret_aad("sso_1"))
      .unwrap(),
    b"client-secret"
  );

  // The instance check moved too: the new key now opens the database.
  crypto::write_key_file(&key_path, &new_key).unwrap();
  CryptoService::initialize(db.pool(), &key_path)
    .await
    .unwrap();
}
