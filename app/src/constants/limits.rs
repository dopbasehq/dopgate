/// Lifetime of a signed access token. Short, because a JWT cannot be
/// recalled once issued; the refresh token carries the session.
pub const ACCESS_TOKEN_MINUTES: i64 = 15;
/// A refresh token expires when unused for this long.
pub const REFRESH_TOKEN_IDLE_DAYS: i64 = 30;
/// A session ends after this long, however often it refreshes.
pub const SESSION_ABSOLUTE_DAYS: i64 = 90;

pub const PASSWORD_MIN_LENGTH: usize = 8;
/// Argon2 work grows with input length, so very long passwords are refused
/// before hashing.
pub const PASSWORD_MAX_BYTES: usize = 1024;

/// Emailed codes stay valid this long.
pub const VERIFICATION_CODE_MINUTES: i64 = 10;
pub const VERIFICATION_CODE_DIGITS: usize = 6;
/// Wrong guesses allowed per code before it is burned.
pub const VERIFICATION_MAX_ATTEMPTS: i64 = 5;
/// Seconds before the same email can be sent another code.
pub const CODE_RESEND_SECONDS: i64 = 60;
/// Codes one email address can receive per hour.
pub const CODES_PER_HOUR: i64 = 5;
/// Wrong passwords in a row before an account is locked.
pub const LOCKOUT_ATTEMPTS: i64 = 5;
pub const LOCKOUT_MINUTES: i64 = 15;
/// Sign-in, sign-up, and code requests one address can make per minute.
pub const IP_REQUESTS_PER_MINUTE: i64 = 20;

/// How long the mailer waits on each SMTP command before giving up.
pub const SMTP_TIMEOUT_SECONDS: u64 = 15;

/// How long a sign-in with the identity provider may take.
pub const SSO_FLOW_MINUTES: i64 = 10;
/// How long the handoff code from the callback stays valid.
pub const SSO_HANDOFF_SECONDS: i64 = 60;
pub const MAX_PENDING_SSO_FLOWS: i64 = 1_000;

/// Largest metadata object accepted, serialized.
pub const METADATA_MAX_BYTES: usize = 16 * 1024;
/// Longest display name, avatar URL, and other short text.
pub const TEXT_MAX_CHARS: usize = 255;
pub const URL_MAX_CHARS: usize = 2048;
