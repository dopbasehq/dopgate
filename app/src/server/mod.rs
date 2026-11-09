mod assets;
mod cors;
mod instance;

pub use instance::is_initialized;

use std::{sync::Arc, time::Duration};

use anstyle::{AnsiColor, Color, Effects, Style};
use anyhow::{Context, Result};
use axum::{
  Router,
  extract::DefaultBodyLimit,
  http::{HeaderName, StatusCode},
  middleware,
  response::{IntoResponse, Response},
};
use tower_http::{
  request_id::{MakeRequestUuid, PropagateRequestIdLayer, SetRequestIdLayer},
  timeout::TimeoutLayer,
  trace::TraceLayer,
};
use utoipa::openapi::security::{Http, HttpAuthScheme, SecurityScheme};
use utoipa_swagger_ui::SwaggerUi;

use crate::{
  config::{ServerConfig, redact_database_url},
  constants::{
    api,
    config::AUDIT_RETENTION_INTERVAL,
    errors::{INTERNAL_ERROR, REQUEST_INVALID},
    tokens::SETUP_TOKEN_PREFIX,
  },
  http::HttpError,
  middlewares, modules,
  services::{db::DbClient, keys::KeyStore, rate_limit::RateLimiter, token},
  state::{AppState, SetupState},
};

/// Connect to Postgres, apply migrations and audit retention. Everything
/// that touches an instance starts here.
pub async fn prepare_instance(config: &ServerConfig) -> Result<DbClient> {
  let db = DbClient::connect_with(
    &config.database_url,
    &config.database_schema,
    crate::constants::config::DATABASE_READY_TIMEOUT,
    config.database_max_connections,
  )
  .await?;
  db.migrate()
    .await
    .context("failed to run database migrations")?;
  if let Some(retention) = config.audit_retention() {
    crate::services::audit_chain::apply_retention(db.pool(), &retention)
      .await
      .context("failed to apply audit retention")?;
  }
  Ok(db)
}

/// What startup did about the root account.
pub enum RootSetup {
  /// Root already existed.
  Exists,
  /// Root was created from `DOPGATE_ROOT_EMAIL` with this generated
  /// password, which is shown once.
  Created { email: String, password: String },
  /// No root yet: `POST /bootstrap/root` needs this token.
  SetupToken(String),
}

/// Build runtime state. Creates the root account from `DOPGATE_ROOT_EMAIL`
/// on a fresh database; otherwise an instance without root gets a one-time
/// setup token.
pub async fn build_state(config: ServerConfig) -> Result<AppState> {
  Ok(build_state_with_setup(config).await?.0)
}

pub async fn build_state_with_setup(config: ServerConfig) -> Result<(AppState, RootSetup)> {
  let db = prepare_instance(&config).await?;
  // The presets are compiled in; a broken file fails here, not at the first
  // sign-in.
  modules::sso::presets::all();
  let keys = KeyStore::default();
  keys
    .initialize(db.pool())
    .await
    .context("failed to load the signing keys")?;
  let root = if is_initialized(db.pool()).await? {
    RootSetup::Exists
  } else if let Some(email) = &config.root_email {
    let password = std::env::var(crate::constants::config::ENV_ROOT_PASSWORD)
      .ok()
      .filter(|value| !value.is_empty());
    let generated = password.is_none();
    let password = match password {
      Some(password) => password,
      None => crate::services::password::generate(),
    };
    match modules::bootstrap::service::create_root(&db, email, &password).await {
      Ok(_) if generated => RootSetup::Created {
        email: email.clone(),
        password,
      },
      Ok(_) => RootSetup::Exists,
      // Another instance created root at the same moment.
      Err(error) if error.status == StatusCode::CONFLICT => RootSetup::Exists,
      Err(error) => anyhow::bail!("failed to create the root account: {:?}", error.errors),
    }
  } else {
    RootSetup::SetupToken(token::generate(SETUP_TOKEN_PREFIX)?)
  };
  let setup_token = match &root {
    RootSetup::SetupToken(token) => Some(token.clone()),
    _ => None,
  };
  let state = AppState {
    config: Arc::new(config),
    db,
    setup: Arc::new(tokio::sync::RwLock::new(SetupState { token: setup_token })),
    rate_limiter: RateLimiter::default(),
    keys,
    oidc: Default::default(),
    started_at: std::time::Instant::now(),
  };
  Ok((state, root))
}

