//! The `dopgate` binary, run as a user would run it.

use std::{
  io::Write,
  process::{Command, Output, Stdio},
};

use serde_json::Value;
use tempfile::TempDir;

fn dopgate() -> Command {
  let mut command = Command::new(env!("CARGO_BIN_EXE_dopgate"));
  // Keep the caller's DOPGATE_* settings and home directory out of it.
  for (name, _) in std::env::vars() {
    if name.starts_with("DOPGATE_") {
      command.env_remove(name);
    }
  }
  command.env("RUST_LOG", "off");
  command
}

fn json(bytes: &[u8]) -> Value {
  serde_json::from_slice(bytes.trim_ascii())
    .unwrap_or_else(|_| panic!("not JSON: {}", String::from_utf8_lossy(bytes)))
}

fn init(
  directory: &TempDir,
  password: &str,
) -> Output {
  dopgate()
    .args([
      "--json",
      "init",
      "--email",
      "Root@Example.com",
      "--data-dir",
    ])
    .arg(directory.path())
    .env("DOPGATE_ROOT_PASSWORD", password)
    .output()
    .unwrap()
}

#[test]
fn init_creates_root_once() {
  let directory = TempDir::new().unwrap();
  let output = init(&directory, "correct-horse");
  assert!(output.status.success(), "{output:?}");
  let body = json(&output.stdout);
  assert_eq!(body["success"], true);
  assert_eq!(body["data"]["email"], "root@example.com");
  for file in ["dopgate.db", "master.key", "server.toml"] {
    assert!(directory.path().join(file).exists(), "missing {file}");
  }

  let output = init(&directory, "correct-horse");
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
  let directory = TempDir::new().unwrap();
  let output = init(&directory, "short");
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
  let directory = TempDir::new().unwrap();
  let mut child = dopgate()
    .args([
      "--json",
      "init",
      "--email",
      "root@example.com",
      "--password-stdin",
      "--data-dir",
    ])
    .arg(directory.path())
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
fn init_refuses_while_a_server_holds_the_database() {
  let directory = TempDir::new().unwrap();
  let url = app::config::sqlite_url(&directory.path().join("dopgate.db"));
  let _lock = app::server::InstanceLock::acquire(&url).unwrap();
  let output = init(&directory, "correct-horse");
  assert_eq!(output.status.code(), Some(1));
  assert!(String::from_utf8_lossy(&output.stderr).contains("already running"));
}

#[test]
fn planned_commands_exit_with_code_2() {
  for args in [
    vec!["backup", "create"],
    vec!["backup", "restore", "file.dop"],
    vec!["users", "export", "users.json"],
    vec!["users", "import", "users.json"],
    vec!["keys", "rotate"],
  ] {
    let output = dopgate().arg("--json").args(&args).output().unwrap();
    assert_eq!(output.status.code(), Some(2), "{args:?}");
    assert!(output.stdout.is_empty(), "{args:?}");
    let body = json(&output.stderr);
    assert!(body["error"]["NOT_IMPLEMENTED"].is_string(), "{args:?}");
  }
}

#[test]
fn version_matches_the_crate() {
  let output = dopgate().arg("--version").output().unwrap();
  assert!(String::from_utf8_lossy(&output.stdout).contains(env!("CARGO_PKG_VERSION")));
}
