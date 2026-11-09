use std::fs;

use app::config::{EnvironmentOverrides, PublicUrlSource, ServerConfig, ServerOverrides};
use tempfile::TempDir;

const URL: &str = "postgres://dopgate:secret@localhost:5432/app";

fn overrides() -> ServerOverrides {
  ServerOverrides {
    database_url: Some(URL.into()),
    ..Default::default()
  }
}

fn load(environment: EnvironmentOverrides) -> anyhow::Result<ServerConfig> {
  ServerConfig::load_with_environment(&overrides(), environment)
}

#[test]
fn defaults_listen_locally_on_8850_with_the_console_on() {
  let config = load(EnvironmentOverrides::default()).unwrap();
  assert_eq!(config.bind_address, "127.0.0.1:8850");
  assert_eq!(config.public_url, "http://localhost:8850");
  assert_eq!(config.public_url_source, PublicUrlSource::LoopbackDefault);
  assert_eq!(config.database_schema, "dopgate");
  assert_eq!(config.audit_retention_days, Some(365));
  assert!(config.docs_enabled);
  assert!(config.web_ui_enabled);
  assert!(config.service_key.is_none());
  assert!(config.allowed_origins.is_empty());
  assert!(config.public_url_warning().is_none());
}

#[test]
fn a_database_url_is_required() {
  let error = ServerConfig::load_with_environment(
    &ServerOverrides::default(),
    EnvironmentOverrides::default(),
  )
  .unwrap_err();
  assert!(error.to_string().contains("DOPGATE_DATABASE_URL"));
  let error = load(EnvironmentOverrides {
    database_url: Some("sqlite://dopgate.db".into()),
    ..Default::default()
  });
  // The flag wins over the environment, so this still loads.
  assert!(error.is_ok());
  let error = ServerConfig::load_with_environment(
    &ServerOverrides {
      database_url: Some("mysql://localhost/app".into()),
      ..Default::default()
    },
    EnvironmentOverrides::default(),
  )
  .unwrap_err();
  assert!(error.to_string().contains("postgres://"));
}

/// The database password never shows up in debug output.
#[test]
fn secrets_stay_out_of_debug_output() {
  let config = load(EnvironmentOverrides {
    service_key: Some("s".repeat(40)),
    smtp_host: Some("smtp.example.com".into()),
    smtp_from_email: Some("no-reply@example.com".into()),
    smtp_password: Some("smtp-secret".into()),
    ..Default::default()
  })
  .unwrap();
  let debug = format!("{config:?}");
  assert!(!debug.contains("secret@"), "{debug}");
  assert!(!debug.contains("smtp-secret"));
  assert!(!debug.contains(&"s".repeat(40)));
}

/// Flags beat environment variables, which beat the config file.
#[test]
fn flags_beat_environment_beat_file() {
  let directory = TempDir::new().unwrap();
  let file = directory.path().join("dopgate.toml");
  fs::write(
    &file,
    "port = 9001\ndocs = false\naudit_retention_days = 30\n",
  )
  .unwrap();
  let with_file = |environment: EnvironmentOverrides, flags: ServerOverrides| {
    let flags = ServerOverrides {
      config_path: Some(file.clone()),
      database_url: Some(URL.into()),
      ..flags
    };
    ServerConfig::load_with_environment(&flags, environment).unwrap()
  };
  let config = with_file(EnvironmentOverrides::default(), ServerOverrides::default());
  assert_eq!(config.bind_address, "127.0.0.1:9001");
  assert!(!config.docs_enabled);
  assert_eq!(config.audit_retention_days, Some(30));

  let environment = EnvironmentOverrides {
    port: Some("9002".into()),
    docs: Some("true".into()),
    ..Default::default()
  };
  let config = with_file(environment.clone(), ServerOverrides::default());
  assert_eq!(config.bind_address, "127.0.0.1:9002");
  assert!(config.docs_enabled);

  let config = with_file(
    environment,
    ServerOverrides {
      port: Some(9003),
      docs: Some(false),
      ..Default::default()
    },
  );
  assert_eq!(config.bind_address, "127.0.0.1:9003");
  assert!(!config.docs_enabled);
}

#[test]
fn the_config_file_rejects_unknown_settings() {
  let directory = TempDir::new().unwrap();
  let file = directory.path().join("dopgate.toml");
  fs::write(&file, "master_key = \"x\"\n").unwrap();
  let flags = ServerOverrides {
    config_path: Some(file),
    database_url: Some(URL.into()),
    ..Default::default()
  };
  assert!(ServerConfig::load_with_environment(&flags, EnvironmentOverrides::default()).is_err());
}

#[test]
fn a_network_bind_without_a_public_url_gets_a_placeholder_and_a_warning() {
  let mut flags = overrides();
  flags.host = Some("0.0.0.0".into());
  let config =
    ServerConfig::load_with_environment(&flags, EnvironmentOverrides::default()).unwrap();
  assert_eq!(config.public_url, "http://SERVER_HOST:8850");
  assert!(config.public_url_warning().unwrap().contains("SERVER_HOST"));
}

