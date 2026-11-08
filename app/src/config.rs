use std::{
  env, fs,
  net::{IpAddr, SocketAddr},
  path::{Path, PathBuf},
  str::FromStr,
};

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use url::{Host, Url};

use crate::constants::config::{
  AUDIT_ARCHIVE_DIRECTORY_NAME, DATA_DIRECTORY_NAME, DATABASE_FILENAME, DEFAULT_PORT,
  ENV_AUDIT_RETENTION_DAYS, ENV_DATA_DIR, ENV_DOCS, ENV_HOST, ENV_MASTER_KEY_PATH, ENV_PORT,
  ENV_PUBLIC_URL, ENV_SHUTDOWN_GRACE_SECONDS, ENV_SMTP_FROM_EMAIL, ENV_SMTP_FROM_NAME,
  ENV_SMTP_HOST, ENV_SMTP_PASSWORD, ENV_SMTP_PORT, ENV_SMTP_SECURITY, ENV_SMTP_USERNAME,
  ENV_TRUSTED_PROXIES, ENV_WEB_UI, MASTER_KEY_FILENAME, SERVER_CONFIG_FILENAME,
  SERVER_HOST_PLACEHOLDER,
};
pub use crate::constants::config::{DEFAULT_BIND_ADDRESS, DEFAULT_PUBLIC_URL};
use crate::services::mailer::{self, SmtpSecurity};

pub fn validate_endpoint_transport(url: &Url) -> Result<()> {
  if !matches!(url.scheme(), "http" | "https") {
    bail!("URL must use HTTP or HTTPS");
  }
  Ok(())
}

#[derive(Clone, Debug, Serialize)]
pub struct MasterKeyConfig {
  pub provider: String,
  pub path: PathBuf,
}

#[derive(Clone, Debug, Serialize)]
pub struct ServerConfig {
  #[serde(skip)]
  pub data_dir: PathBuf,
  #[serde(skip)]
  pub config_path: PathBuf,
  pub version: u32,
  pub bind_address: String,
  pub public_url: String,
  pub database_url: String,
  pub shutdown_grace_seconds: u64,
  /// Days audit records are kept before they are archived and deleted.
  /// Unset keeps them forever. New instances get a year through the
  /// generated `server.toml`.
  #[serde(skip)]
  pub audit_retention_days: Option<u64>,
  /// Reverse proxies allowed to report the client address through
  /// `X-Forwarded-For`. Empty trusts no one, so audit records store the
  /// connection's peer address.
  #[serde(skip)]
  pub trusted_proxies: Vec<crate::services::client_ip::ProxyNetwork>,
  #[serde(skip)]
  pub docs_enabled: bool,
  #[serde(skip)]
  pub web_ui_enabled: bool,
  pub master_key: MasterKeyConfig,
  /// SMTP from server.toml or `DOPGATE_SMTP_*`. The mailer uses it while
  /// the runtime settings have no SMTP host.
  #[serde(skip)]
  pub smtp: SmtpServerConfig,
  /// Records whether the public URL was configured or derived at startup.
  #[serde(skip)]
  pub public_url_source: PublicUrlSource,
}

/// The `[smtp]` table. No host means no SMTP server here.
#[derive(Clone, Default)]
pub struct SmtpServerConfig {
  pub host: Option<String>,
  /// Unset means the usual port for `security`.
  pub port: Option<u16>,
  pub security: SmtpSecurity,
  pub username: Option<String>,
  pub password: Option<String>,
  pub from_email: Option<String>,
  pub from_name: Option<String>,
}

