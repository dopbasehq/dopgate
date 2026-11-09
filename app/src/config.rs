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
  DEFAULT_AUDIT_RETENTION_DAYS, DEFAULT_DATABASE_SCHEMA, DEFAULT_PORT, ENV_ALLOWED_ORIGINS,
  ENV_AUDIT_RETENTION_DAYS, ENV_CONFIG, ENV_DATABASE_MAX_CONNECTIONS, ENV_DATABASE_SCHEMA,
  ENV_DATABASE_URL, ENV_DOCS, ENV_HOST, ENV_PORT, ENV_PUBLIC_URL, ENV_ROOT_EMAIL, ENV_SERVICE_KEY,
  ENV_SHUTDOWN_GRACE_SECONDS, ENV_SMTP_FROM_EMAIL, ENV_SMTP_FROM_NAME, ENV_SMTP_HOST,
  ENV_SMTP_PASSWORD, ENV_SMTP_PORT, ENV_SMTP_SECURITY, ENV_SMTP_USERNAME, ENV_TRUSTED_PROXIES,
  ENV_WEB_UI, SERVER_HOST_PLACEHOLDER, SERVICE_KEY_MIN_LENGTH,
};
pub use crate::constants::config::{DEFAULT_BIND_ADDRESS, DEFAULT_PUBLIC_URL};
use crate::services::mailer::{self, SmtpSecurity};

pub fn validate_endpoint_transport(url: &Url) -> Result<()> {
  if !matches!(url.scheme(), "http" | "https") {
    bail!("URL must use HTTP or HTTPS");
  }
  Ok(())
}

#[derive(Clone, Serialize)]
pub struct ServerConfig {
  /// The configuration file that was read, if any.
  #[serde(skip)]
  pub config_path: Option<PathBuf>,
  pub version: u32,
  pub bind_address: String,
  pub public_url: String,
  /// PostgreSQL connection URL. Required.
  #[serde(skip)]
  pub database_url: String,
  /// The schema every Dopgate table lives in.
  pub database_schema: String,
  /// Most connections the pool opens.
  #[serde(skip)]
  pub database_max_connections: u32,
  pub shutdown_grace_seconds: u64,
  /// Days audit records are kept before they are deleted. Unset keeps them
  /// forever.
  #[serde(skip)]
  pub audit_retention_days: Option<u64>,
  /// Reverse proxies allowed to report the client address through
  /// `X-Forwarded-For`. Empty trusts no one, so rate limits and audit
  /// records use the connection's peer address.
  #[serde(skip)]
  pub trusted_proxies: Vec<crate::services::client_ip::ProxyNetwork>,
  /// Browser origins allowed to call the API across origins (CORS).
  #[serde(skip)]
  pub allowed_origins: Vec<String>,
  /// The main app's backend sends this as a bearer token to use the admin
  /// API. Unset disables service access.
  #[serde(skip)]
  pub service_key: Option<zeroize::Zeroizing<String>>,
  /// On a database without a root account, startup creates root with this
  /// email and prints a generated password once.
  #[serde(skip)]
  pub root_email: Option<String>,
  #[serde(skip)]
  pub docs_enabled: bool,
  #[serde(skip)]
  pub web_ui_enabled: bool,
  /// SMTP from the config file or `DOPGATE_SMTP_*`. Without a host, mail is
  /// written to the server log.
  #[serde(skip)]
  pub smtp: SmtpServerConfig,
  /// Records whether the public URL was configured or derived at startup.
  #[serde(skip)]
  pub public_url_source: PublicUrlSource,
}

