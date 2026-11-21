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

/// Hashes wait for a free slot, one per CPU. Three times as many as there
/// are slots still all finish, and a second round shows the slots came back.
#[tokio::test(flavor = "multi_thread")]
async fn more_hashes_than_slots_all_finish() {
  let hash = password::hash("correct-horse").unwrap();
  for _ in 0..2 {
    let checks: Vec<_> = (0..password::hashing_slots() * 3)
      .map(|index| {
        let guess = if index % 2 == 0 {
          "correct-horse"
        } else {
          "wrong-horse"
        };
        tokio::spawn(password::verify_async(guess.into(), hash.clone()))
      })
      .collect();
    for (index, check) in checks.into_iter().enumerate() {
      assert_eq!(check.await.unwrap(), index % 2 == 0);
    }
  }
  let fresh = password::hash_async("another-horse".into()).await.unwrap();
  assert!(password::verify("another-horse", &fresh));
}
