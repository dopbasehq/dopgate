pub const ADMIN_ID_PREFIX: &str = "adm_";
pub const AGENT_ID_PREFIX: &str = "agt_";
/// What an agent token starts with.
pub const AGENT_TOKEN_PREFIX: &str = "dga_";
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
/// A backend that signs people in for them sends the service key here.
/// With it, Dopgate takes the visitor's address and browser from the two
/// headers below.
pub const BACKEND_KEY_HEADER: &str = "x-dopgate-backend-key";
/// The visitor's IP address, as the backend saw it.
pub const CLIENT_IP_HEADER: &str = "x-dopgate-client-ip";
/// The visitor's `User-Agent`, as the backend received it.
pub const CLIENT_AGENT_HEADER: &str = "x-dopgate-client-agent";
/// A browser name longer than this is cut off.
pub const USER_AGENT_MAX_CHARS: usize = 512;
/// The HttpOnly cookie that carries an app's refresh token in cookie mode.
pub const REFRESH_COOKIE: &str = "dopgate_refresh";
/// The HttpOnly cookie that carries the console's refresh token.
pub const CONSOLE_REFRESH_COOKIE: &str = "dopgate_console";
/// The `aud` of console access tokens.
pub const CONSOLE_AUDIENCE: &str = "dopgate-console";
