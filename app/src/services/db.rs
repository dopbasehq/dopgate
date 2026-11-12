//! The PostgreSQL connection pool.
//!
//! Dopgate keeps every table in its own schema (`dopgate` by default) so it
//! can share a database with the app it serves. Each pooled connection sets
//! `search_path` to that schema, so queries use bare table names and the
//! migrations, sqlx's own `_sqlx_migrations` table included, land there too.

use std::time::{Duration, Instant};

use anyhow::{Context, Result, bail};
use sqlx::{
  ConnectOptions, Executor, PgPool,
  postgres::{PgConnectOptions, PgPoolOptions},
};

use crate::{config::redact_database_url, constants::config::DATABASE_READY_TIMEOUT};

/// Embedded database migrations, exposed so tests can drive `run`/`undo`.
pub static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

/// A schema name Dopgate can quote safely: lowercase letters, digits, and
/// underscores, starting with a letter or underscore, at most 63 bytes.
pub fn validate_schema(schema: &str) -> Result<()> {
  let valid = !schema.is_empty()
    && schema.len() <= 63
    && schema
      .bytes()
      .next()
      .is_some_and(|first| first.is_ascii_lowercase() || first == b'_')
    && schema
      .bytes()
      .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
    && !schema.starts_with("pg_");
  if !valid {
    bail!(
      "database schema \"{schema}\" must use lowercase letters, digits, and underscores, start with a letter, and not start with pg_"
    );
  }
  Ok(())
}

/// PostgreSQL client backed by an async sqlx connection pool.
///
/// Cheap to clone because every clone shares the same underlying pool.
#[derive(Clone, Debug)]
pub struct DbClient {
  pool: PgPool,
  schema: String,
}

impl DbClient {
  /// Connect to `url`, wait until the server answers (up to
  /// [`DATABASE_READY_TIMEOUT`]), and make sure `schema` exists.
  pub async fn connect(
    url: &str,
    schema: &str,
  ) -> Result<Self> {
    Self::connect_with(url, schema, DATABASE_READY_TIMEOUT, 10).await
  }

  pub async fn connect_with(
    url: &str,
    schema: &str,
    ready_timeout: Duration,
    max_connections: u32,
  ) -> Result<Self> {
    validate_schema(schema)?;
    let options: PgConnectOptions = url
      .parse()
      .with_context(|| format!("invalid database URL {}", redact_database_url(url)))?;
    let options = options.application_name("dopgate");
    wait_until_ready(&options, ready_timeout)
      .await
      .with_context(|| format!("failed to reach PostgreSQL at {}", redact_database_url(url)))?;

    // The schema has to exist before a connection can make it its search
    // path, so it is created over a plain connection first.
    // Creating a schema needs the database's CREATE privilege, so it is
    // only attempted when the schema is missing. Once it exists, dopgate's
    // role only needs rights inside it.
    let mut setup = options.connect().await?;
    let exists: bool =
      sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname = $1)")
        .bind(schema)
        .fetch_one(&mut setup)
        .await?;
    if !exists {
      setup
        .execute(format!("CREATE SCHEMA IF NOT EXISTS \"{schema}\"").as_str())
        .await
        .with_context(|| format!("failed to create the database schema \"{schema}\""))?;
    }
    drop(setup);

    let search_path = format!("SET search_path TO \"{schema}\"");
    let pool = PgPoolOptions::new()
      .max_connections(max_connections)
      .acquire_timeout(Duration::from_secs(5))
      .idle_timeout(Duration::from_secs(60))
      .after_connect(move |connection, _| {
        let search_path = search_path.clone();
        Box::pin(async move {
          connection.execute(search_path.as_str()).await?;
          Ok(())
        })
      })
      .connect_with(options)
      .await?;
    Ok(Self {
      pool,
      schema: schema.to_owned(),
    })
  }

  /// Run the migrations embedded in the Dopgate executable.
  pub async fn migrate(&self) -> Result<()> {
    MIGRATOR.run(&self.pool).await?;
    Ok(())
  }

  /// Access the underlying pool for ad-hoc queries.
  pub fn pool(&self) -> &PgPool {
    &self.pool
  }

  /// The schema dopgate's tables live in.
  pub fn schema(&self) -> &str {
    &self.schema
  }

  /// Verify the database is reachable.
  pub async fn ping(&self) -> Result<(), sqlx::Error> {
    sqlx::query("SELECT 1")
      .execute(&self.pool)
      .await
      .map(|_| ())
  }

  /// Close every connection in the pool.
  pub async fn close(&self) {
    self.pool.close().await;
  }
}

/// Retry until the server accepts a connection or `timeout` passes. Postgres
/// started in the same compose stack is often still booting.
async fn wait_until_ready(
  options: &PgConnectOptions,
  timeout: Duration,
) -> Result<(), sqlx::Error> {
  let started = Instant::now();
  let mut delay = Duration::from_millis(200);
  loop {
    match options.connect().await {
      Ok(connection) => {
        drop(connection);
        return Ok(());
      }
      Err(error) if started.elapsed() + delay < timeout && is_transient(&error) => {
        tracing::info!(%error, "waiting for PostgreSQL");
        tokio::time::sleep(delay).await;
        delay = (delay * 2).min(Duration::from_secs(2));
      }
      Err(error) => return Err(error),
    }
  }
}

/// Connection refused, reset, or "the database system is starting up".
fn is_transient(error: &sqlx::Error) -> bool {
  match error {
    sqlx::Error::Io(_) | sqlx::Error::PoolTimedOut => true,
    sqlx::Error::Database(database) => database.code().as_deref() == Some("57P03"),
    _ => false,
  }
}
