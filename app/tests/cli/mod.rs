//! The `dopgate` binary, run as a user would run it.

use std::{
  io::Write,
  process::{Command, Output, Stdio},
};

use serde_json::Value;

use crate::support::{SchemaGuard, database_url, unique_schema};

fn dopgate(schema: &str) -> Command {
  let mut command = Command::new(env!("CARGO_BIN_EXE_dopgate"));
  // Keep the caller's DOPGATE_* settings out of it.
  for (name, _) in std::env::vars() {
    if name.starts_with("DOPGATE_") {
      command.env_remove(name);
    }
  }
  command
    .env("RUST_LOG", "off")
    .env("DOPGATE_DATABASE_URL", database_url())
    .env("DOPGATE_DATABASE_SCHEMA", schema)
    .env("DOPGATE_DATABASE_MAX_CONNECTIONS", "2");
  command
}

fn json(bytes: &[u8]) -> Value {
  serde_json::from_slice(bytes.trim_ascii())
    .unwrap_or_else(|_| panic!("not JSON: {}", String::from_utf8_lossy(bytes)))
}

fn init(
  schema: &str,
  password: &str,
) -> Output {
  dopgate(schema)
    .args(["--json", "init", "--email", "Root@Example.com"])
    .env("DOPGATE_ROOT_PASSWORD", password)
    .output()
    .unwrap()
}

#[test]
fn init_creates_root_once() {
  let schema = unique_schema();
  let _guard = SchemaGuard(schema.clone());
  let output = init(&schema, "correct-horse");
  assert!(output.status.success(), "{output:?}");
  let body = json(&output.stdout);
  assert_eq!(body["success"], true);
  assert_eq!(body["data"]["email"], "root@example.com");
  assert_eq!(body["data"]["schema"], schema.as_str());

  let output = init(&schema, "correct-horse");
  assert_eq!(output.status.code(), Some(1));
  let body = json(&output.stderr);
  assert!(
    body["error"]["CLI_ERROR"]
      .as_str()
      .unwrap()
      .contains("already has a root account")
  );
}

#[test]
fn init_refuses_a_weak_password() {
  let schema = unique_schema();
  let _guard = SchemaGuard(schema.clone());
  let output = init(&schema, "short");
  assert_eq!(output.status.code(), Some(1));
  let body = json(&output.stderr);
  assert!(
    body["error"]["CLI_ERROR"]
      .as_str()
      .unwrap()
      .contains("at least 8 characters")
  );
}

#[test]
fn init_reads_the_password_from_stdin() {
  let schema = unique_schema();
  let _guard = SchemaGuard(schema.clone());
  let mut child = dopgate(&schema)
    .args([
      "--json",
      "init",
      "--email",
      "root@example.com",
      "--password-stdin",
    ])
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .spawn()
    .unwrap();
  child
    .stdin
    .take()
    .unwrap()
    .write_all(b"correct-horse\n")
    .unwrap();
  let output = child.wait_with_output().unwrap();
  assert!(output.status.success(), "{output:?}");
}

#[test]
fn commands_need_a_database_url() {
  let output = dopgate("unused")
    .env_remove("DOPGATE_DATABASE_URL")
    .args(["--json", "init", "--email", "root@example.com"])
    .env("DOPGATE_ROOT_PASSWORD", "correct-horse")
    .output()
    .unwrap();
  assert_eq!(output.status.code(), Some(1));
  assert!(String::from_utf8_lossy(&output.stderr).contains("DOPGATE_DATABASE_URL"));
}

#[test]
fn keys_rotate_is_planned() {
  let output = dopgate("unused")
    .args(["--json", "keys", "rotate"])
    .output()
    .unwrap();
  assert_eq!(output.status.code(), Some(2));
  assert!(json(&output.stderr)["error"]["NOT_IMPLEMENTED"].is_string());
}

#[test]
fn removed_commands_are_gone() {
  for args in [
    vec!["backup", "create"],
    vec!["users", "export", "users.json"],
  ] {
    let output = dopgate("unused").args(&args).output().unwrap();
    assert_eq!(output.status.code(), Some(2), "{args:?}");
    assert!(String::from_utf8_lossy(&output.stderr).contains("unrecognized subcommand"));
  }
}

#[test]
fn version_matches_the_crate() {
  let output = dopgate("unused").arg("--version").output().unwrap();
  assert!(String::from_utf8_lossy(&output.stdout).contains(env!("CARGO_PKG_VERSION")));
}
