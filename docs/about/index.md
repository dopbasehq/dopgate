---
title: "Principles"
description: "The choices behind Dopgate and the limits it keeps."
---

# Principles

## One app, one Dopgate

Dopgate serves a single app. It runs as its own container next to that app, usually in the same Compose stack, and keeps its data in a PostgreSQL schema of its own. A second app gets a second Dopgate. That keeps the model small: one set of users, one set of settings, one key set.

## Use the database you already run

Your app most likely has PostgreSQL already. Dopgate puts every table in the `dopgate` schema, so it can live in the same database without touching your tables, and you back it up and restore it with the tools you already use.

## Small on purpose

Dopgate covers what most apps need from authentication and stops there. Organizations, fine-grained permissions, and billing belong in your app, keyed by the user ID. Every feature has to be secured and maintained, so each one has to earn its place.

## Your backend should not depend on it per request

Access tokens are JWTs your backend verifies with cached public keys. If Dopgate is down for a minute, signed-in users keep working until their access token expires. The cost is a short window, up to the access token lifetime, where an ended session's last token still verifies.

## Hash what can be hashed

Passwords are stored as Argon2id hashes, and refresh tokens, emailed codes, personal tokens, and agent tokens as SHA-256 hashes. The signing key has to be read back to sign tokens, so it sits in the `dopgate` schema. Guard that schema like a secret. The [security checklist](/self-hosting/security-checklist) shows how.

## Honest docs

Single sign-on and multi-factor authentication aren't built yet. Their routes already exist and answer `501` with a message that says so, and they stay out of the API docs at `/api/docs` until they work. [Product status](/guide/product-status) is the one place that says what works.
