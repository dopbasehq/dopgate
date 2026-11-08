use app::utils::email::normalize;

#[test]
fn normalize_trims_and_lowercases() {
  assert_eq!(
    normalize("  Person@Example.COM ").as_deref(),
    Some("person@example.com")
  );
}

#[test]
fn normalize_refuses_obvious_typos() {
  for value in [
    "",
    "person",
    "@example.com",
    "person@",
    "person@example",
    "person@.example.com",
    "person@example..com",
    "per son@example.com",
  ] {
    assert_eq!(normalize(value), None, "{value:?}");
  }
}
