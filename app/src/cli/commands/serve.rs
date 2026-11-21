use anyhow::Result;

use super::{instance_overrides, load_config};
use crate::cli::ServeArgs;

pub async fn run(args: ServeArgs) -> Result<i32> {
  let mut overrides = instance_overrides(args.instance);
  overrides.port = args.port;
  overrides.host = args.host;
  overrides.public_url = args.public_url;
  overrides.docs = args.docs;
  overrides.web_ui = args.web_ui;
  let config = load_config(&overrides)?;
  crate::server::serve(config).await?;
  Ok(0)
}
