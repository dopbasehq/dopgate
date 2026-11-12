use app::modules::sso::presets;

#[test]
fn bundled_presets_parse_and_include_generic() {
  let all = presets::all();
  for id in [
    "google",
    "microsoft",
    "okta",
    "auth0",
    "cognito",
    "clerk",
    "supabase",
    "keycloak",
    presets::GENERIC_PRESET,
  ] {
    assert!(presets::find(id).is_some(), "missing preset {id}");
  }
  assert_eq!(all.len(), 9);
  assert!(
    presets::all()
      .iter()
      .all(|preset| !preset.hint.contains("Dopbase"))
  );
}

#[test]
fn unknown_preset_falls_back_to_generic() {
  assert_eq!(
    presets::resolve("no-such-provider").id,
    presets::GENERIC_PRESET
  );
}

#[test]
fn parse_refuses_broken_catalogs() {
  let preset = |id: &str| {
    format!(
      "[[preset]]\nid = \"{id}\"\nlabel = \"L\"\nbutton_label = \"B\"\nissuer = \"https://i\"\nhint = \"H\"\n"
    )
  };
  let without_generic = preset("google");
  assert!(presets::parse(&without_generic).is_err());

  let duplicate = format!("{}{}", preset("generic"), preset("generic"));
  assert!(presets::parse(&duplicate).is_err());

  let bad_id = format!("{}{}", preset("generic"), preset("Not Valid"));
  assert!(presets::parse(&bad_id).is_err());

  assert!(presets::parse(&preset("generic")).is_ok());
}

#[test]
fn microsoft_refuses_multi_tenant_issuers() {
  let microsoft = presets::find("microsoft").unwrap();
  assert!(microsoft.rejects_issuer("https://login.microsoftonline.com/common/v2.0"));
  assert!(
    !microsoft.rejects_issuer(
      "https://login.microsoftonline.com/11111111-2222-3333-4444-555555555555/v2.0"
    )
  );
}
