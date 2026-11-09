use super::{controller, model::*};
use crate::{
  http::{ErrorBody, HttpResponseFormat},
  models::{Admin, Role, UserStatus},
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
    controller::disable,
    controller::enable
  ),
  components(schemas(
    Admin,
    AdminList,
    CreateAdminRequest,
    UpdateAdminRequest,
    Role,
    UserStatus,
    ErrorBody,
    HttpResponseFormat<AdminList>,
    HttpResponseFormat<Admin>
  )),
  tags((name = "admins", description = "Admin: root and the admins who run Dopgate. Root manages them."))
)]
struct AdminsApi;

pub fn build() -> utoipa::openapi::OpenApi {
  AdminsApi::openapi()
}
