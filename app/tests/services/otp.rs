use app::services::otp::{Purpose, generate_code, normalize_code};

#[test]
fn codes_are_six_digits() {
  for _ in 0..200 {
    let code = generate_code();
    assert_eq!(code.len(), 6);
    assert!(code.bytes().all(|byte| byte.is_ascii_digit()));
  }
}

#[test]
fn typed_codes_ignore_spaces_and_dashes() {
  assert_eq!(normalize_code(" 482-913 "), "482913");
  assert_eq!(normalize_code("482 913"), "482913");
}

#[test]
fn each_purpose_has_its_template() {
  assert_eq!(Purpose::EmailVerify.template(), "verify_email");
  assert_eq!(Purpose::Login.template(), "login_code");
  assert_eq!(Purpose::PasswordReset.template(), "password_reset");
  assert_eq!(Purpose::EmailChange.template(), "email_change");
}
