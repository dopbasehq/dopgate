// Owns `sso_providers`, `user_identities`, and `sso_flows`. The relying
// party code in services/oidc.rs already handles discovery, PKCE, and ID
// token checks. Arrives with single sign-on (phase 6).
