use super::{
  error::AgentsError,
  model::*,
  service::{self, Owner},
};
use crate::{
  extractors::{AdminIdentity, ConsoleIdentity, UserIdentity},
  http::{HttpResponse, HttpResponseFormat},
  models::UserStatus,
  state::AppState,
};
use axum::{
  Json,
  extract::{Path, Query, State},
  http::StatusCode,
  response::{IntoResponse, Response},
};

// Your own agents, for users of your app. Every endpoint needs a password or
// code sign-in. Creating, editing, and regenerating need
// `selfService.agents` on; listing, turning off and on, and deleting don't.

/// List your agents
#[utoipa::path(
  get,
  path = crate::constants::api::agents::OWN_COLLECTION,
  tag = "agents",
  security(("bearerAuth" = [])),
  params(AgentQuery),
  responses(
    (status = 200, description = "Agents fetched", body = inline(HttpResponseFormat<AgentPage>)),
    (status = 403, description = "Not a user signed in with a password or code", body = crate::http::ErrorBody),
  ),
)]
pub async fn list_own(
  State(state): State<AppState>,
  user: UserIdentity,
  Query(query): Query<AgentQuery>,
) -> Result<HttpResponse<AgentPage>, AgentsError> {
  let query = AgentQuery {
    owner: Some(user.user_id.clone()),
    ..query
  };
  Ok(HttpResponse::ok(
    service::list(&state, query).await?,
    "AGENTS_FETCHED",
  ))
}

/// Create an agent
///
/// An agent you own, with its token in this answer only. Trade the token at
/// `/auth/token` for an access token with `kind: "agent"`, `owner`, and
/// `capabilities`.
#[utoipa::path(
  post,
  path = crate::constants::api::agents::OWN_COLLECTION,
  tag = "agents",
  security(("bearerAuth" = [])),
  request_body = CreateAgentRequest,
  responses(
    (status = 201, description = "Agent created", body = inline(HttpResponseFormat<AgentWithToken>)),
    (status = 403, description = "Agents for users are off, or not signed in with a password or code", body = crate::http::ErrorBody),
    (status = 409, description = "The name is taken, or the limit is reached", body = crate::http::ErrorBody),
    (status = 422, description = "The name, description, or capabilities were refused", body = crate::http::ErrorBody),
  ),
)]
pub async fn create_own(
  State(state): State<AppState>,
  user: UserIdentity,
  Json(request): Json<CreateAgentRequest>,
) -> Result<HttpResponse<AgentWithToken>, AgentsError> {
  Ok(HttpResponse::created(
    service::create(
      &state,
      &user.identity(),
      Owner::User(&user.user_id),
      request,
    )
    .await?,
    "AGENT_CREATED",
  ))
}

/// Show one of your agents
#[utoipa::path(
  get,
  path = crate::constants::api::agents::OWN_ITEM,
  tag = "agents",
  security(("bearerAuth" = [])),
  params(("id" = String, Path, description = "Agent ID with the agt_ prefix")),
  responses(
    (status = 200, description = "Agent fetched", body = inline(HttpResponseFormat<Agent>)),
    (status = 404, description = "No such agent of yours", body = crate::http::ErrorBody),
  ),
)]
pub async fn get_own(
  State(state): State<AppState>,
  user: UserIdentity,
  Path(id): Path<String>,
) -> Result<HttpResponse<Agent>, AgentsError> {
  Ok(HttpResponse::ok(
    service::find_own(&state, &user.user_id, &id)
      .await?
      .to_agent(),
    "AGENT_FETCHED",
  ))
}

