use app::services::secret_box::SecretBox;

const KEY: &str = "a-service-key-that-is-long-enough-1234";

#[test]
fn a_sealed_secret_opens_with_the_same_key_and_purpose() {
  let sealed = SecretBox::new(KEY, "smtp-password").seal("s3cret pass");
  assert!(sealed.starts_with("v1:"));
  assert!(!sealed.contains("s3cret"));
  let opened = SecretBox::new(KEY, "smtp-password").open(&sealed).unwrap();
  assert_eq!(opened.as_str(), "s3cret pass");
}

#[test]
fn each_seal_uses_a_fresh_nonce() {
  let secret_box = SecretBox::new(KEY, "smtp-password");
  assert_ne!(secret_box.seal("same"), secret_box.seal("same"));
}

#[test]
fn another_key_purpose_or_a_tampered_value_does_not_open() {
  let sealed = SecretBox::new(KEY, "smtp-password").seal("s3cret");
  let other_key = SecretBox::new("another-service-key-that-is-long-enough", "smtp-password");
  assert!(other_key.open(&sealed).is_err());
  assert!(SecretBox::new(KEY, "other").open(&sealed).is_err());

  let mut tampered = sealed.clone();
  let last = tampered.pop().unwrap();
  tampered.push(if last == 'A' { 'B' } else { 'A' });
  let secret_box = SecretBox::new(KEY, "smtp-password");
  assert!(secret_box.open(&tampered).is_err());
  assert!(secret_box.open("s3cret").is_err());
  assert!(secret_box.open("v1:").is_err());
}
