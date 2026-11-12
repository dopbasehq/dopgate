use super::{controller, model::*};
use crate::{
  http::{ErrorBody, HttpResponseFormat},
  models::UserStatus,
};
use utoipa::OpenApi;

#[derive(OpenApi)]
#[openapi(
  paths(
    controller::list_own,
    controller::create_own,
    controller::get_own,
    controller::update_own,
    controller::delete_own,
    controller::regenerate_own,
    controller::disable_own,
    controller::enable_own,
    controller::list,
    controller::create,
    controller::get,
    controller::update,
    controller::delete,
    controller::regenerate,
    controller::disable,
    controller::enable
  ),
  components(schemas(
    Agent,
    AgentOwner,
    OwnerKind,
    AgentPage,
    AgentWithToken,
    CreateAgentRequest,
    UpdateAgentRequest,
    UserStatus,
    ErrorBody,
    HttpResponseFormat<Agent>,
    HttpResponseFormat<AgentPage>,
    HttpResponseFormat<AgentWithToken>
  )),
  tags((name = "agents", description = "Agents: accounts for bots, each owned by an admin or a user, that sign in with one token and carry capabilities."))
)]
struct AgentsApi;

pub fn build() -> utoipa::openapi::OpenApi {
  AgentsApi::openapi()
}