/// Update one of your agents
///
/// New capabilities show up in the agent's next access token.
#[utoipa::path(
  patch,
  path = crate::constants::api::agents::OWN_ITEM,
  tag = "agents",
  security(("bearerAuth" = [])),
  params(("id" = String, Path, description = "Agent ID with the agt_ prefix")),
  request_body = UpdateAgentRequest,
  responses(
    (status = 200, description = "Agent updated", body = inline(HttpResponseFormat<Agent>)),
    (status = 403, description = "Agents for users are off", body = crate::http::ErrorBody),
    (status = 404, description = "No such agent of yours", body = crate::http::ErrorBody),
    (status = 409, description = "The name is taken", body = crate::http::ErrorBody),
    (status = 422, description = "A value was refused", body = crate::http::ErrorBody),
  ),
)]
pub async fn update_own(
  State(state): State<AppState>,
  user: UserIdentity,
  Path(id): Path<String>,
  Json(request): Json<UpdateAgentRequest>,
) -> Result<HttpResponse<Agent>, AgentsError> {
  service::require_self_service(&state).await?;
  let row = service::find_own(&state, &user.user_id, &id).await?;
  Ok(HttpResponse::ok(
    service::update(&state, &user.identity(), &row, request).await?,
    "AGENT_UPDATED",
  ))
}

/// Delete one of your agents
#[utoipa::path(
  delete,
  path = crate::constants::api::agents::OWN_ITEM,
  tag = "agents",
  security(("bearerAuth" = [])),
  params(("id" = String, Path, description = "Agent ID with the agt_ prefix")),
  responses(
    (status = 204, description = "Agent deleted"),
    (status = 404, description = "No such agent of yours", body = crate::http::ErrorBody),
  ),
)]
pub async fn delete_own(
  State(state): State<AppState>,
  user: UserIdentity,
  Path(id): Path<String>,
) -> Result<Response, AgentsError> {
  let row = service::find_own(&state, &user.user_id, &id).await?;
  service::delete(&state, &user.identity(), &row).await?;
  Ok(StatusCode::NO_CONTENT.into_response())
}

/// Regenerate your agent's token
///
/// The old token stops working at once. The new one is in this answer only.
#[utoipa::path(
  post,
  path = crate::constants::api::agents::OWN_REGENERATE,
  tag = "agents",
  security(("bearerAuth" = [])),
  params(("id" = String, Path, description = "Agent ID with the agt_ prefix")),
  responses(
    (status = 200, description = "Token regenerated", body = inline(HttpResponseFormat<AgentWithToken>)),
    (status = 403, description = "Agents for users are off", body = crate::http::ErrorBody),
    (status = 404, description = "No such agent of yours", body = crate::http::ErrorBody),
  ),
)]
pub async fn regenerate_own(
  State(state): State<AppState>,
  user: UserIdentity,
  Path(id): Path<String>,
) -> Result<HttpResponse<AgentWithToken>, AgentsError> {
  service::require_self_service(&state).await?;
  let row = service::find_own(&state, &user.user_id, &id).await?;
  Ok(HttpResponse::ok(
    service::regenerate(&state, &user.identity(), &row).await?,
    "AGENT_TOKEN_REGENERATED",
  ))
}

/// Turn off one of your agents
#[utoipa::path(
  post,
  path = crate::constants::api::agents::OWN_DISABLE,
  tag = "agents",
  security(("bearerAuth" = [])),
  params(("id" = String, Path, description = "Agent ID with the agt_ prefix")),
  responses(
    (status = 200, description = "Agent turned off", body = inline(HttpResponseFormat<Agent>)),
    (status = 404, description = "No such agent of yours", body = crate::http::ErrorBody),
  ),
)]
pub async fn disable_own(
  State(state): State<AppState>,
  user: UserIdentity,
  Path(id): Path<String>,
) -> Result<HttpResponse<Agent>, AgentsError> {
  let row = service::find_own(&state, &user.user_id, &id).await?;
  Ok(HttpResponse::ok(
    service::set_status(&state, &user.identity(), &row, UserStatus::Disabled).await?,
    "AGENT_DISABLED",
  ))
}

/// Turn one of your agents back on
#[utoipa::path(
  post,
  path = crate::constants::api::agents::OWN_ENABLE,
  tag = "agents",
  security(("bearerAuth" = [])),
  params(("id" = String, Path, description = "Agent ID with the agt_ prefix")),
  responses(
    (status = 200, description = "Agent turned on", body = inline(HttpResponseFormat<Agent>)),
    (status = 404, description = "No such agent of yours", body = crate::http::ErrorBody),
  ),
)]
pub async fn enable_own(
  State(state): State<AppState>,
  user: UserIdentity,
  Path(id): Path<String>,
) -> Result<HttpResponse<Agent>, AgentsError> {
  let row = service::find_own(&state, &user.user_id, &id).await?;
  Ok(HttpResponse::ok(
    service::set_status(&state, &user.identity(), &row, UserStatus::Active).await?,
    "AGENT_ENABLED",
  ))
}