#[test]
fn plain_http_on_a_public_address_warns() {
  let mut flags = overrides();
  flags.public_url = Some("http://auth.example.com".into());
  let config =
    ServerConfig::load_with_environment(&flags, EnvironmentOverrides::default()).unwrap();
  assert!(config.public_url_warning().unwrap().contains("HTTP"));
  assert!(!config.public_url_is_https());

  flags.public_url = Some("https://auth.example.com/".into());
  let config =
    ServerConfig::load_with_environment(&flags, EnvironmentOverrides::default()).unwrap();
  assert!(config.public_url_warning().is_none());
  assert!(config.public_url_is_https());
  assert_eq!(config.issuer(), "https://auth.example.com");
}

#[test]
fn service_key_origins_schema_and_root_email_are_read_and_checked() {
  let config = load(EnvironmentOverrides {
    service_key: Some("k".repeat(32)),
    allowed_origins: Some(" https://app.example.com , http://localhost:5173/ ".into()),
    database_schema: Some("auth".into()),
    root_email: Some(" Admin@Example.com ".into()),
    ..Default::default()
  })
  .unwrap();
  assert_eq!(
    config.service_key.as_deref().map(String::as_str),
    Some("k".repeat(32).as_str())
  );
  assert_eq!(
    config.allowed_origins,
    vec!["https://app.example.com", "http://localhost:5173"]
  );
  assert_eq!(config.database_schema, "auth");
  assert_eq!(config.root_email.as_deref(), Some("admin@example.com"));

  // 0 keeps audit records forever.
  let config = load(EnvironmentOverrides {
    audit_retention_days: Some("0".into()),
    ..Default::default()
  })
  .unwrap();
  assert_eq!(config.audit_retention_days, None);
}

#[test]
fn invalid_values_are_refused() {
  let refused = |environment: EnvironmentOverrides| assert!(load(environment).is_err());
  refused(EnvironmentOverrides {
    port: Some("not-a-port".into()),
    ..Default::default()
  });
  refused(EnvironmentOverrides {
    public_url: Some("ftp://auth.example.com".into()),
    ..Default::default()
  });
  refused(EnvironmentOverrides {
    host: Some("example.com".into()),
    ..Default::default()
  });
  refused(EnvironmentOverrides {
    trusted_proxies: Some("10.0.0.0/99".into()),
    ..Default::default()
  });
  refused(EnvironmentOverrides {
    service_key: Some("too-short".into()),
    ..Default::default()
  });
  refused(EnvironmentOverrides {
    allowed_origins: Some("https://app.example.com/path".into()),
    ..Default::default()
  });
  refused(EnvironmentOverrides {
    database_schema: Some("Bad-Schema".into()),
    ..Default::default()
  });
  refused(EnvironmentOverrides {
    root_email: Some("not-an-email".into()),
    ..Default::default()
  });
  refused(EnvironmentOverrides {
    database_max_connections: Some("0".into()),
    ..Default::default()
  });
  let smtp = |host: &str, from_email: Option<&str>| EnvironmentOverrides {
    smtp_host: Some(host.into()),
    smtp_from_email: from_email.map(Into::into),
    ..Default::default()
  };
  refused(smtp("smtp.example.com:587", Some("no-reply@example.com")));
  refused(smtp("smtp.example.com", None));
  refused(smtp("smtp.example.com", Some("not-an-address")));
  for (port, security) in [(Some("0"), None), (Some("x"), None), (None, Some("ssl"))] {
    let mut environment = smtp("smtp.example.com", Some("no-reply@example.com"));
    environment.smtp_port = port.map(Into::into);
    environment.smtp_security = security.map(Into::into);
    refused(environment);
  }
}

/// The environment replaces single `[smtp]` fields and leaves the rest.
#[test]
fn smtp_comes_from_the_file_with_environment_overrides() {
  let directory = TempDir::new().unwrap();
  let file = directory.path().join("dopgate.toml");
  fs::write(
    &file,
    "[smtp]\nhost = \" smtp.example.com \"\nsecurity = \"tls\"\nusername = \"dopgate\"\npassword = \"from-file\"\nfrom_email = \"No-Reply@Example.com\"\n",
  )
  .unwrap();
  let flags = ServerOverrides {
    config_path: Some(file),
    database_url: Some(URL.into()),
    ..Default::default()
  };
  let environment = EnvironmentOverrides {
    smtp_password: Some("from-env".into()),
    smtp_from_name: Some("Example".into()),
    ..Default::default()
  };
  let config = ServerConfig::load_with_environment(&flags, environment).unwrap();
  let smtp = config.smtp.mailer_config().unwrap();
  assert_eq!(smtp.host, "smtp.example.com");
  assert_eq!(smtp.port, 465);
  assert_eq!(smtp.username.as_deref(), Some("dopgate"));
  assert_eq!(smtp.password.as_deref().unwrap().as_str(), "from-env");
  assert_eq!(smtp.from_email, "no-reply@example.com");
  assert_eq!(smtp.from_name.as_deref(), Some("Example"));

  // An empty variable clears the file's value.
  let environment = EnvironmentOverrides {
    smtp_host: Some(String::new()),
    ..Default::default()
  };
  let config = ServerConfig::load_with_environment(&flags, environment).unwrap();
  assert!(config.smtp.mailer_config().is_none());
}
