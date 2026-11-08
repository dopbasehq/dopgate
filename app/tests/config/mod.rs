use std::fs;

use app::config::{EnvironmentOverrides, PublicUrlSource, ServerConfig, ServerOverrides};
use tempfile::TempDir;

fn overrides(directory: &TempDir) -> ServerOverrides {
  ServerOverrides {
    data_dir: Some(directory.path().to_path_buf()),
    ..Default::default()
  }
}

#[test]
fn defaults_listen_locally_on_8850() {
  let directory = TempDir::new().unwrap();
  let config =
    ServerConfig::load_with_environment(&overrides(&directory), EnvironmentOverrides::default())
      .unwrap();
  assert_eq!(config.bind_address, "127.0.0.1:8850");
  assert_eq!(config.public_url, "http://localhost:8850");
  assert_eq!(config.public_url_source, PublicUrlSource::LoopbackDefault);
  assert!(config.docs_enabled);
  assert!(!config.web_ui_enabled);
  assert!(config.database_url.ends_with("dopgate.db"));
  assert_eq!(config.master_key.path, directory.path().join("master.key"));
  assert!(config.public_url_warning().is_none());
}

/// Flags beat environment variables, which beat server.toml.
#[test]
fn flags_beat_environment_beat_file() {
  let directory = TempDir::new().unwrap();
  fs::write(
    directory.path().join("server.toml"),
    "port = 9001\ndocs = false\naudit_retention_days = 30\n",
  )
  .unwrap();
  let environment = EnvironmentOverrides {
    port: Some("9002".into()),
    docs: Some("true".into()),
    ..Default::default()
  };

  let config =
    ServerConfig::load_with_environment(&overrides(&directory), EnvironmentOverrides::default())
      .unwrap();
  assert_eq!(config.bind_address, "127.0.0.1:9001");
  assert!(!config.docs_enabled);
  assert_eq!(config.audit_retention_days, Some(30));

  let config =
    ServerConfig::load_with_environment(&overrides(&directory), environment.clone()).unwrap();
  assert_eq!(config.bind_address, "127.0.0.1:9002");
  assert!(config.docs_enabled);

  let mut flags = overrides(&directory);
  flags.port = Some(9003);
  flags.docs = Some(false);
  let config = ServerConfig::load_with_environment(&flags, environment).unwrap();
  assert_eq!(config.bind_address, "127.0.0.1:9003");
  assert!(!config.docs_enabled);
}

#[test]
fn a_network_bind_without_a_public_url_gets_a_placeholder_and_a_warning() {
  let directory = TempDir::new().unwrap();
  let mut flags = overrides(&directory);
  flags.host = Some("0.0.0.0".into());
  let config =
    ServerConfig::load_with_environment(&flags, EnvironmentOverrides::default()).unwrap();
  assert_eq!(config.public_url, "http://SERVER_HOST:8850");
  assert!(config.public_url_warning().unwrap().contains("SERVER_HOST"));
}

#[test]
fn plain_http_on_a_public_address_warns() {
  let directory = TempDir::new().unwrap();
  let mut flags = overrides(&directory);
  flags.public_url = Some("http://auth.example.com".into());
  let config =
    ServerConfig::load_with_environment(&flags, EnvironmentOverrides::default()).unwrap();
  assert!(config.public_url_warning().unwrap().contains("HTTP"));

  flags.public_url = Some("https://auth.example.com".into());
  let config =
    ServerConfig::load_with_environment(&flags, EnvironmentOverrides::default()).unwrap();
  assert!(config.public_url_warning().is_none());
}

#[test]
fn invalid_values_are_refused() {
  let directory = TempDir::new().unwrap();
  let load = |environment: EnvironmentOverrides| {
    ServerConfig::load_with_environment(&overrides(&directory), environment)
  };
  assert!(
    load(EnvironmentOverrides {
      port: Some("not-a-port".into()),
      ..Default::default()
    })
    .is_err()
  );
  assert!(
    load(EnvironmentOverrides {
      public_url: Some("ftp://auth.example.com".into()),
      ..Default::default()
    })
    .is_err()
  );
  assert!(
    load(EnvironmentOverrides {
      audit_retention_days: Some("0".into()),
      ..Default::default()
    })
    .is_err()
  );
  assert!(
    load(EnvironmentOverrides {
      host: Some("example.com".into()),
      ..Default::default()
    })
    .is_err()
  );
  assert!(
    load(EnvironmentOverrides {
      trusted_proxies: Some("10.0.0.0/99".into()),
      ..Default::default()
    })
    .is_err()
  );
  let smtp = |host: &str, from_email: Option<&str>| EnvironmentOverrides {
    smtp_host: Some(host.into()),
    smtp_from_email: from_email.map(Into::into),
    ..Default::default()
  };
  assert!(load(smtp("smtp.example.com:587", Some("no-reply@example.com"))).is_err());
  assert!(load(smtp("smtp.example.com", None)).is_err());
  assert!(load(smtp("smtp.example.com", Some("not-an-address"))).is_err());
  for (port, security) in [(Some("0"), None), (Some("x"), None), (None, Some("ssl"))] {
    let mut environment = smtp("smtp.example.com", Some("no-reply@example.com"));
    environment.smtp_port = port.map(Into::into);
    environment.smtp_security = security.map(Into::into);
    assert!(load(environment).is_err(), "{port:?} {security:?}");
  }
}

