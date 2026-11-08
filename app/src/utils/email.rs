//! Email address checks shared by signup, setup, and the admin API.

const MAX_EMAIL_BYTES: usize = 254;

/// Trim and lowercase an address, or `None` when it is clearly not one.
///
/// This catches typos, not every invalid address. Whether the address
/// works is settled by verification.
pub fn normalize(email: &str) -> Option<String> {
  let email = email.trim().to_lowercase();
  if email.is_empty() || email.len() > MAX_EMAIL_BYTES || email.chars().any(char::is_whitespace) {
    return None;
  }
  let (local, domain) = email.rsplit_once('@')?;
  let domain_valid = domain.contains('.')
    && !domain.starts_with('.')
    && !domain.ends_with('.')
    && !domain.contains("..");
  (!local.is_empty() && !local.contains('@') && domain_valid).then_some(email)
}
