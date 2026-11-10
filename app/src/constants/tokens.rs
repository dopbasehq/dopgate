pub const ADMIN_ID_PREFIX: &str = "adm_";
pub const AUDIT_EVENT_ID_PREFIX: &str = "aud_";
pub const CONSOLE_KEY_ID_PREFIX: &str = "ckey_";
pub const PERSONAL_TOKEN_ID_PREFIX: &str = "pat_";
/// What a personal token starts with.
pub const PERSONAL_TOKEN_PREFIX: &str = "dgp_";
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
/// The HttpOnly cookie that carries an app's refresh token in cookie mode.
pub const REFRESH_COOKIE: &str = "dopgate_refresh";
/// The HttpOnly cookie that carries the console's refresh token.
pub const CONSOLE_REFRESH_COOKIE: &str = "dopgate_console";
/// The `aud` of console access tokens.
pub const CONSOLE_AUDIENCE: &str = "dopgate-console";