impl std::fmt::Debug for ServerConfig {
  fn fmt(
    &self,
    formatter: &mut std::fmt::Formatter<'_>,
  ) -> std::fmt::Result {
    formatter
      .debug_struct("ServerConfig")
      .field("config_path", &self.config_path)
      .field("bind_address", &self.bind_address)
      .field("public_url", &self.public_url)
      .field("database_url", &redact_database_url(&self.database_url))
      .field("database_schema", &self.database_schema)
      .field("allowed_origins", &self.allowed_origins)
      .field(
        "service_key",
        &self.service_key.as_ref().map(|_| "<redacted>"),
      )
      .field("root_email", &self.root_email)
      .field("docs_enabled", &self.docs_enabled)
      .field("web_ui_enabled", &self.web_ui_enabled)
      .field("smtp", &self.smtp)
      .finish_non_exhaustive()
  }
}

/// The database URL without its password, for logs and errors.
pub fn redact_database_url(url: &str) -> String {
  match Url::parse(url) {
    Ok(mut parsed) if parsed.password().is_some() => {
      let _ = parsed.set_password(Some("***"));
      parsed.to_string()
    }
    Ok(parsed) => parsed.to_string(),
    Err(_) => "<invalid URL>".into(),
  }
}

/// The SMTP settings. No host means no SMTP server: mail goes to the log.
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

/// Values from the command line. They win over everything else.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct ServerOverrides {
  pub config_path: Option<PathBuf>,
  pub database_url: Option<String>,
  pub public_url: Option<String>,
  pub port: Option<u16>,
  pub host: Option<String>,
  pub shutdown_grace_seconds: Option<u64>,
  pub docs: Option<bool>,
  pub web_ui: Option<bool>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
struct ServerConfigFile {
  version: Option<u32>,
  database_url: Option<String>,
  database_schema: Option<String>,
  public_url: Option<String>,
  port: Option<u16>,
  host: Option<String>,
  shutdown_grace_seconds: Option<u64>,
  audit_retention_days: Option<u64>,
  trusted_proxies: Option<Vec<String>>,
  allowed_origins: Option<Vec<String>>,
  service_key: Option<String>,
  root_email: Option<String>,
  docs: Option<bool>,
  web_ui: Option<bool>,
  smtp: Option<SmtpConfigFile>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
struct SmtpConfigFile {
  host: Option<String>,
  port: Option<u16>,
  security: Option<SmtpSecurity>,
  username: Option<String>,
  password: Option<String>,
  from_email: Option<String>,
  from_name: Option<String>,
}

/// `DOPGATE_*` environment overrides, structured so tests (and any embedder)
/// can resolve configuration from injected values instead of process state.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct EnvironmentOverrides {
  pub config_path: Option<PathBuf>,
  pub database_url: Option<String>,
  pub database_schema: Option<String>,
  pub database_max_connections: Option<String>,
  pub public_url: Option<String>,
  pub port: Option<String>,
  pub host: Option<String>,
  pub shutdown_grace_seconds: Option<String>,
  pub audit_retention_days: Option<String>,
  pub trusted_proxies: Option<String>,
  pub allowed_origins: Option<String>,
  pub service_key: Option<String>,
  pub root_email: Option<String>,
  pub docs: Option<String>,
  pub web_ui: Option<String>,
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
      config_path: env::var_os(ENV_CONFIG).map(PathBuf::from),
      database_url: env::var(ENV_DATABASE_URL).ok(),
      database_schema: env::var(ENV_DATABASE_SCHEMA).ok(),
      database_max_connections: env::var(ENV_DATABASE_MAX_CONNECTIONS).ok(),
      public_url: env::var(ENV_PUBLIC_URL).ok(),
      port: env::var(ENV_PORT).ok(),
      host: env::var(ENV_HOST).ok(),
      shutdown_grace_seconds: env::var(ENV_SHUTDOWN_GRACE_SECONDS).ok(),
      audit_retention_days: env::var(ENV_AUDIT_RETENTION_DAYS).ok(),
      trusted_proxies: env::var(ENV_TRUSTED_PROXIES).ok(),
      allowed_origins: env::var(ENV_ALLOWED_ORIGINS).ok(),
      service_key: env::var(ENV_SERVICE_KEY).ok(),
      root_email: env::var(ENV_ROOT_EMAIL).ok(),
      docs: env::var(ENV_DOCS).ok(),
      web_ui: env::var(ENV_WEB_UI).ok(),
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

impl Default for ServerConfig {
  fn default() -> Self {
    Self {
      config_path: None,
      version: 1,
      bind_address: DEFAULT_BIND_ADDRESS.into(),
      public_url: DEFAULT_PUBLIC_URL.into(),
      database_url: String::new(),
      database_schema: DEFAULT_DATABASE_SCHEMA.into(),
      database_max_connections: 10,
      shutdown_grace_seconds: 10,
      audit_retention_days: Some(DEFAULT_AUDIT_RETENTION_DAYS),
      trusted_proxies: Vec::new(),
      allowed_origins: Vec::new(),
      service_key: None,
      root_email: None,
      docs_enabled: true,
      web_ui_enabled: true,
      public_url_source: PublicUrlSource::LoopbackDefault,
      smtp: SmtpServerConfig::default(),
    }
  }
}

impl ServerConfig {
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
    let config_path = overrides
      .config_path
      .as_deref()
      .or(environment.config_path.as_deref())
      .map(|path| resolve_path_from(path, working_directory))
      .transpose()?;
    let mut config = Self {
      config_path: config_path.clone(),
      ..Self::default()
    };

