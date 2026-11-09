use super::{error::SessionsError, model::*, service};
use crate::{
  extractors::UserIdentity,
  http::{HttpResponse, HttpResponseFormat},
  modules::audit,
  state::AppState,
};
use axum::extract::{Path, Query, State};

/// List sessions
///
/// List the devices signed in to the current account, most recently used
/// first.
#[utoipa::path(
  get,
  path = crate::constants::api::sessions::COLLECTION,
  tag = "sessions",
  security(("bearerAuth" = [])),
  responses(
    (status = 200, description = "Sessions fetched", body = inline(HttpResponseFormat<Vec<SessionResponse>>)),
    (status = 401, description = "Authentication is required", body = crate::http::ErrorBody),
  ),
)]
pub async fn list(
  State(state): State<AppState>,
  user: UserIdentity,
) -> Result<HttpResponse<Vec<SessionResponse>>, SessionsError> {
  Ok(HttpResponse::ok(
    service::list(&state, &user.user_id, Some(&user.session_id)).await?,
    "SESSIONS_FETCHED",
  ))
}

/// Sign out a device
///
/// End one session of the current account. Its refresh token stops working
/// at once, and Dopgate refuses its access token. Backends that verify
/// tokens offline accept the access token until it expires, within minutes.
#[utoipa::path(
  delete,
  path = crate::constants::api::sessions::ITEM,
  tag = "sessions",
  security(("bearerAuth" = [])),
  params(("id" = String, Path, description = "Session ID with the ses_ prefix")),
  responses(
    (status = 200, description = "Session ended", body = inline(HttpResponseFormat<serde_json::Value>)),
    (status = 401, description = "Authentication is required", body = crate::http::ErrorBody),
    (status = 404, description = "No such session on this account", body = crate::http::ErrorBody),
  ),
)]
pub async fn revoke(
  State(state): State<AppState>,
  user: UserIdentity,
  Path(id): Path<String>,
) -> Result<HttpResponse<serde_json::Value>, SessionsError> {
  service::revoke_own(&state, &user.user_id, &user.email, user.role.as_str(), &id).await?;
  Ok(HttpResponse::done("SESSION_REVOKED"))
}

/// Sign out everywhere
///
/// End every session of the current account. With `keepCurrent=true`, the
/// session making this request stays signed in.
#[utoipa::path(
  delete,
  path = crate::constants::api::sessions::COLLECTION,
  tag = "sessions",
  security(("bearerAuth" = [])),
  params(RevokeAllQuery),
  responses(
    (status = 200, description = "Sessions ended", body = inline(HttpResponseFormat<serde_json::Value>)),
    (status = 401, description = "Authentication is required", body = crate::http::ErrorBody),
  ),
)]
pub async fn revoke_all(
  State(state): State<AppState>,
  user: UserIdentity,
  Query(query): Query<RevokeAllQuery>,
) -> Result<HttpResponse<serde_json::Value>, SessionsError> {
  let keep = query.keep_current.then_some(user.session_id.as_str());
  let mut tx = state.db.pool().begin().await?;
  let ended = service::revoke_all(&mut tx, &user.user_id, keep, "signed_out_everywhere").await?;
  audit::service::record(
    &mut tx,
    audit::service::Event::user(
      &user.user_id,
      &user.email,
      user.role.as_str(),
      "session.revoked_all",
    )
    .metadata(serde_json::json!({ "sessions": ended, "keptCurrent": query.keep_current })),
  )
  .await?;
  tx.commit().await?;
  Ok(HttpResponse::done("SESSIONS_REVOKED"))
}
