use super::{controller, model::*};
use crate::{
  http::{ErrorBody, HttpResponseFormat},
  models::{Role, User, UserStatus},
};
use utoipa::OpenApi;

#[derive(OpenApi)]
#[openapi(
  paths(
    controller::list,
    controller::get,
    controller::create,
    controller::update,
    controller::delete,
    controller::revoke_sessions
  ),
  components(schemas(
    AdminUser,
    UserPage,
    CreateUserRequest,
    UpdateUserRequest,
    User,
    Role,
    UserStatus,
    ErrorBody,
    HttpResponseFormat<UserPage>,
    HttpResponseFormat<AdminUser>,
    HttpResponseFormat<serde_json::Value>
  )),
  tags((name = "users", description = "Admin: manage accounts"))
)]
struct UsersApi;

pub fn build() -> utoipa::openapi::OpenApi {
  UsersApi::openapi()
}
