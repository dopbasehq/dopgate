mod assets;
mod instance;

pub use instance::{InstanceLock, is_initialized};

use std::{sync::Arc, time::Duration};

use anstyle::{AnsiColor, Color, Effects, Style};
use anyhow::{Context, Result};
use axum::{
  Router,
  extract::DefaultBodyLimit,
  http::{HeaderName, Request, StatusCode},
  middleware,
  middleware::Next,
  response::{IntoResponse, Response},
};
use tower_http::{
  request_id::{MakeRequestUuid, PropagateRequestIdLayer, SetRequestIdLayer},
  timeout::TimeoutLayer,
  trace::TraceLayer,
};
use utoipa::openapi::security::{ApiKey, ApiKeyValue, Http, HttpAuthScheme, SecurityScheme};
use utoipa_swagger_ui::SwaggerUi;

use crate::{
  config::{ServerConfig, ensure_data_dir},
  constants::{
    api,
    config::AUDIT_RETENTION_INTERVAL,
    errors::{INTERNAL_ERROR, REQUEST_INVALID},
    tokens::SETUP_TOKEN_PREFIX,
  },
  extractors::CLIENT_KEY_HEADER,
  http::HttpError,
  middlewares, modules,
  services::{crypto::CryptoService, db::DbClient, rate_limit::RateLimiter, token},
  state::{AppState, SetupState},
};

/// Open the database, apply migrations and audit retention, and load the
/// master key. Everything that touches an instance starts here.
pub async fn prepare_instance(config: &ServerConfig) -> Result<(DbClient, CryptoService)> {
  ensure_data_dir(&config.data_dir)?;
  let db = DbClient::connect(&config.database_url)
    .await
    .context("failed to open SQLite")?;
  db.migrate()
    .await
    .context("failed to run database migrations")?;
  if let Some(retention) = config.audit_retention() {
    crate::services::audit_chain::apply_retention(db.pool(), &retention)
      .await
      .context("failed to apply audit retention")?;
  }
  let crypto = CryptoService::initialize(db.pool(), &config.master_key.path)
    .await
    .context("failed to initialize master key")?;
  Ok((db, crypto))
}

/// Build runtime state. An instance without a root account gets a one-time
/// setup token.
pub async fn build_state(config: ServerConfig) -> Result<AppState> {
  let (db, crypto) = prepare_instance(&config).await?;
  // The presets are compiled in; a broken file fails here, not at the first
  // sign-in.
  modules::sso::presets::all();
  let setup_token = if is_initialized(db.pool()).await? {
    None
  } else {
    Some(token::generate(SETUP_TOKEN_PREFIX)?)
  };
  Ok(AppState {
    config: Arc::new(config),
    db,
    crypto,
    setup: Arc::new(tokio::sync::RwLock::new(SetupState { token: setup_token })),
    rate_limiter: RateLimiter::default(),
    oidc: Default::default(),
    maintenance: Arc::new(std::sync::atomic::AtomicBool::new(false)),
    started_at: std::time::Instant::now(),
  })
}

/// The OpenAPI document, with the security schemes every module refers to.
pub fn openapi() -> utoipa::openapi::OpenApi {
  let mut openapi = modules::openapi();
  openapi.info.title = "dopgate API".to_string();
  openapi.info.version = env!("CARGO_PKG_VERSION").to_string();
  openapi.info.description = Some(
    "Sign users up and in, verify email addresses, reset passwords, issue JWTs, and manage users, clients, and settings."
      .to_string(),
  );
  prefix_operation_ids(&mut openapi);
  let components = openapi.components.get_or_insert_with(Default::default);
  components.add_security_scheme(
    "bearerAuth",
    SecurityScheme::Http(Http::new(HttpAuthScheme::Bearer)),
  );
  components.add_security_scheme(
    "clientKey",
    SecurityScheme::ApiKey(ApiKey::Header(ApiKeyValue::new(CLIENT_KEY_HEADER))),
  );
  openapi
}

/// Modules name their handlers `list`, `get`, `create`, and so on, which
/// repeat across modules. OpenAPI needs every operation ID to be unique, so
/// each one gets its tag in front: `users_list`, `clients_list`.
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
    .layer(middleware::from_fn_with_state(
      state.clone(),
      maintenance_gate,
    ))
    .layer(axum::middleware::from_fn(middlewares::security::headers))
    .layer(middleware::from_fn_with_state(
      state.clone(),
      middlewares::client_ip::capture,
    ))
    .with_state(state)
}

async fn maintenance_gate(
  axum::extract::State(state): axum::extract::State<AppState>,
  request: Request<axum::body::Body>,
  next: Next,
) -> Response {
  if state.maintenance.load(std::sync::atomic::Ordering::SeqCst)
    && request.uri().path().starts_with(api::PREFIX)
  {
    return HttpError::new(
      StatusCode::SERVICE_UNAVAILABLE,
      "INSTANCE_RESTORING",
      "A backup is being restored. Try again shortly.",
    )
    .into_response();
  }
  next.run(request).await
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
  data_dir: &std::path::Path,
  docs_enabled: bool,
) -> String {
  let public_url = public_url.trim_end_matches('/');
  let heading = Style::new().effects(Effects::BOLD);
  let mut rows = vec![
    format!("{heading}dopgate{heading:#}"),
    "Authentication you host yourself".to_string(),
    format!("Version {}", env!("CARGO_PKG_VERSION")),
    String::new(),
    format!("Public URL: {public_url}"),
    format!("Bind:       {bind_address}"),
    format!("API:        {public_url}/api/v1"),
    format!("Data:       {}", data_dir.display()),
  ];
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
) -> String {
  let base = public_url.trim_end_matches('/');
  format!(
    "\nNo root account yet. Create one with `dopgate init`, or send this one-time setup token:\n\n{token}\n\n\
     curl -X POST {base}{} \\\n  -H 'content-type: application/json' \\\n  -d '{{\"setupToken\":\"{token}\",\"email\":\"you@example.com\",\"password\":\"...\"}}'\n",
    api::bootstrap::ROOT
  )
}

/// Run the server until Ctrl-C or SIGTERM.
pub async fn serve(config: ServerConfig) -> Result<()> {
  ensure_data_dir(&config.data_dir)?;
  let _lock = InstanceLock::acquire(&config.database_url)?;
  let address = config.bind_addr()?;
  let state = build_state(config).await?;
  let listener = tokio::net::TcpListener::bind(address)
    .await
    .with_context(|| format!("failed to bind {address}"))?;
  state.config.ensure_reference_files()?;
  let public_url = state.config.public_url.trim_end_matches('/');
  anstream::eprintln!(
    "\n{}\n",
    startup_banner(
      public_url,
      &state.config.bind_address,
      &state.config.data_dir,
      state.config.docs_enabled,
    )
  );
  if let Some(warning) = state.config.public_url_warning() {
    anstream::eprintln!("{}\n", startup_warning(&warning));
  }
  if let Some(setup) = state.setup.read().await.token.as_deref() {
    eprintln!("{}", setup_token_message(public_url, setup));
  }
  tracing::info!(%address, "dopgate server started");
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
  serve_result?;
  crate::services::audit_chain::log_checkpoint(state.db.pool()).await;
  if let Err(error) = state.db.checkpoint().await {
    tracing::warn!(%error, "failed to checkpoint SQLite WAL during shutdown");
  }
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