// Every agent, for admins. Admins and the service key read; only admins in
// the console change anything, and only the owner edits or regenerates.

/// List agents
///
/// Every agent, newest first, with its owner. Filter by `owner`, `status`,
/// or `search` on the name.
#[utoipa::path(
  get,
  path = crate::constants::api::agents::ADMIN_COLLECTION,
  tag = "agents",
  security(("bearerAuth" = [])),
  params(AgentQuery),
  responses(
    (status = 200, description = "Agents fetched", body = inline(HttpResponseFormat<AgentPage>)),
    (status = 403, description = "Only admins and the service key", body = crate::http::ErrorBody),
  ),
)]
pub async fn list(
  State(state): State<AppState>,
  AdminIdentity(_actor): AdminIdentity,
  Query(query): Query<AgentQuery>,
) -> Result<HttpResponse<AgentPage>, AgentsError> {
  Ok(HttpResponse::ok(
    service::list(&state, query).await?,
    "AGENTS_FETCHED",
  ))
}

/// Create an agent as an admin
///
/// The signed-in admin owns it. The token is in this answer only.
#[utoipa::path(
  post,
  path = crate::constants::api::agents::ADMIN_COLLECTION,
  tag = "agents",
  security(("bearerAuth" = [])),
  request_body = CreateAgentRequest,
  responses(
    (status = 201, description = "Agent created", body = inline(HttpResponseFormat<AgentWithToken>)),
    (status = 403, description = "Only admins in the console", body = crate::http::ErrorBody),
    (status = 409, description = "You already have an agent with this name", body = crate::http::ErrorBody),
    (status = 422, description = "A value was refused", body = crate::http::ErrorBody),
  ),
)]
pub async fn create(
  State(state): State<AppState>,
  admin: ConsoleIdentity,
  Json(request): Json<CreateAgentRequest>,
) -> Result<HttpResponse<AgentWithToken>, AgentsError> {
  Ok(HttpResponse::created(
    service::create(
      &state,
      &admin.identity(),
      Owner::Admin(&admin.admin_id),
      request,
    )
    .await?,
    "AGENT_CREATED",
  ))
}

/// Show an agent
#[utoipa::path(
  get,
  path = crate::constants::api::agents::ADMIN_ITEM,
  tag = "agents",
  security(("bearerAuth" = [])),
  params(("id" = String, Path, description = "Agent ID with the agt_ prefix")),
  responses(
    (status = 200, description = "Agent fetched", body = inline(HttpResponseFormat<Agent>)),
    (status = 404, description = "No such agent", body = crate::http::ErrorBody),
  ),
)]
pub async fn get(
  State(state): State<AppState>,
  AdminIdentity(_actor): AdminIdentity,
  Path(id): Path<String>,
) -> Result<HttpResponse<Agent>, AgentsError> {
  Ok(HttpResponse::ok(
    service::find(&state, &id).await?.to_agent(),
    "AGENT_FETCHED",
  ))
}

/// Update an agent you own
#[utoipa::path(
  patch,
  path = crate::constants::api::agents::ADMIN_ITEM,
  tag = "agents",
  security(("bearerAuth" = [])),
  params(("id" = String, Path, description = "Agent ID with the agt_ prefix")),
  request_body = UpdateAgentRequest,
  responses(
    (status = 200, description = "Agent updated", body = inline(HttpResponseFormat<Agent>)),
    (status = 403, description = "Only the owner edits an agent", body = crate::http::ErrorBody),
    (status = 404, description = "No such agent", body = crate::http::ErrorBody),
    (status = 422, description = "A value was refused", body = crate::http::ErrorBody),
  ),
)]
pub async fn update(
  State(state): State<AppState>,
  admin: ConsoleIdentity,
  Path(id): Path<String>,
  Json(request): Json<UpdateAgentRequest>,
) -> Result<HttpResponse<Agent>, AgentsError> {
  let actor = admin.identity();
  let row = service::find(&state, &id).await?;
  service::require_owner(&actor, &row)?;
  Ok(HttpResponse::ok(
    service::update(&state, &actor, &row, request).await?,
    "AGENT_UPDATED",
  ))
}

