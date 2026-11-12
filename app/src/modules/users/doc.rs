use super::{controller, model::*};
use crate::{
  http::{ErrorBody, HttpResponseFormat},
  models::{User, UserStatus},
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
    controller::revoke_sessions,
    controller::sessions,
    controller::disable,
    controller::enable,
    controller::password_reset
  ),
  components(schemas(
    AdminUser,
    UserPage,
    CreateUserRequest,
    UpdateUserRequest,
    User,
    UserStatus,
    ErrorBody,
    HttpResponseFormat<UserPage>,
    HttpResponseFormat<AdminUser>,
    HttpResponseFormat<serde_json::Value>,
    HttpResponseFormat<Vec<crate::modules::sessions::model::SessionResponse>>
  )),
  tags((name = "users", description = "Admin: manage your app's users. Root, admins, and the service key."))
)]
struct UsersApi;

pub fn build() -> utoipa::openapi::OpenApi {
  UsersApi::openapi()
}
