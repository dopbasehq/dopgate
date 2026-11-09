pub const AUDIT_EVENT_ID_PREFIX: &str = "aud_";
pub const REFRESH_TOKEN_ID_PREFIX: &str = "rft_";
pub const REFRESH_TOKEN_PREFIX: &str = "dgr_";
pub const SESSION_ID_PREFIX: &str = "ses_";
pub const SETUP_TOKEN_PREFIX: &str = "setup_";
pub const SIGNING_KEY_ID_PREFIX: &str = "key_";
pub const SSO_FLOW_ID_PREFIX: &str = "ssf_";
pub const SSO_HANDOFF_PREFIX: &str = "ssoh_";
pub const SSO_IDENTITY_ID_PREFIX: &str = "idn_";
pub const SSO_PROVIDER_ID_PREFIX: &str = "sso_";
pub const USER_ID_PREFIX: &str = "usr_";
pub const VERIFICATION_ID_PREFIX: &str = "vrf_";

/// The console asks for cookie sessions with this header. The refresh token
/// then travels in an HttpOnly cookie instead of the response body.
pub const SESSION_MODE_HEADER: &str = "x-dopgate-session";
pub const SESSION_MODE_COOKIE: &str = "cookie";
/// The HttpOnly cookie that carries the console's refresh token.
pub const REFRESH_COOKIE: &str = "dopgate_refresh";
