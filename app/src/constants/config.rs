/// Default network port. Change here and `DEFAULT_BIND_ADDRESS` /
/// `DEFAULT_PUBLIC_URL` must stay in sync.
pub const DEFAULT_PORT: u16 = 8850;
pub const DEFAULT_BIND_ADDRESS: &str = "127.0.0.1:8850";
pub const DEFAULT_PUBLIC_URL: &str = "http://localhost:8850";
pub const SERVER_HOST_PLACEHOLDER: &str = "SERVER_HOST";
pub const DATA_DIRECTORY_NAME: &str = ".dopgate";
pub const DATABASE_FILENAME: &str = "dopgate.db";
pub const MASTER_KEY_FILENAME: &str = "master.key";
pub const SERVER_CONFIG_FILENAME: &str = "server.toml";

/// Subdirectory of the data directory where retention archives expired audit
/// records before deleting them.
pub const AUDIT_ARCHIVE_DIRECTORY_NAME: &str = "audit-archive";

/// How often a running server applies audit retention. Records can outlive
/// `audit_retention_days` by up to this long.
pub const AUDIT_RETENTION_INTERVAL: std::time::Duration =
  std::time::Duration::from_secs(24 * 60 * 60);

pub const ENV_AUDIT_RETENTION_DAYS: &str = "DOPGATE_AUDIT_RETENTION_DAYS";
pub const ENV_TRUSTED_PROXIES: &str = "DOPGATE_TRUSTED_PROXIES";
pub const ENV_DATA_DIR: &str = "DOPGATE_DATA_DIR";
pub const ENV_DOCS: &str = "DOPGATE_DOCS";
pub const ENV_WEB_UI: &str = "DOPGATE_WEB_UI";
pub const ENV_HOST: &str = "DOPGATE_HOST";
pub const ENV_MASTER_KEY_PATH: &str = "DOPGATE_MASTER_KEY_PATH";
pub const ENV_PORT: &str = "DOPGATE_PORT";
pub const ENV_PUBLIC_URL: &str = "DOPGATE_PUBLIC_URL";
pub const ENV_ROOT_EMAIL: &str = "DOPGATE_ROOT_EMAIL";
pub const ENV_ROOT_PASSWORD: &str = "DOPGATE_ROOT_PASSWORD";
pub const ENV_SHUTDOWN_GRACE_SECONDS: &str = "DOPGATE_SHUTDOWN_GRACE_SECONDS";
pub const ENV_SMTP_FROM_EMAIL: &str = "DOPGATE_SMTP_FROM_EMAIL";
pub const ENV_SMTP_FROM_NAME: &str = "DOPGATE_SMTP_FROM_NAME";
pub const ENV_SMTP_HOST: &str = "DOPGATE_SMTP_HOST";
pub const ENV_SMTP_PASSWORD: &str = "DOPGATE_SMTP_PASSWORD";
pub const ENV_SMTP_PORT: &str = "DOPGATE_SMTP_PORT";
pub const ENV_SMTP_SECURITY: &str = "DOPGATE_SMTP_SECURITY";
pub const ENV_SMTP_USERNAME: &str = "DOPGATE_SMTP_USERNAME";
