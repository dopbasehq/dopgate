use app::services::password;

#[test]
fn hash_verifies_only_the_same_password() {
  let hash = password::hash("correct-horse").unwrap();
  assert!(hash.starts_with("$argon2id$"));
  assert!(password::verify("correct-horse", &hash));
  assert!(!password::verify("wrong-horse", &hash));
  assert!(!password::verify("correct-horse", "not a hash"));
}

#[test]
fn policy_refuses_short_and_huge_passwords() {
  assert!(password::check_policy("short").is_err());
  assert!(password::check_policy("long enough").is_ok());
  assert!(password::check_policy(&"x".repeat(2000)).is_err());
}
