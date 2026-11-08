---
title: "Single sign-on"
description: "Let users sign in to your apps through Google, Microsoft, Okta, or any OpenID Connect provider."
---

# Single sign-on

::: warning Planned
Single sign-on arrives in phase 6. The list of provider presets already works at `GET /api/v1/admin/sso/presets`.
:::

dopgate can send users to an OpenID Connect provider to sign in, then hand your app its own tokens. Your app only ever talks to dopgate.

dopgate ships presets with setup hints for Google, Microsoft Entra ID, Okta, Auth0, Amazon Cognito, Clerk, Supabase, and Keycloak, plus a generic preset for any other provider that supports OpenID Connect discovery. GitHub does not support OpenID Connect sign-in, so it needs a separate adapter, which is not planned yet.

## Setting up a provider

1. Create an OAuth client at the provider. Set its redirect URI to `https://<your dopgate>/api/v1/auth/sso/callback`.
2. Add the provider in dopgate with `POST /api/v1/admin/sso/providers`: the preset, the issuer URL, the client ID, and the client secret. The secret is stored encrypted with the master key.
3. Run a test sign-in. A provider can only be enabled after one succeeds.
4. Enable it.

## The sign-in flow

1. Your app sends the browser to `/api/v1/auth/sso/{provider_id}/start?redirectUrl=...&client=pk_...`.
2. The user signs in at the provider, which sends them back to dopgate's callback.
3. dopgate checks the ID token, then redirects to your `redirectUrl` with a one-minute handoff `code`.
4. Your app posts the code to `POST /api/v1/auth/sso/exchange` and gets tokens.

## Matching accounts

The first sign-in links the provider identity to an account: an existing account with the same verified email, or a new member account when the provider allows sign-up. After that, dopgate matches on the provider's subject ID only. If the user changes their email at the provider, they still land in the same dopgate account.