    let file_port;
    let file_host;
    if let Some(path) = &config_path {
      let contents =
        fs::read_to_string(path).with_context(|| format!("failed to read {}", path.display()))?;
      let file: ServerConfigFile =
        toml::from_str(&contents).with_context(|| format!("failed to parse {}", path.display()))?;
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
    config.clean_root_email()?;
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
    if let Some(value) = file.database_url {
      self.database_url = value;
    }
    if let Some(value) = file.database_schema {
      self.database_schema = value;
    }
    if let Some(value) = file.public_url {
      self.public_url = value;
      self.public_url_source = PublicUrlSource::Explicit;
    }
    if let Some(value) = file.shutdown_grace_seconds {
      self.shutdown_grace_seconds = value;
    }
    if let Some(value) = file.audit_retention_days {
      self.audit_retention_days = (value > 0).then_some(value);
    }
    if let Some(values) = file.trusted_proxies {
      self.trusted_proxies = values
        .iter()
        .map(|value| value.parse())
        .collect::<Result<_>>()
        .context("invalid trusted_proxies")?;
    }
    if let Some(values) = file.allowed_origins {
      self.allowed_origins = parse_origins(values.iter().map(String::as_str))?;
    }
    if let Some(value) = file.service_key {
      self.service_key = Some(zeroize::Zeroizing::new(value));
    }
    if let Some(value) = file.root_email {
      self.root_email = Some(value);
    }
    if let Some(value) = file.web_ui {
      self.web_ui_enabled = value;
    }
    if let Some(value) = file.docs {
      self.docs_enabled = value;
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
    if let Some(value) = environment.database_url {
      self.database_url = value;
    }
    if let Some(value) = environment.database_schema {
      self.database_schema = value;
    }
    if let Some(value) = environment.database_max_connections {
      self.database_max_connections = value
        .parse()
        .context("invalid DOPGATE_DATABASE_MAX_CONNECTIONS")?;
    }
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
      let days: u64 = value
        .parse()
        .context("invalid DOPGATE_AUDIT_RETENTION_DAYS")?;
      // 0 keeps records forever.
      self.audit_retention_days = (days > 0).then_some(days);
    }
    if let Some(value) = environment.trusted_proxies {
      self.trusted_proxies = crate::services::client_ip::parse_list(&value)
        .context("invalid DOPGATE_TRUSTED_PROXIES")?;
    }
    if let Some(value) = environment.allowed_origins {
      self.allowed_origins =
        parse_origins(value.split(',')).context("invalid DOPGATE_ALLOWED_ORIGINS")?;
    }
    if let Some(value) = environment.service_key {
      self.service_key = (!value.trim().is_empty()).then(|| zeroize::Zeroizing::new(value));
    }
    if let Some(value) = environment.root_email {
      self.root_email = Some(value);
    }
    if let Some(value) = environment.web_ui {
      self.web_ui_enabled = value.parse().context("invalid DOPGATE_WEB_UI")?;
    }
    if let Some(value) = environment.docs {
      self.docs_enabled = value.parse().context("invalid DOPGATE_DOCS")?;
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
    if let Some(value) = &overrides.database_url {
      self.database_url.clone_from(value);
    }
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
  }

  fn clean_root_email(&mut self) -> Result<()> {
    let Some(value) = self.root_email.take() else {
      return Ok(());
    };
    if value.trim().is_empty() {
      return Ok(());
    }
    self.root_email = Some(
      crate::utils::email::normalize(&value)
        .with_context(|| format!("DOPGATE_ROOT_EMAIL \"{value}\" is not a valid email address"))?,
    );
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
        "Replace SERVER_HOST with this server's public address.\n\
         Set DOPGATE_PUBLIC_URL (or --public-url) to the URL your app and users reach dopgate on.\n\
         It is also the issuer of every access token."
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

  /// The issuer every access token carries: the public URL without a
  /// trailing slash.
  pub fn issuer(&self) -> &str {
    self.public_url.trim_end_matches('/')
  }

  /// Whether the public URL is HTTPS, so cookies can be marked Secure.
  pub fn public_url_is_https(&self) -> bool {
    self.public_url.starts_with("https://")
  }

  /// The audit retention policy, or `None` when records are kept forever.
  pub fn audit_retention(&self) -> Option<crate::services::audit_chain::Retention> {
    self
      .audit_retention_days
      .map(crate::services::audit_chain::Retention::new)
  }

  pub fn validate(&self) -> Result<()> {
    if self.version != 1 {
      bail!("unsupported server configuration version {}", self.version);
    }
    if self.database_url.trim().is_empty() {
      bail!(
        "set DOPGATE_DATABASE_URL to a PostgreSQL URL, such as postgres://dopgate:secret@localhost:5432/app"
      );
    }
    let database = Url::parse(&self.database_url).context("invalid DOPGATE_DATABASE_URL")?;
    if !matches!(database.scheme(), "postgres" | "postgresql") {
      bail!("DOPGATE_DATABASE_URL must start with postgres:// or postgresql://");
    }
    crate::services::db::validate_schema(&self.database_schema)?;
    if !(1..=1000).contains(&self.database_max_connections) {
      bail!("DOPGATE_DATABASE_MAX_CONNECTIONS must be between 1 and 1000");
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
    if !(1..=300).contains(&self.shutdown_grace_seconds) {
      bail!("shutdown_grace_seconds must be between 1 and 300");
    }
    if let Some(key) = &self.service_key
      && key.chars().count() < SERVICE_KEY_MIN_LENGTH
    {
      bail!(
        "DOPGATE_SERVICE_KEY must be at least {SERVICE_KEY_MIN_LENGTH} characters. Generate one with `openssl rand -base64 32`."
      );
    }
    Ok(())
  }
}

/// Browser origins such as `https://app.example.com`: a scheme, a host, an
/// optional port, nothing else. Empty entries are skipped.
fn parse_origins<'a>(values: impl Iterator<Item = &'a str>) -> Result<Vec<String>> {
  let mut origins = Vec::new();
  for value in values.map(str::trim).filter(|value| !value.is_empty()) {
    let url = Url::parse(value).with_context(|| format!("\"{value}\" is not an origin"))?;
    if !matches!(url.scheme(), "http" | "https")
      || url.host_str().is_none()
      || !matches!(url.path(), "" | "/")
      || url.query().is_some()
    {
      bail!("\"{value}\" must be an origin like https://app.example.com");
    }
    origins.push(url.origin().ascii_serialization());
  }
  Ok(origins)
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