impl std::fmt::Debug for SmtpServerConfig {
  fn fmt(
    &self,
    formatter: &mut std::fmt::Formatter<'_>,
  ) -> std::fmt::Result {
    formatter
      .debug_struct("SmtpServerConfig")
      .field("host", &self.host)
      .field("port", &self.port)
      .field("security", &self.security)
      .field("username", &self.username)
      .field("password", &self.password.as_ref().map(|_| "<redacted>"))
      .field("from_email", &self.from_email)
      .field("from_name", &self.from_name)
      .finish()
  }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PublicUrlSource {
  Explicit,
  LoopbackDefault,
  NetworkPlaceholder,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct ServerOverrides {
  pub data_dir: Option<PathBuf>,
  pub config_path: Option<PathBuf>,
  pub public_url: Option<String>,
  pub port: Option<u16>,
  pub host: Option<String>,
  pub shutdown_grace_seconds: Option<u64>,
  pub docs: Option<bool>,
  pub web_ui: Option<bool>,
  pub master_key_path: Option<PathBuf>,
}

#[derive(Debug, Default, Deserialize)]
struct ServerConfigFile {
  version: Option<u32>,
  public_url: Option<String>,
  port: Option<u16>,
  host: Option<String>,
  shutdown_grace_seconds: Option<u64>,
  audit_retention_days: Option<u64>,
  trusted_proxies: Option<Vec<String>>,
  docs: Option<bool>,
  web_ui: Option<bool>,
  master_key: Option<MasterKeyConfigFile>,
  smtp: Option<SmtpConfigFile>,
}

#[derive(Debug, Default, Deserialize)]
struct SmtpConfigFile {
  host: Option<String>,
  port: Option<u16>,
  security: Option<SmtpSecurity>,
  username: Option<String>,
  password: Option<String>,
  from_email: Option<String>,
  from_name: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
struct MasterKeyConfigFile {
  provider: Option<String>,
  path: Option<PathBuf>,
}

/// `DOPGATE_*` environment overrides, structured so tests (and any embedder)
/// can resolve configuration from injected values instead of process state.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct EnvironmentOverrides {
  pub data_dir: Option<PathBuf>,
  pub public_url: Option<String>,
  pub port: Option<String>,
  pub host: Option<String>,
  pub shutdown_grace_seconds: Option<String>,
  pub audit_retention_days: Option<String>,
  pub trusted_proxies: Option<String>,
  pub docs: Option<String>,
  pub web_ui: Option<String>,
  pub master_key_path: Option<PathBuf>,
  pub smtp_host: Option<String>,
  pub smtp_port: Option<String>,
  pub smtp_security: Option<String>,
  pub smtp_username: Option<String>,
  pub smtp_password: Option<String>,
  pub smtp_from_email: Option<String>,
  pub smtp_from_name: Option<String>,
}

impl EnvironmentOverrides {
  pub(crate) fn read() -> Self {
    Self {
      data_dir: env::var_os(ENV_DATA_DIR).map(PathBuf::from),
      public_url: env::var(ENV_PUBLIC_URL).ok(),
      port: env::var(ENV_PORT).ok(),
      host: env::var(ENV_HOST).ok(),
      shutdown_grace_seconds: env::var(ENV_SHUTDOWN_GRACE_SECONDS).ok(),
      audit_retention_days: env::var(ENV_AUDIT_RETENTION_DAYS).ok(),
      trusted_proxies: env::var(ENV_TRUSTED_PROXIES).ok(),
      docs: env::var(ENV_DOCS).ok(),
      web_ui: env::var(ENV_WEB_UI).ok(),
      master_key_path: env::var_os(ENV_MASTER_KEY_PATH).map(PathBuf::from),
      smtp_host: env::var(ENV_SMTP_HOST).ok(),
      smtp_port: env::var(ENV_SMTP_PORT).ok(),
      smtp_security: env::var(ENV_SMTP_SECURITY).ok(),
      smtp_username: env::var(ENV_SMTP_USERNAME).ok(),
      smtp_password: env::var(ENV_SMTP_PASSWORD).ok(),
      smtp_from_email: env::var(ENV_SMTP_FROM_EMAIL).ok(),
      smtp_from_name: env::var(ENV_SMTP_FROM_NAME).ok(),
    }
  }
}

impl Default for MasterKeyConfig {
  fn default() -> Self {
    Self {
      provider: "file".into(),
      path: dopgate_home().join(MASTER_KEY_FILENAME),
    }
  }
}

impl Default for ServerConfig {
  fn default() -> Self {
    Self::for_data_dir(dopgate_home())
  }
}

impl ServerConfig {
  fn for_data_dir(data_dir: PathBuf) -> Self {
    Self {
      config_path: data_dir.join(SERVER_CONFIG_FILENAME),
      database_url: sqlite_url(&data_dir.join(DATABASE_FILENAME)),
      master_key: MasterKeyConfig {
        provider: "file".into(),
        path: data_dir.join(MASTER_KEY_FILENAME),
      },
      data_dir,
      version: 1,
      bind_address: DEFAULT_BIND_ADDRESS.into(),
      public_url: DEFAULT_PUBLIC_URL.into(),
      shutdown_grace_seconds: 10,
      audit_retention_days: None,
      trusted_proxies: Vec::new(),
      docs_enabled: true,
      web_ui_enabled: false,
      public_url_source: PublicUrlSource::LoopbackDefault,
      smtp: SmtpServerConfig::default(),
    }
  }

  pub fn load(overrides: &ServerOverrides) -> Result<Self> {
    Self::load_with_environment(overrides, EnvironmentOverrides::read())
  }

  pub fn load_with_environment(
    overrides: &ServerOverrides,
    environment: EnvironmentOverrides,
  ) -> Result<Self> {
    Self::load_with_environment_at(overrides, environment, &env::current_dir()?)
  }

  pub(crate) fn load_with_environment_at(
    overrides: &ServerOverrides,
    environment: EnvironmentOverrides,
    working_directory: &Path,
  ) -> Result<Self> {
    let fallback = dopgate_home();
    let selected_data_dir = overrides
      .data_dir
      .as_deref()
      .or(environment.data_dir.as_deref())
      .unwrap_or(&fallback);
    let data_dir = resolve_path_from(selected_data_dir, working_directory)?;
    let config_path = overrides
      .config_path
      .as_deref()
      .map(|path| resolve_path_from(path, working_directory))
      .transpose()?
      .unwrap_or_else(|| data_dir.join(SERVER_CONFIG_FILENAME));
    let mut config = Self::for_data_dir(data_dir);
    config.config_path.clone_from(&config_path);

    let file_port;
    let file_host;
    if config_path.exists() {
      let contents = fs::read_to_string(&config_path)
        .with_context(|| format!("failed to read {}", config_path.display()))?;
      let file: ServerConfigFile = toml::from_str(&contents)
        .with_context(|| format!("failed to parse {}", config_path.display()))?;
      file_port = file.port;
      file_host = file.host.clone();
      config.apply_file(file)?;
    } else {
      file_port = None;
      file_host = None;
    }

    let environment_port = environment
      .port
      .clone()
      .map(|value| value.parse::<u16>().context("invalid DOPGATE_PORT"))
      .transpose()?;
    let environment_host = environment.host.clone();
    config.apply_environment(environment)?;
    config.apply_overrides(overrides);

    // The `port` and `host` selectors (CLI > environment > file) compose the
    // listener address.
    config.select_bind_address(
      overrides.port.or(environment_port).or(file_port),
      overrides.host.clone().or(environment_host).or(file_host),
    )?;
    config.derive_public_url()?;
    config.smtp.check()?;
    config.master_key.path = resolve_path_from(&config.master_key.path, working_directory)?;
    config.validate()?;
    Ok(config)
  }

  fn apply_file(
    &mut self,
    file: ServerConfigFile,
  ) -> Result<()> {
    if let Some(value) = file.version {
      self.version = value;
    }
    if let Some(value) = file.public_url {
      self.public_url = value;
      self.public_url_source = PublicUrlSource::Explicit;
    }
    if let Some(value) = file.shutdown_grace_seconds {
      self.shutdown_grace_seconds = value;
    }
    if let Some(value) = file.audit_retention_days {
      self.audit_retention_days = Some(value);
    }
    if let Some(values) = file.trusted_proxies {
      self.trusted_proxies = values
        .iter()
        .map(|value| value.parse())
        .collect::<Result<_>>()
        .context("invalid trusted_proxies")?;
    }
    if let Some(value) = file.web_ui {
      self.web_ui_enabled = value;
    }
    if let Some(value) = file.docs {
      self.docs_enabled = value;
    }
    if let Some(master_key) = file.master_key {
      if let Some(value) = master_key.provider {
        self.master_key.provider = value;
      }
      if let Some(value) = master_key.path {
        self.master_key.path = value;
      }
    }
    if let Some(smtp) = file.smtp {
      self.smtp = SmtpServerConfig {
        host: smtp.host,
        port: smtp.port,
        security: smtp.security.unwrap_or_default(),
        username: smtp.username,
        password: smtp.password,
        from_email: smtp.from_email,
        from_name: smtp.from_name,
      };
    }
    Ok(())
  }

  fn apply_environment(
    &mut self,
    environment: EnvironmentOverrides,
  ) -> Result<()> {
    if let Some(value) = environment.public_url {
      self.public_url = value;
      self.public_url_source = PublicUrlSource::Explicit;
    }
    if let Some(value) = environment.shutdown_grace_seconds {
      self.shutdown_grace_seconds = value
        .parse()
        .context("invalid DOPGATE_SHUTDOWN_GRACE_SECONDS")?;
    }
    if let Some(value) = environment.audit_retention_days {
      self.audit_retention_days = Some(
        value
          .parse()
          .context("invalid DOPGATE_AUDIT_RETENTION_DAYS")?,
      );
    }
    if let Some(value) = environment.trusted_proxies {
      self.trusted_proxies = crate::services::client_ip::parse_list(&value)
        .context("invalid DOPGATE_TRUSTED_PROXIES")?;
    }
    if let Some(value) = environment.web_ui {
      self.web_ui_enabled = value.parse().context("invalid DOPGATE_WEB_UI")?;
    }
    if let Some(value) = environment.docs {
      self.docs_enabled = value.parse().context("invalid DOPGATE_DOCS")?;
    }
    if let Some(value) = environment.master_key_path {
      self.master_key.path = value;
    }
    let smtp = &mut self.smtp;
    if let Some(value) = environment.smtp_host {
      smtp.host = Some(value);
    }
    if let Some(value) = environment.smtp_port {
      smtp.port = Some(value.parse().context("invalid DOPGATE_SMTP_PORT")?);
    }
    if let Some(value) = environment.smtp_security {
      smtp.security = value
        .parse()
        .map_err(anyhow::Error::msg)
        .context("invalid DOPGATE_SMTP_SECURITY")?;
    }
    if let Some(value) = environment.smtp_username {
      smtp.username = Some(value);
    }
    if let Some(value) = environment.smtp_password {
      smtp.password = Some(value);
    }
    if let Some(value) = environment.smtp_from_email {
      smtp.from_email = Some(value);
    }
    if let Some(value) = environment.smtp_from_name {
      smtp.from_name = Some(value);
    }
    Ok(())
  }

  fn apply_overrides(
    &mut self,
    overrides: &ServerOverrides,
  ) {
    if let Some(value) = &overrides.public_url {
      self.public_url.clone_from(value);
      self.public_url_source = PublicUrlSource::Explicit;
    }
    if let Some(value) = overrides.shutdown_grace_seconds {
      self.shutdown_grace_seconds = value;
    }
    if let Some(value) = overrides.web_ui {
      self.web_ui_enabled = value;
    }
    if let Some(value) = overrides.docs {
      self.docs_enabled = value;
    }
    if let Some(value) = &overrides.master_key_path {
      self.master_key.path.clone_from(value);
    }
  }

  /// Create missing configuration references without changing saved settings.
  pub fn ensure_reference_files(&self) -> Result<()> {
    ensure_data_dir(&self.data_dir)?;
    let mut reference = include_str!("config/server.toml")
      .replace("{{PORT}}", &DEFAULT_PORT.to_string())
      .replace("{{PUBLIC_URL}}", DEFAULT_PUBLIC_URL);
    let key_path =
      std::collections::BTreeMap::from([("path", self.data_dir.join(MASTER_KEY_FILENAME))]);
    for line in toml::to_string(&key_path)?.lines() {
      reference.push_str("# ");
      reference.push_str(line);
      reference.push('\n');
    }
    crate::utils::private_file::write_if_missing(&self.config_path, reference.as_bytes())?;
    Ok(())
  }

  pub fn bind_addr(&self) -> Result<SocketAddr> {
    self.bind_address.parse().context("invalid bind address")
  }

  /// Compose the bind address from the `port` and `host` selectors.
  fn select_bind_address(
    &mut self,
    port: Option<u16>,
    host: Option<String>,
  ) -> Result<()> {
    if port.is_none() && host.is_none() {
      return Ok(());
    }
    let host = host.as_deref().unwrap_or("127.0.0.1");
    let ip = match host {
      "localhost" => IpAddr::from([127, 0, 0, 1]),
      other => other.parse::<IpAddr>().with_context(|| {
        format!("invalid host \"{other}\": use an IP address like 127.0.0.1 or 0.0.0.0")
      })?,
    };
    self.bind_address = format!("{ip}:{}", port.unwrap_or(DEFAULT_PORT));
    Ok(())
  }

  /// Derive a client-facing URL when no explicit public URL was configured.
  fn derive_public_url(&mut self) -> Result<()> {
    if self.public_url_source == PublicUrlSource::Explicit {
      return Ok(());
    }
    let bind: SocketAddr = self.bind_address.parse().context("invalid bind_address")?;
    let (public_url, source) = resolve_implicit_public_url(bind);
    self.public_url = public_url;
    self.public_url_source = source;
    Ok(())
  }

  pub fn public_url_warning(&self) -> Option<String> {
    if self.public_url_source == PublicUrlSource::NetworkPlaceholder {
      return Some(
        "Replace SERVER_HOST with this server's public IP address or domain.\n\
         Set --public-url, DOPGATE_PUBLIC_URL, or public_url in server.toml to save the address.\n\
         HTTP does not encrypt passwords or tokens."
          .into(),
      );
    }

    let public = Url::parse(&self.public_url).ok()?;
    (public.scheme() == "http" && !url_is_loopback(&public)).then(|| {
      format!(
        "The public URL {} uses HTTP. Passwords and tokens are not encrypted. Use HTTPS for deployments.",
        self.public_url
      )
    })
  }

  /// The audit retention policy, or `None` when records are kept forever.
  pub fn audit_retention(&self) -> Option<crate::services::audit_chain::Retention> {
    self.audit_retention_days.map(|keep_days| {
      crate::services::audit_chain::Retention::new(
        self.data_dir.join(AUDIT_ARCHIVE_DIRECTORY_NAME),
        keep_days,
      )
    })
  }

  pub fn validate(&self) -> Result<()> {
    if self.version != 1 {
      bail!("unsupported server configuration version {}", self.version);
    }
    if self.audit_retention_days == Some(0) {
      bail!("audit_retention_days must be at least 1 day");
    }
    let bind = SocketAddr::from_str(&self.bind_address).context("invalid bind_address")?;
    if self.public_url_source == PublicUrlSource::Explicit {
      let public = Url::parse(&self.public_url).context("invalid public_url")?;
      if !matches!(public.scheme(), "http" | "https") || public.host_str().is_none() {
        bail!("public_url must be an absolute HTTP or HTTPS URL");
      }
      validate_endpoint_transport(&public)?;
    } else {
      let public = Url::parse(&self.public_url).context("invalid derived public_url")?;
      if public.scheme() != "http" || public.host_str().is_none() {
        bail!("derived public_url must be an absolute HTTP URL");
      }
      match self.public_url_source {
        PublicUrlSource::LoopbackDefault if !bind.ip().is_loopback() => {
          bail!("a non-loopback bind address cannot use the loopback public URL");
        }
        PublicUrlSource::NetworkPlaceholder if bind.ip().is_loopback() => {
          bail!("a loopback bind address cannot use the SERVER_HOST placeholder");
        }
        PublicUrlSource::NetworkPlaceholder
          if self.public_url != format!("http://{SERVER_HOST_PLACEHOLDER}:{}", bind.port()) =>
        {
          bail!("the network public URL must use the SERVER_HOST placeholder");
        }
        _ => {}
      }
    }
    if !self.database_url.starts_with("sqlite:") {
      bail!("database_url must use SQLite");
    }
    if !(1..=300).contains(&self.shutdown_grace_seconds) {
      bail!("shutdown_grace_seconds must be between 1 and 300");
    }
    if self.master_key.provider != "file" {
      bail!("only the file master-key provider is supported");
    }
    if self.master_key.path.as_os_str().is_empty() {
      bail!("master_key.path is required");
    }
    Ok(())
  }
}

impl SmtpServerConfig {
  /// Trim the values, treat empty ones as unset, and refuse the rest of
  /// what the admin API refuses.
  fn check(&mut self) -> Result<()> {
    for value in [
      &mut self.host,
      &mut self.username,
      &mut self.from_email,
      &mut self.from_name,
    ] {
      *value = value
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned);
    }
    // Passwords keep their spaces.
    if self.password.as_deref() == Some("") {
      self.password = None;
    }
    if self.port == Some(0) {
      bail!("smtp port must be between 1 and 65535");
    }
    if self
      .host
      .as_deref()
      .is_some_and(|host| !mailer::valid_host(host))
    {
      bail!("smtp host must be a host name or IP address, without a scheme or port");
    }
    for (name, value) in [("username", &self.username), ("from_name", &self.from_name)] {
      if value
        .as_deref()
        .is_some_and(|value| !mailer::header_safe(value))
      {
        bail!("smtp {name} cannot contain line breaks");
      }
    }
    if let Some(address) = &self.from_email {
      self.from_email = Some(
        mailer::normalize_from_email(address)
          .with_context(|| format!("smtp from_email \"{address}\" is not a valid address"))?,
      );
    }
    if self.host.is_some() && self.from_email.is_none() {
      bail!("smtp from_email is required when smtp host is set");
    }
    Ok(())
  }

  /// The SMTP server to send through, when a host is set.
  pub fn mailer_config(&self) -> Option<mailer::SmtpConfig> {
    let (host, from_email) = (self.host.clone()?, self.from_email.clone()?);
    Some(mailer::SmtpConfig {
      host,
      port: self.port.unwrap_or_else(|| self.security.default_port()),
      security: self.security,
      username: self.username.clone(),
      password: self.password.clone().map(zeroize::Zeroizing::new),
      from_email,
      from_name: self.from_name.clone(),
    })
  }
}

fn url_is_loopback(url: &Url) -> bool {
  match url.host() {
    Some(Host::Domain(host)) => host == "localhost",
    Some(Host::Ipv4(host)) => host.is_loopback(),
    Some(Host::Ipv6(host)) => host.is_loopback(),
    None => false,
  }
}

#[doc(hidden)]
pub fn resolve_implicit_public_url(bind: SocketAddr) -> (String, PublicUrlSource) {
  if bind.ip().is_loopback() {
    return (
      format!("http://localhost:{}", bind.port()),
      PublicUrlSource::LoopbackDefault,
    );
  }
  (
    format!("http://{SERVER_HOST_PLACEHOLDER}:{}", bind.port()),
    PublicUrlSource::NetworkPlaceholder,
  )
}

pub fn resolve_data_dir(argument: Option<&Path>) -> Result<PathBuf> {
  let environment = env::var_os(ENV_DATA_DIR).map(PathBuf::from);
  let fallback = dopgate_home();
  resolve_path(argument.or(environment.as_deref()).unwrap_or(&fallback))
}

pub fn dopgate_home() -> PathBuf {
  env::home_dir()
    .map(|home| home.join(DATA_DIRECTORY_NAME))
    .unwrap_or_else(|| PathBuf::from(DATA_DIRECTORY_NAME))
}

pub fn ensure_data_dir(path: &Path) -> Result<()> {
  let existed = path.exists();
  fs::create_dir_all(path)
    .with_context(|| format!("failed to create data directory {}", path.display()))?;
  #[cfg(unix)]
  if !existed {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
      .with_context(|| format!("failed to secure data directory {}", path.display()))?;
  }
  Ok(())
}

pub fn sqlite_url(path: &Path) -> String {
  format!("sqlite://{}", path.to_string_lossy().replace('\\', "/"))
}

pub fn database_path(url: &str) -> Result<PathBuf> {
  let path = url
    .strip_prefix("sqlite://")
    .or_else(|| url.strip_prefix("sqlite:"))
    .context("database URL is not SQLite")?;
  Ok(PathBuf::from(path.split('?').next().unwrap_or(path)))
}

fn resolve_path(path: &Path) -> Result<PathBuf> {
  resolve_path_from(
    path,
    &env::current_dir().context("failed to resolve current directory")?,
  )
}

fn resolve_path_from(
  path: &Path,
  working_directory: &Path,
) -> Result<PathBuf> {
  let expanded = expand_home(path);
  if expanded.is_absolute() {
    Ok(expanded)
  } else {
    Ok(working_directory.join(expanded))
  }
}

fn expand_home(path: &Path) -> PathBuf {
  let value = path.to_string_lossy();
  let Some(home) = env::home_dir() else {
    return path.to_path_buf();
  };
  if value == "~" {
    return home;
  }
  if let Some(rest) = value.strip_prefix("~/") {
    return home.join(rest);
  }
  path.to_path_buf()
}