/// Delete an agent
///
/// Any admin in the console can delete any agent.
#[utoipa::path(
  delete,
  path = crate::constants::api::agents::ADMIN_ITEM,
  tag = "agents",
  security(("bearerAuth" = [])),
  params(("id" = String, Path, description = "Agent ID with the agt_ prefix")),
  responses(
    (status = 204, description = "Agent deleted"),
    (status = 403, description = "Only admins in the console", body = crate::http::ErrorBody),
    (status = 404, description = "No such agent", body = crate::http::ErrorBody),
  ),
)]
pub async fn delete(
  State(state): State<AppState>,
  admin: ConsoleIdentity,
  Path(id): Path<String>,
) -> Result<Response, AgentsError> {
  let row = service::find(&state, &id).await?;
  service::delete(&state, &admin.identity(), &row).await?;
  Ok(StatusCode::NO_CONTENT.into_response())
}

/// Regenerate the token of an agent you own
#[utoipa::path(
  post,
  path = crate::constants::api::agents::ADMIN_REGENERATE,
  tag = "agents",
  security(("bearerAuth" = [])),
  params(("id" = String, Path, description = "Agent ID with the agt_ prefix")),
  responses(
    (status = 200, description = "Token regenerated", body = inline(HttpResponseFormat<AgentWithToken>)),
    (status = 403, description = "Only the owner regenerates the token", body = crate::http::ErrorBody),
    (status = 404, description = "No such agent", body = crate::http::ErrorBody),
  ),
)]
pub async fn regenerate(
  State(state): State<AppState>,
  admin: ConsoleIdentity,
  Path(id): Path<String>,
) -> Result<HttpResponse<AgentWithToken>, AgentsError> {
  let actor = admin.identity();
  let row = service::find(&state, &id).await?;
  service::require_owner(&actor, &row)?;
  Ok(HttpResponse::ok(
    service::regenerate(&state, &actor, &row).await?,
    "AGENT_TOKEN_REGENERATED",
  ))
}

/// Turn off an agent
///
/// Any admin in the console can turn off any agent. Its next token trade
/// answers `403 AGENT_DISABLED`.
#[utoipa::path(
  post,
  path = crate::constants::api::agents::ADMIN_DISABLE,
  tag = "agents",
  security(("bearerAuth" = [])),
  params(("id" = String, Path, description = "Agent ID with the agt_ prefix")),
  responses(
    (status = 200, description = "Agent turned off", body = inline(HttpResponseFormat<Agent>)),
    (status = 403, description = "Only admins in the console", body = crate::http::ErrorBody),
    (status = 404, description = "No such agent", body = crate::http::ErrorBody),
  ),
)]
pub async fn disable(
  State(state): State<AppState>,
  admin: ConsoleIdentity,
  Path(id): Path<String>,
) -> Result<HttpResponse<Agent>, AgentsError> {
  let row = service::find(&state, &id).await?;
  Ok(HttpResponse::ok(
    service::set_status(&state, &admin.identity(), &row, UserStatus::Disabled).await?,
    "AGENT_DISABLED",
  ))
}

/// Turn an agent back on
#[utoipa::path(
  post,
  path = crate::constants::api::agents::ADMIN_ENABLE,
  tag = "agents",
  security(("bearerAuth" = [])),
  params(("id" = String, Path, description = "Agent ID with the agt_ prefix")),
  responses(
    (status = 200, description = "Agent turned on", body = inline(HttpResponseFormat<Agent>)),
    (status = 403, description = "Only admins in the console", body = crate::http::ErrorBody),
    (status = 404, description = "No such agent", body = crate::http::ErrorBody),
  ),
)]
pub async fn enable(
  State(state): State<AppState>,
  admin: ConsoleIdentity,
  Path(id): Path<String>,
) -> Result<HttpResponse<Agent>, AgentsError> {
  let row = service::find(&state, &id).await?;
  Ok(HttpResponse::ok(
    service::set_status(&state, &admin.identity(), &row, UserStatus::Active).await?,
    "AGENT_ENABLED",
  ))
}