/// The OpenAPI document, with the security schemes every module refers to.
pub fn openapi() -> utoipa::openapi::OpenApi {
  let mut openapi = modules::openapi();
  openapi.info.title = "Dopgate API".to_string();
  openapi.info.version = env!("CARGO_PKG_VERSION").to_string();
  openapi.info.description = Some(
    "Sign users up and in, verify email addresses, reset passwords, issue JWTs, and manage users, email templates, and settings."
      .to_string(),
  );
  prefix_operation_ids(&mut openapi);
  let components = openapi.components.get_or_insert_with(Default::default);
  components.add_security_scheme(
    "bearerAuth",
    SecurityScheme::Http(Http::new(HttpAuthScheme::Bearer)),
  );
  openapi
}

/// Modules name their handlers `list`, `get`, `create`, and so on, which
/// repeat across modules. OpenAPI needs every operation ID to be unique, so
/// each one gets its tag in front: `users_list`, `audit_list`.
fn prefix_operation_ids(openapi: &mut utoipa::openapi::OpenApi) {
  for item in openapi.paths.paths.values_mut() {
    for operation in [
      &mut item.get,
      &mut item.put,
      &mut item.post,
      &mut item.delete,
      &mut item.options,
      &mut item.head,
      &mut item.patch,
      &mut item.trace,
    ]
    .into_iter()
    .flatten()
    {
      let tag = operation
        .tags
        .as_ref()
        .and_then(|tags| tags.first())
        .cloned();
      if let (Some(tag), Some(id)) = (tag, operation.operation_id.as_mut()) {
        *id = format!("{tag}_{id}");
      }
    }
  }
}

pub fn router(state: AppState) -> Router {
  let request_id = HeaderName::from_static("x-request-id");
  let mut router = Router::new().merge(modules::routes());
  let cors = cors::layer(&state.config.allowed_origins);
  if state.config.docs_enabled {
    router = router.merge(SwaggerUi::new(api::docs::UI).url(api::docs::OPENAPI, openapi()));
  }
  router
    .fallback(assets::static_fallback)
    .layer(DefaultBodyLimit::max(3 * 1024 * 1024))
    .layer(TimeoutLayer::with_status_code(
      StatusCode::REQUEST_TIMEOUT,
      Duration::from_secs(30),
    ))
    .layer(TraceLayer::new_for_http())
    .layer(PropagateRequestIdLayer::new(request_id.clone()))
    .layer(SetRequestIdLayer::new(request_id, MakeRequestUuid))
    .layer(middleware::map_response(normalize_error_response))
    .layer(cors)
    .layer(axum::middleware::from_fn(middlewares::security::headers))
    .layer(middleware::from_fn_with_state(
      state.clone(),
      middlewares::client_ip::capture,
    ))
    .with_state(state)
}

/// Errors from axum itself (bad JSON, unknown method, timeouts) come back
/// as plain text. Rewrite them into the same JSON shape as every other error.
async fn normalize_error_response(response: Response) -> Response {
  let status = response.status();
  if !status.is_client_error() && !status.is_server_error() {
    return response;
  }
  let is_json = response
    .headers()
    .get(axum::http::header::CONTENT_TYPE)
    .and_then(|value| value.to_str().ok())
    .is_some_and(|value| value.starts_with("application/json"));
  if is_json {
    return response;
  }
  let request_id = response.headers().get("x-request-id").cloned();
  let error = if status.is_server_error() {
    HttpError::new(status, INTERNAL_ERROR, "An internal error occurred.")
  } else {
    HttpError::new(
      status,
      REQUEST_INVALID,
      "The request could not be processed.",
    )
  };
  let mut normalized = error.into_response();
  if let Some(request_id) = request_id {
    normalized.headers_mut().insert("x-request-id", request_id);
  }
  normalized
}

pub fn startup_banner(
  public_url: &str,
  bind_address: &str,
  database: &str,
  schema: &str,
  docs_enabled: bool,
  web_ui_enabled: bool,
) -> String {
  let public_url = public_url.trim_end_matches('/');
  let heading = Style::new().effects(Effects::BOLD);
  let mut rows = vec![
    format!("{heading}Dopgate{heading:#}"),
    "Authentication you host yourself".to_string(),
    format!("Version {}", env!("CARGO_PKG_VERSION")),
    String::new(),
    format!("Public URL: {public_url}"),
    format!("Bind:       {bind_address}"),
    format!("API:        {public_url}/api/v1"),
    format!("JWKS:       {public_url}{}", api::keys::JWKS),
    format!("Database:   {database} (schema {schema})"),
  ];
  if web_ui_enabled {
    rows.push(format!("Console:    {public_url}/"));
  }
  if docs_enabled {
    rows.push(format!("API docs:   {public_url}{}", api::docs::UI));
  }
  rows.join("\n")
}

pub fn startup_warning(warning: &str) -> String {
  let style = Style::new()
    .fg_color(Some(Color::Ansi(AnsiColor::Yellow)))
    .effects(Effects::BOLD);
  format!("{style}Warning: {style:#}{warning}")
}

