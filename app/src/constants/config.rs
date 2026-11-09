/// Default network port. Change here and `DEFAULT_BIND_ADDRESS` /
/// `DEFAULT_PUBLIC_URL` must stay in sync.
pub const DEFAULT_PORT: u16 = 8850;
pub const DEFAULT_BIND_ADDRESS: &str = "127.0.0.1:8850";
pub const DEFAULT_PUBLIC_URL: &str = "http://localhost:8850";
pub const SERVER_HOST_PLACEHOLDER: &str = "SERVER_HOST";

/// The Postgres schema every Dopgate table lives in, unless
/// `DOPGATE_DATABASE_SCHEMA` names another one.
pub const DEFAULT_DATABASE_SCHEMA: &str = "dopgate";

/// Audit records are kept this long unless configured otherwise.
pub const DEFAULT_AUDIT_RETENTION_DAYS: u64 = 365;

/// How often a running server applies audit retention. Records can outlive
/// `audit_retention_days` by up to this long.
pub const AUDIT_RETENTION_INTERVAL: std::time::Duration =
  std::time::Duration::from_secs(24 * 60 * 60);

/// How long startup keeps retrying a database that is not up yet, as when
/// Postgres and Dopgate start together in one compose stack.
pub const DATABASE_READY_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

/// The service key must be at least this long, so it cannot be guessed.
pub const SERVICE_KEY_MIN_LENGTH: usize = 32;

pub const ENV_ALLOWED_ORIGINS: &str = "DOPGATE_ALLOWED_ORIGINS";
pub const ENV_AUDIT_RETENTION_DAYS: &str = "DOPGATE_AUDIT_RETENTION_DAYS";
pub const ENV_CONFIG: &str = "DOPGATE_CONFIG";
pub const ENV_DATABASE_MAX_CONNECTIONS: &str = "DOPGATE_DATABASE_MAX_CONNECTIONS";
pub const ENV_DATABASE_SCHEMA: &str = "DOPGATE_DATABASE_SCHEMA";
pub const ENV_DATABASE_URL: &str = "DOPGATE_DATABASE_URL";
pub const ENV_DOCS: &str = "DOPGATE_DOCS";
pub const ENV_HOST: &str = "DOPGATE_HOST";
pub const ENV_PORT: &str = "DOPGATE_PORT";
pub const ENV_PUBLIC_URL: &str = "DOPGATE_PUBLIC_URL";
pub const ENV_ROOT_EMAIL: &str = "DOPGATE_ROOT_EMAIL";
pub const ENV_ROOT_PASSWORD: &str = "DOPGATE_ROOT_PASSWORD";
pub const ENV_SERVICE_KEY: &str = "DOPGATE_SERVICE_KEY";
pub const ENV_SHUTDOWN_GRACE_SECONDS: &str = "DOPGATE_SHUTDOWN_GRACE_SECONDS";
pub const ENV_SMTP_FROM_EMAIL: &str = "DOPGATE_SMTP_FROM_EMAIL";
pub const ENV_SMTP_FROM_NAME: &str = "DOPGATE_SMTP_FROM_NAME";
pub const ENV_SMTP_HOST: &str = "DOPGATE_SMTP_HOST";
pub const ENV_SMTP_PASSWORD: &str = "DOPGATE_SMTP_PASSWORD";
pub const ENV_SMTP_PORT: &str = "DOPGATE_SMTP_PORT";
pub const ENV_SMTP_SECURITY: &str = "DOPGATE_SMTP_SECURITY";
pub const ENV_SMTP_USERNAME: &str = "DOPGATE_SMTP_USERNAME";
pub const ENV_TRUSTED_PROXIES: &str = "DOPGATE_TRUSTED_PROXIES";
pub const ENV_WEB_UI: &str = "DOPGATE_WEB_UI";
