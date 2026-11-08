use std::fs::{File, OpenOptions};

use anyhow::{Context, Result};
use sqlx::SqlitePool;

use crate::config::database_path;

/// Whether setup has created the root account.
pub async fn is_initialized(pool: &SqlitePool) -> Result<bool, sqlx::Error> {
  sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM users WHERE role = 'root')")
    .fetch_one(pool)
    .await
}

/// Holds an exclusive lock on `<database>.lock` so two servers never open
/// the same database.
pub struct InstanceLock {
  file: File,
}

impl InstanceLock {
  pub fn acquire(database_url: &str) -> Result<Option<Self>> {
    if database_url.contains(":memory:") {
      return Ok(None);
    }
    let file = Self::open(database_url)?;
    file.try_lock().context(
      "dopgate is already running for this database. \nStop the running server before starting another one",
    )?;
    Ok(Some(Self { file }))
  }

  fn open(database_url: &str) -> Result<File> {
    let lock = Self::lock_path(database_url)?;
    if let Some(parent) = lock.parent() {
      std::fs::create_dir_all(parent)?;
    }
    let file = OpenOptions::new()
      .create(true)
      .truncate(false)
      .read(true)
      .write(true)
      .open(&lock)?;
    Ok(file)
  }

  fn lock_path(database_url: &str) -> Result<std::path::PathBuf> {
    let database = database_path(database_url)?;
    Ok(std::path::PathBuf::from(format!(
      "{}.lock",
      database.display()
    )))
  }
}

impl Drop for InstanceLock {
  fn drop(&mut self) {
    let _ = self.file.unlock();
  }
}
