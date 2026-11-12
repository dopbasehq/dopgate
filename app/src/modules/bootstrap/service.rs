use super::{model::*, repository};
use crate::{
  constants::{
    errors::{
      ALREADY_INITIALIZED, EMAIL_INVALID, EMAIL_INVALID_MESSAGE, PASSWORD_INVALID, RATE_LIMITED,
      SETUP_TOKEN_INVALID,
    },
    tokens::ADMIN_ID_PREFIX,
  },
  http::HttpError,
  modules::audit,
  server::is_initialized,
  services::{client_ip, db::DbClient, password, token},
  state::AppState,
  utils::email,
};
use axum::http::StatusCode;

pub async fn status(state: &AppState) -> Result<BootstrapStatus, HttpError> {
  Ok(BootstrapStatus {
    initialized: is_initialized(state.db.pool()).await?,
  })
}

/// Create the root account from the API, with the setup token.
pub async fn bootstrap_root(
  state: &AppState,
  request: CreateRootRequest,
) -> Result<RootCreated, HttpError> {
  let limiter_key = format!(
    "setup:{}",
    client_ip::current().map_or_else(|| "unknown".to_owned(), |ip| ip.to_string())
  );
  if !state.rate_limiter.check(&limiter_key).await {
    let mut error = HttpError::new(
      StatusCode::TOO_MANY_REQUESTS,
      RATE_LIMITED,
      "Too many wrong setup tokens. Try again in 15 minutes.",
    );
    error.retry_after = Some(15 * 60);
    return Err(error);
  }
  let mut setup = state.setup.write().await;
  let Some(expected) = setup.token.as_deref() else {
    return Err(already_initialized());
  };
  if !token::constant_time_eq(expected, request.setup_token.trim()) {
    state.rate_limiter.failure(&limiter_key).await;
    return Err(HttpError::unauthorized(
      SETUP_TOKEN_INVALID,
      "The setup token is wrong. Copy it from the server log.",
    ));
  }
  let admin_id = create_root(&state.db, &request.email, &request.password).await?;
  setup.token = None;
  state.rate_limiter.clear(&limiter_key).await;
  Ok(RootCreated {
    admin_id,
    email: email::normalize(&request.email).unwrap_or(request.email),
  })
}

/// Create the root account. Shared by the API and `dopgate init`.
pub async fn create_root(
  db: &DbClient,
  email_address: &str,
  new_password: &str,
) -> Result<String, HttpError> {
  let email = email::normalize(email_address).ok_or_else(|| {
    HttpError::new(
      StatusCode::UNPROCESSABLE_ENTITY,
      EMAIL_INVALID,
      EMAIL_INVALID_MESSAGE,
    )
  })?;
  password::check_policy(new_password).map_err(|violation| {
    HttpError::new(
      StatusCode::UNPROCESSABLE_ENTITY,
      PASSWORD_INVALID,
      violation.0,
    )
  })?;
  let password_hash = password::hash_async(new_password.to_owned())
    .await
    .map_err(|error| {
      tracing::error!(%error, "failed to hash the root password");
      HttpError::internal()
    })?;
  let id = token::public_id(ADMIN_ID_PREFIX);
  let mut tx = db.pool().begin().await?;
  if let Err(error) = repository::insert_root(&mut tx, &id, &email, &password_hash).await {
    if error
      .as_database_error()
      .is_some_and(|database| database.is_unique_violation())
    {
      return Err(already_initialized());
    }
    return Err(error.into());
  }
  audit::service::record(
    &mut tx,
    audit::service::Event {
      actor_type: "system",
      actor_id: None,
      actor_label: Some("setup"),
      action: "instance.initialized",
      resource_type: Some("admin"),
      resource_id: Some(&id),
      metadata: serde_json::json!({ "email": email }),
    },
  )
  .await?;
  tx.commit().await?;
  Ok(id)
}

fn already_initialized() -> HttpError {
  HttpError::conflict(
    ALREADY_INITIALIZED,
    "This instance already has a root account.",
  )
}
