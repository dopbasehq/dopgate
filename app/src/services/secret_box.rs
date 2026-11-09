//! Encrypts secrets the dashboard saves, such as the SMTP password, before
//! they reach the database. The key is derived from the service key, so a
//! database dump alone does not give them away. Changing or removing the
//! service key makes saved secrets unreadable, and they have to be entered
//! again.

use base64::{Engine, engine::general_purpose::STANDARD};
use chacha20poly1305::{
  ChaCha20Poly1305, Key, Nonce,
  aead::{Aead, KeyInit},
};
use hkdf::Hkdf;
use sha2::Sha256;
use zeroize::Zeroizing;

/// Sealed values start with this, so the format can change later.
const PREFIX: &str = "v1:";
const NONCE_LEN: usize = 12;
const SALT: &[u8] = b"dopgate secret box";

pub struct SecretBox {
  cipher: ChaCha20Poly1305,
}

/// The value was sealed with another key, or it is not a sealed value.
#[derive(Debug)]
pub struct OpenError;

impl std::fmt::Display for OpenError {
  fn fmt(
    &self,
    formatter: &mut std::fmt::Formatter<'_>,
  ) -> std::fmt::Result {
    formatter.write_str("the secret could not be decrypted")
  }
}

impl std::error::Error for OpenError {}

impl SecretBox {
  /// A box for one kind of secret. `purpose` keeps the keys for different
  /// secrets apart.
  pub fn new(
    service_key: &str,
    purpose: &str,
  ) -> Self {
    let mut key = Zeroizing::new([0u8; 32]);
    Hkdf::<Sha256>::new(Some(SALT), service_key.as_bytes())
      .expand(purpose.as_bytes(), key.as_mut())
      .expect("32 bytes is a valid HKDF-SHA256 output length");
    Self {
      cipher: ChaCha20Poly1305::new(Key::from_slice(key.as_ref())),
    }
  }

  /// Encrypt `plaintext` with a fresh random nonce.
  pub fn seal(
    &self,
    plaintext: &str,
  ) -> String {
    let mut nonce = [0u8; NONCE_LEN];
    getrandom::fill(&mut nonce).expect("the system random number generator failed");
    let ciphertext = self
      .cipher
      .encrypt(Nonce::from_slice(&nonce), plaintext.as_bytes())
      .expect("ChaCha20-Poly1305 encrypts any input this small");
    let mut bytes = nonce.to_vec();
    bytes.extend(ciphertext);
    format!("{PREFIX}{}", STANDARD.encode(bytes))
  }

  pub fn open(
    &self,
    sealed: &str,
  ) -> Result<Zeroizing<String>, OpenError> {
    let bytes = sealed
      .strip_prefix(PREFIX)
      .and_then(|encoded| STANDARD.decode(encoded).ok())
      .filter(|bytes| bytes.len() > NONCE_LEN)
      .ok_or(OpenError)?;
    let (nonce, ciphertext) = bytes.split_at(NONCE_LEN);
    let plaintext = Zeroizing::new(
      self
        .cipher
        .decrypt(Nonce::from_slice(nonce), ciphertext)
        .map_err(|_| OpenError)?,
    );
    String::from_utf8(plaintext.to_vec())
      .map(Zeroizing::new)
      .map_err(|_| OpenError)
  }
}
