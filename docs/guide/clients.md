---
title: "Clients"
description: "Register each app that uses dopgate as a client, with a publishable key for the app and a secret key for its backend."
---

# Clients

::: warning Planned
Clients arrive in phase 5. Until then, the `X-Dopgate-Client` header is read but not checked.
:::

A client is an app that uses your dopgate instance: a website, a mobile app, a desktop app. Register each one to get two keys.

| Key | Prefix | Where it goes |
| --- | --- | --- |
| Publishable key | `pk_` | In your app. Send it in the `X-Dopgate-Client` header on sign-up and sign-in calls. It is not a secret. |
| Secret key | `sk_` | In your backend only. It calls the admin API, for example to create users or read the audit log. dopgate shows it once and keeps only a hash. |

## Redirect URLs

Verification links, password reset links, and single sign-on all end by sending the user's browser back to your app. dopgate only sends them to URLs on the client's `redirectUrls` list, so a stolen link cannot deliver a token to someone else's site.

## Allowed origins

A browser app calls dopgate from its own origin, such as `https://app.example.com`. Add that origin to `allowedOrigins` and dopgate answers its CORS preflight. Calls from other origins are refused by the browser.

## Tokens and clients

When a sign-in carries a publishable key, the access token's `aud` claim is the client ID. A backend that serves one app can then refuse tokens issued to another.