/// The one-time setup token message shown while no root account exists.
pub fn setup_token_message(
  public_url: &str,
  token: &str,
  web_ui_enabled: bool,
) -> String {
  let base = public_url.trim_end_matches('/');
  let console = if web_ui_enabled {
    format!("Open {base}/setup and paste it there, or send it with curl:\n\n")
  } else {
    "Send it with curl:\n\n".to_string()
  };
  format!(
    "\nNo root account yet. Set DOPGATE_ROOT_EMAIL, run `dopgate init`, or use this one-time setup token:\n\n{token}\n\n{console}\
     curl -X POST {base}{} \\\n  -H 'content-type: application/json' \\\n  -d '{{\"setupToken\":\"{token}\",\"email\":\"you@example.com\",\"password\":\"...\"}}'\n",
    api::bootstrap::ROOT
  )
}

/// The generated root password, shown once.
pub fn root_created_message(
  email: &str,
  password: &str,
) -> String {
  let style = Style::new()
    .fg_color(Some(Color::Ansi(AnsiColor::Yellow)))
    .effects(Effects::BOLD);
  format!(
    "\n{style}Root account created for {email}.{style:#}\nPassword: {password}\n\nThis password is shown once. Sign in and change it, and clear DOPGATE_ROOT_EMAIL if you like; later starts ignore it.\n"
  )
}

/// Run the server until Ctrl-C or SIGTERM.
pub async fn serve(config: ServerConfig) -> Result<()> {
  let address = config.bind_addr()?;
  let (state, root) = build_state_with_setup(config).await?;
  let listener = tokio::net::TcpListener::bind(address)
    .await
    .with_context(|| format!("failed to bind {address}"))?;
  let public_url = state.config.public_url.trim_end_matches('/');
  anstream::eprintln!(
    "\n{}\n",
    startup_banner(
      public_url,
      &state.config.bind_address,
      &redact_database_url(&state.config.database_url),
      state.db.schema(),
      state.config.docs_enabled,
      state.config.web_ui_enabled,
    )
  );
  if let Some(warning) = state.config.public_url_warning() {
    anstream::eprintln!("{}\n", startup_warning(&warning));
  }
  match &root {
    RootSetup::Created { email, password } => {
      anstream::eprintln!("{}", root_created_message(email, password));
    }
    RootSetup::SetupToken(token) => {
      eprintln!(
        "{}",
        setup_token_message(public_url, token, state.config.web_ui_enabled)
      );
    }
    RootSetup::Exists => {}
  }
  tracing::info!(%address, "Dopgate server started");
  // The audit head goes to the log at startup and shutdown, so the log
  // collector keeps a copy of it outside the database.
  crate::services::audit_chain::log_checkpoint(state.db.pool()).await;
  // Startup already applied retention in prepare_instance; this keeps it
  // applied while the server runs.
  let retention_task = state.config.audit_retention().map(|retention| {
    crate::services::audit_chain::spawn_retention(
      state.db.pool().clone(),
      retention,
      AUDIT_RETENTION_INTERVAL,
    )
  });
  // Keys rotated by another process (`dopgate keys rotate`, another
  // replica) are picked up within a minute.
  let key_reload_task = {
    let state = state.clone();
    tokio::spawn(async move {
      let mut ticker = tokio::time::interval(Duration::from_secs(60));
      ticker.tick().await;
      loop {
        ticker.tick().await;
        if let Err(error) = state.keys.reload(state.db.pool()).await {
          tracing::warn!(%error, "failed to reload signing keys");
        }
      }
    })
  };
  let grace = state.config.shutdown_grace_seconds;
  // Connection info carries the peer address rate limits and audit records use.
  let serve_result = axum::serve(
    listener,
    router(state.clone()).into_make_service_with_connect_info::<std::net::SocketAddr>(),
  )
  .with_graceful_shutdown(shutdown_signal())
  .await;
  if let Some(task) = retention_task {
    task.abort();
  }
  key_reload_task.abort();
  serve_result?;
  crate::services::audit_chain::log_checkpoint(state.db.pool()).await;
  let _ = tokio::time::timeout(Duration::from_secs(grace), state.db.close()).await;
  Ok(())
}

async fn shutdown_signal() {
  let ctrl_c = async {
    let _ = tokio::signal::ctrl_c().await;
  };
  #[cfg(unix)]
  let terminate = async {
    if let Ok(mut signal) =
      tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
    {
      signal.recv().await;
    } else {
      std::future::pending::<()>().await;
    }
  };
  #[cfg(not(unix))]
  let terminate = std::future::pending::<()>();
  tokio::select! {_=ctrl_c=>{},_=terminate=>{}}
}
