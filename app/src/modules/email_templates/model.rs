use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// A template in the list.
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TemplateSummary {
  pub name: String,
  pub description: String,
  /// True while an admin override replaces the built-in version.
  pub customized: bool,
  pub subject: String,
  pub updated_at: Option<DateTime<Utc>>,
}

/// The built-in subject, HTML, and text.
#[derive(Serialize, ToSchema, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TemplateContent {
  pub subject: String,
  pub html: String,
  pub text: String,
}

/// One template, with the version in use and the built-in one.
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TemplateDetail {
  pub name: String,
  pub description: String,
  pub customized: bool,
  pub subject: String,
  pub html: String,
  pub text: String,
  /// The placeholders this template accepts, such as `code`.
  pub variables: Vec<String>,
  pub updated_at: Option<DateTime<Utc>>,
  pub defaults: TemplateContent,
}

/// An override, or a draft to preview or test.
#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TemplateInput {
  pub subject: String,
  pub html: String,
  pub text: String,
}
