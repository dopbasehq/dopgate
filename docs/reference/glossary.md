---
title: "Glossary"
description: "Terms used in the dopgate documentation."
---

# Glossary

| Term | Meaning |
| --- | --- |
| Access token | A signed JWT that proves who the user is. Lives 15 minutes. |
| Client | An app registered with dopgate. Has a publishable key and a secret key. |
| Data directory | The folder with the database, master key, and `server.toml`. `~/.dopgate` by default. |
| Handoff code | A one-minute, single-use code that carries a single sign-on result from dopgate's callback to your app. |
| JWKS | JSON Web Key Set. The public keys at `/.well-known/jwks.json` that verify access tokens. |
| Master key | 32 random bytes in `master.key` that encrypt signing keys and stored secrets. |
| Member | The role of an end user of your apps. |
| OTP | One-time password. Here, a 6-digit code sent by email. |
| Publishable key | A client's `pk_` key. Safe to ship in an app. |
| Refresh token | A single-use `dgr_` token that gets a new access token. |
| Root | The instance owner. The one account nobody else can change. |
| Secret key | A client's `sk_` key. Calls the admin API from a backend; never ship it in an app. |
| Session | One signed-in device. Ends on sign-out, after 30 idle days, or 90 days after sign-in. |
| Setup token | A one-time `setup_` token printed at startup while no root account exists. |
