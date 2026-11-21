use std::fs;

use app::{
  config::{EnvironmentOverrides, PublicUrlSource, ServerConfig, ServerOverrides},
  services::mailer::SmtpSecurity,
};
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
fn defaults_listen_locally_on_8850_with_the_console_on_and_the_docs_off() {
  let config = load(EnvironmentOverrides::default()).unwrap();
  assert_eq!(config.bind_address, "127.0.0.1:8850");
  assert_eq!(config.public_url, "http://localhost:8850");
  assert_eq!(config.public_url_source, PublicUrlSource::LoopbackDefault);
  assert_eq!(config.database_schema, "dopgate");
  assert_eq!(config.audit_retention_days, Some(365));
  assert!(!config.docs_enabled);
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
    smtp_url: Some("smtp://dopgate:smtp-secret@smtp.example.com".into()),
    smtp_from_email: Some("no-reply@example.com".into()),
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
    "port = 9001\ndocs = true\naudit_retention_days = 30\n",
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
  assert!(config.docs_enabled);
  assert_eq!(config.audit_retention_days, Some(30));

  let environment = EnvironmentOverrides {
    port: Some("9002".into()),
    docs: Some("false".into()),
    ..Default::default()
  };
  let config = with_file(environment.clone(), ServerOverrides::default());
  assert_eq!(config.bind_address, "127.0.0.1:9002");
  assert!(!config.docs_enabled);

  let config = with_file(
    environment,
    ServerOverrides {
      port: Some(9003),
      docs: Some(true),
      ..Default::default()
    },
  );
  assert_eq!(config.bind_address, "127.0.0.1:9003");
  assert!(config.docs_enabled);
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

/// The leaked password list is Pwned Passwords unless the environment
/// names a mirror. An empty value changes nothing.
#[test]
fn the_leaked_password_list_can_be_a_mirror() {
  let default = load(EnvironmentOverrides::default()).unwrap();
  assert_eq!(
    default.leaked_passwords_url.as_deref(),
    Some("https://api.pwnedpasswords.com")
  );
  let mirror = load(EnvironmentOverrides {
    leaked_passwords_url: Some(" http://10.0.0.5:8080 ".into()),
    ..Default::default()
  })
  .unwrap();
  assert_eq!(
    mirror.leaked_passwords_url.as_deref(),
    Some("http://10.0.0.5:8080")
  );
  let empty = load(EnvironmentOverrides {
    leaked_passwords_url: Some(String::new()),
    ..Default::default()
  })
  .unwrap();
  assert_eq!(empty.leaked_passwords_url, default.leaked_passwords_url);
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
    leaked_passwords_url: Some("ftp://mirror.example.com".into()),
    ..Default::default()
  });
  refused(EnvironmentOverrides {
    leaked_passwords_url: Some("not a url".into()),
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
  refused(EnvironmentOverrides {
    smtp_url: Some("smtp://smtp.example.com".into()),
    smtp_from_email: Some("not-an-address".into()),
    ..Default::default()
  });
  for url in [
    // No scheme, or the wrong one.
    "smtp.example.com:587",
    "http://smtp.example.com",
    // No host.
    "smtp://",
    "smtp://:587",
    "smtp://smtp.example.com:0",
    "smtp://smtp.example.com:x",
    "smtp://smtp.example.com/inbox",
    "smtp://smtp.example.com#inbox",
    // The one option is security=none, and only without TLS.
    "smtp://smtp.example.com?security=ssl",
    "smtps://smtp.example.com?security=none",
    // A slash in the password has to be written %2F.
    "smtp://dopgate:pa/ss@smtp.example.com",
  ] {
    let error = load(smtp_url(url)).expect_err(url);
    assert!(format!("{error:#}").contains("DOPGATE_SMTP_URL"), "{url}");
  }
  // A line break in the username would end up in a mail header.
  refused(smtp_url("smtp://dopgate%0Aname@smtp.example.com"));
  // The URL can hold the password, so the error never repeats it.
  let error = load(smtp_url("smtp://dopgate:hunter2@smtp.example.com/inbox")).unwrap_err();
  assert!(!format!("{error:#}").contains("hunter2"));
}

fn smtp_url(url: &str) -> EnvironmentOverrides {
  EnvironmentOverrides {
    smtp_url: Some(url.into()),
    ..Default::default()
  }
}

/// The scheme picks the security mode and its usual port. The username and
/// password are percent-decoded. Without a sender address, mail comes from
/// the built-in default.
#[test]
fn an_smtp_url_names_the_server_its_security_and_the_sign_in() {
  let server = |url: &str| {
    let smtp = load(smtp_url(url)).unwrap().smtp.mailer_config().unwrap();
    assert_eq!(smtp.from_email, "no-reply@dopgate.com");
    (
      smtp.host,
      smtp.port,
      smtp.security,
      smtp.username,
      smtp.password.map(|password| password.to_string()),
    )
  };
  let host = || "smtp.example.com".to_owned();
  assert_eq!(
    server("smtp://smtp.example.com"),
    (host(), 587, SmtpSecurity::Starttls, None, None)
  );
  assert_eq!(
    server("smtps://dopgate:secret@smtp.example.com/"),
    (
      host(),
      465,
      SmtpSecurity::Tls,
      Some("dopgate".into()),
      Some("secret".into())
    )
  );
  assert_eq!(
    server("smtp://smtp.example.com?security=none"),
    (host(), 25, SmtpSecurity::None, None, None)
  );
  assert_eq!(
    server("smtp://127.0.0.1:1025?security=none"),
    ("127.0.0.1".into(), 1025, SmtpSecurity::None, None, None)
  );
  assert_eq!(
    server("smtp://[::1]:2525"),
    ("::1".into(), 2525, SmtpSecurity::Starttls, None, None)
  );
  assert_eq!(
    server(" smtp://user%40example.com:p%40ss%3Aw%2Ford%20100%25@smtp.example.com:2525 "),
    (
      host(),
      2525,
      SmtpSecurity::Starttls,
      Some("user@example.com".into()),
      Some("p@ss:w/ord 100%".into())
    )
  );
}

/// The environment replaces the file's URL whole, and the sender address
/// and name one by one.
#[test]
fn smtp_comes_from_the_file_with_environment_overrides() {
  let directory = TempDir::new().unwrap();
  let file = directory.path().join("dopgate.toml");
  fs::write(
    &file,
    "[smtp]\nurl = \" smtps://dopgate:from-file@smtp.example.com \"\nfrom_email = \"No-Reply@Example.com\"\n",
  )
  .unwrap();
  let flags = ServerOverrides {
    config_path: Some(file),
    database_url: Some(URL.into()),
    ..Default::default()
  };
  let environment = EnvironmentOverrides {
    smtp_from_name: Some("Example".into()),
    ..Default::default()
  };
  let config = ServerConfig::load_with_environment(&flags, environment).unwrap();
  let smtp = config.smtp.mailer_config().unwrap();
  assert_eq!(smtp.host, "smtp.example.com");
  assert_eq!(smtp.port, 465);
  assert_eq!(smtp.username.as_deref(), Some("dopgate"));
  assert_eq!(smtp.password.as_deref().unwrap().as_str(), "from-file");
  assert_eq!(smtp.from_email, "no-reply@example.com");
  assert_eq!(smtp.from_name.as_deref(), Some("Example"));

  // A URL in the environment brings its own port, security and sign-in.
  let config =
    ServerConfig::load_with_environment(&flags, smtp_url("smtp://relay.example.com")).unwrap();
  let smtp = config.smtp.mailer_config().unwrap();
  assert_eq!(smtp.host, "relay.example.com");
  assert_eq!(smtp.port, 587);
  assert_eq!(smtp.username, None);
  assert!(smtp.password.is_none());
  assert_eq!(smtp.from_email, "no-reply@example.com");

  // An empty variable clears the file's server.
  let environment = EnvironmentOverrides {
    smtp_url: Some(String::new()),
    ..Default::default()
  };
  let config = ServerConfig::load_with_environment(&flags, environment).unwrap();
  assert!(config.smtp.mailer_config().is_none());
}
