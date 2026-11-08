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

/// End-user authentication. Apps call these with their publishable key.
pub mod auth {
  pub const METHODS: &str = api_path!("/auth/methods");
  pub const SIGNUP: &str = api_path!("/auth/signup");
  pub const LOGIN: &str = api_path!("/auth/login");
  pub const REFRESH: &str = api_path!("/auth/refresh");
  pub const LOGOUT: &str = api_path!("/auth/logout");
  pub const ME: &str = api_path!("/auth/me");
  pub const PASSWORD_CHANGE: &str = api_path!("/auth/password/change");
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
}

pub mod clients {
  pub const COLLECTION: &str = api_path!("/admin/clients");
  pub const ITEM: &str = api_path!("/admin/clients/{id}");
  pub const SECRET: &str = api_path!("/admin/clients/{id}/secret");
}

pub mod keys {
  pub const JWKS: &str = "/.well-known/jwks.json";
  pub const COLLECTION: &str = api_path!("/admin/keys");
  pub const ROTATE: &str = api_path!("/admin/keys/rotate");
}

/// dopgate as an OpenID Connect provider for other apps. Planned.
pub mod oidc_provider {
  pub const DISCOVERY: &str = "/.well-known/openid-configuration";
  pub const AUTHORIZE: &str = "/oauth/authorize";
  pub const TOKEN: &str = "/oauth/token";
  pub const USERINFO: &str = "/oauth/userinfo";
}

pub mod settings {
  pub const ROOT: &str = api_path!("/admin/settings");
  pub const SMTP_TEST: &str = api_path!("/admin/settings/smtp/test");
}

pub mod audit {
  pub const COLLECTION: &str = api_path!("/admin/audit-events");
  pub const VERIFY: &str = api_path!("/admin/audit-events/verify");
}

pub mod backups {
  pub const COLLECTION: &str = api_path!("/admin/backups");
  pub const ITEM: &str = api_path!("/admin/backups/{key}");
  pub const RESTORE: &str = api_path!("/admin/backups/{key}/restore");
  pub const EXPORT: &str = api_path!("/admin/export");
  pub const IMPORT: &str = api_path!("/admin/import");
}
