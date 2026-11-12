//! Backend routes shared by the HTTP server and OpenAPI.

macro_rules! api_path {
  ($path:literal) => {
    concat!("/api/v1", $path)
  };
}

pub const PREFIX: &str = "/api/";

pub mod docs {
  pub const UI: &str = "/api/docs";
  pub const OPENAPI: &str = api_path!("/openapi.json");
}

pub mod health {
  pub const ROOT: &str = api_path!("/health");
}

pub mod bootstrap {
  pub const STATUS: &str = api_path!("/bootstrap/status");
  pub const ROOT: &str = api_path!("/bootstrap/root");
}

/// End-user authentication. Your app's frontend calls these.
pub mod auth {
  /// The cookie path for an app's refresh token in cookie mode.
  pub const COOKIE_PATH: &str = "/api/v1/auth";
  pub const METHODS: &str = api_path!("/auth/methods");
  pub const SIGNUP: &str = api_path!("/auth/signup");
  pub const LOGIN: &str = api_path!("/auth/login");
  pub const REFRESH: &str = api_path!("/auth/refresh");
  pub const LOGOUT: &str = api_path!("/auth/logout");
  pub const ME: &str = api_path!("/auth/me");
  pub const PASSWORD_CHANGE: &str = api_path!("/auth/password/change");
  pub const EMAIL_CHANGE: &str = api_path!("/auth/email/change");
  /// Trade a personal token for an access token.
  pub const TOKEN: &str = api_path!("/auth/token");
}

pub mod agents {
  pub const OWN_COLLECTION: &str = api_path!("/auth/agents");
  pub const OWN_ITEM: &str = api_path!("/auth/agents/{id}");
  pub const OWN_REGENERATE: &str = api_path!("/auth/agents/{id}/regenerate");
  pub const OWN_DISABLE: &str = api_path!("/auth/agents/{id}/disable");
  pub const OWN_ENABLE: &str = api_path!("/auth/agents/{id}/enable");
  pub const ADMIN_COLLECTION: &str = api_path!("/admin/agents");
  pub const ADMIN_ITEM: &str = api_path!("/admin/agents/{id}");
  pub const ADMIN_REGENERATE: &str = api_path!("/admin/agents/{id}/regenerate");
  pub const ADMIN_DISABLE: &str = api_path!("/admin/agents/{id}/disable");
  pub const ADMIN_ENABLE: &str = api_path!("/admin/agents/{id}/enable");
}

pub mod personal_tokens {
  pub const COLLECTION: &str = api_path!("/auth/personal-tokens");
  pub const ITEM: &str = api_path!("/auth/personal-tokens/{id}");
  pub const ADMIN_COLLECTION: &str = api_path!("/admin/users/{id}/personal-tokens");
  pub const ADMIN_ITEM: &str = api_path!("/admin/users/{id}/personal-tokens/{token_id}");
}

/// Console sign-in and the signed-in admin's account. Only the console
/// calls these.
pub mod console {
  /// The cookie path for the console's refresh token.
  pub const COOKIE_PATH: &str = "/api/v1/console";
  pub const LOGIN: &str = api_path!("/console/login");
  pub const REFRESH: &str = api_path!("/console/refresh");
  pub const LOGOUT: &str = api_path!("/console/logout");
  pub const CODES_SEND: &str = api_path!("/console/codes/send");
  pub const CODES_CONFIRM: &str = api_path!("/console/codes/confirm");
  pub const PASSWORD_FORGOT: &str = api_path!("/console/password/forgot");
  pub const PASSWORD_RESET: &str = api_path!("/console/password/reset");
  pub const PASSWORD_CHANGE: &str = api_path!("/console/password/change");
  pub const ME: &str = api_path!("/console/me");
  pub const EMAIL_CHANGE: &str = api_path!("/console/email/change");
  pub const SESSIONS: &str = api_path!("/console/sessions");
  pub const SESSION: &str = api_path!("/console/sessions/{id}");
}

pub mod recovery {
  pub const FORGOT: &str = api_path!("/auth/password/forgot");
  pub const RESET: &str = api_path!("/auth/password/reset");
}

pub mod verification {
  pub const SEND: &str = api_path!("/auth/verification/send");
  pub const CONFIRM: &str = api_path!("/auth/verification/confirm");
}

pub mod sessions {
  pub const COLLECTION: &str = api_path!("/auth/sessions");
  pub const ITEM: &str = api_path!("/auth/sessions/{id}");
}

pub mod mfa {
  pub const TOTP: &str = api_path!("/auth/mfa/totp");
  pub const TOTP_ENROLL: &str = api_path!("/auth/mfa/totp/enroll");
  pub const TOTP_VERIFY: &str = api_path!("/auth/mfa/totp/verify");
  pub const CHALLENGE: &str = api_path!("/auth/mfa/challenge");
}

pub mod sso {
  pub const PROVIDERS: &str = api_path!("/auth/sso/providers");
  pub const START: &str = api_path!("/auth/sso/{provider_id}/start");
  pub const CALLBACK: &str = api_path!("/auth/sso/callback");
  pub const EXCHANGE: &str = api_path!("/auth/sso/exchange");
  pub const ADMIN_PRESETS: &str = api_path!("/admin/sso/presets");
  pub const ADMIN_PROVIDERS: &str = api_path!("/admin/sso/providers");
  pub const ADMIN_PROVIDER: &str = api_path!("/admin/sso/providers/{id}");
}

pub mod users {
  pub const COLLECTION: &str = api_path!("/admin/users");
  pub const ITEM: &str = api_path!("/admin/users/{id}");
  pub const SESSIONS: &str = api_path!("/admin/users/{id}/sessions");
  pub const DISABLE: &str = api_path!("/admin/users/{id}/disable");
  pub const ENABLE: &str = api_path!("/admin/users/{id}/enable");
  pub const PASSWORD_RESET: &str = api_path!("/admin/users/{id}/password-reset");
}

pub mod admins {
  pub const COLLECTION: &str = api_path!("/admin/admins");
  pub const ITEM: &str = api_path!("/admin/admins/{id}");
  pub const DISABLE: &str = api_path!("/admin/admins/{id}/disable");
  pub const ENABLE: &str = api_path!("/admin/admins/{id}/enable");
}

pub mod email_templates {
  pub const COLLECTION: &str = api_path!("/admin/email-templates");
  pub const ITEM: &str = api_path!("/admin/email-templates/{name}");
  pub const PREVIEW: &str = api_path!("/admin/email-templates/{name}/preview");
  pub const TEST: &str = api_path!("/admin/email-templates/{name}/test");
}

pub mod keys {
  pub const JWKS: &str = "/.well-known/jwks.json";
  pub const COLLECTION: &str = api_path!("/admin/keys");
  pub const ROTATE: &str = api_path!("/admin/keys/rotate");
}

pub mod settings {
  pub const ROOT: &str = api_path!("/admin/settings");
  pub const SMTP_TEST: &str = api_path!("/admin/settings/smtp/test");
}

pub mod audit {
  pub const COLLECTION: &str = api_path!("/admin/audit-events");
  pub const VERIFY: &str = api_path!("/admin/audit-events/verify");
}