/// The environment replaces single `[smtp]` fields and leaves the rest.
#[test]
fn smtp_comes_from_the_file_with_environment_overrides() {
  let directory = TempDir::new().unwrap();
  fs::write(
    directory.path().join("server.toml"),
    "[smtp]\nhost = \" smtp.example.com \"\nsecurity = \"tls\"\nusername = \"dopgate\"\npassword = \"from-file\"\nfrom_email = \"No-Reply@Example.com\"\n",
  )
  .unwrap();
  let environment = EnvironmentOverrides {
    smtp_password: Some("from-env".into()),
    smtp_from_name: Some("Example".into()),
    ..Default::default()
  };
  let config = ServerConfig::load_with_environment(&overrides(&directory), environment).unwrap();
  let smtp = config.smtp.mailer_config().unwrap();
  assert_eq!(smtp.host, "smtp.example.com");
  assert_eq!(smtp.port, 465);
  assert_eq!(smtp.username.as_deref(), Some("dopgate"));
  assert_eq!(smtp.password.as_deref().unwrap().as_str(), "from-env");
  assert_eq!(smtp.from_email, "no-reply@example.com");
  assert_eq!(smtp.from_name.as_deref(), Some("Example"));
  assert!(!format!("{config:?}").contains("from-env"));

  // An empty variable clears the file's value.
  let environment = EnvironmentOverrides {
    smtp_host: Some(String::new()),
    ..Default::default()
  };
  let config = ServerConfig::load_with_environment(&overrides(&directory), environment).unwrap();
  assert!(config.smtp.mailer_config().is_none());
}

/// Uncommenting the `[smtp]` example in the generated file gives a working
/// configuration.
#[test]
fn the_reference_smtp_example_loads_once_uncommented() {
  let directory = TempDir::new().unwrap();
  let config =
    ServerConfig::load_with_environment(&overrides(&directory), EnvironmentOverrides::default())
      .unwrap();
  config.ensure_reference_files().unwrap();
  let path = directory.path().join("server.toml");
  let written = fs::read_to_string(&path).unwrap();
  let (before, rest) = written.split_once("# [smtp]\n").unwrap();
  let (example, after) = rest.split_once("# Master encryption key").unwrap();
  let example: String = example
    .lines()
    .map(|line| match line.strip_prefix("# ") {
      Some(setting) if setting.contains(" = ") => format!("{setting}\n"),
      _ => format!("{line}\n"),
    })
    .collect();
  fs::write(
    &path,
    format!("{before}[smtp]\n{example}# Master encryption key{after}"),
  )
  .unwrap();
  let config =
    ServerConfig::load_with_environment(&overrides(&directory), EnvironmentOverrides::default())
      .unwrap();
  let smtp = config.smtp.mailer_config().unwrap();
  assert_eq!(smtp.host, "smtp.example.com");
  assert_eq!(smtp.port, 587);
  assert_eq!(smtp.from_email, "no-reply@example.com");
}

#[test]
fn the_reference_file_is_written_once_and_never_overwritten() {
  let directory = TempDir::new().unwrap();
  let config =
    ServerConfig::load_with_environment(&overrides(&directory), EnvironmentOverrides::default())
      .unwrap();
  config.ensure_reference_files().unwrap();
  let written = fs::read_to_string(directory.path().join("server.toml")).unwrap();
  assert!(written.contains("DOPGATE_PORT"));
  assert!(!written.to_lowercase().contains("dopbase"));
  // The template parses as the configuration it documents.
  ServerConfig::load_with_environment(&overrides(&directory), EnvironmentOverrides::default())
    .unwrap();

  fs::write(directory.path().join("server.toml"), "port = 9100\n").unwrap();
  config.ensure_reference_files().unwrap();
  assert_eq!(
    fs::read_to_string(directory.path().join("server.toml")).unwrap(),
    "port = 9100\n"
  );
}
