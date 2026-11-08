---
title: "Principles"
description: "The choices behind dopgate and the limits it keeps."
---

# Principles

## One binary, one file

Running dopgate should take a download and a command. The server, migrations, and API docs ship in the binary, and the state is one SQLite file. Backups are file copies, and moving a server is moving a folder.

## Small on purpose

dopgate covers what most apps need from authentication and stops there. Organizations, fine-grained permissions, and billing belong in your app. Adding a feature means someone has to secure and maintain it, so each one has to earn its place.

## Your backend should not depend on it per request

Access tokens are JWTs your backend verifies with cached public keys. If dopgate is down for a minute, signed-in users keep working until their access token expires.

## Secrets never sit in the clear

Passwords and tokens are stored only as hashes. Values dopgate must read back, such as signing keys and the SMTP password, are encrypted with a master key that lives outside the database.

## Honest docs

Every endpoint is documented from the day it exists, including the ones that are not built yet, which answer `501` and say so. [Product status](/guide/product-status) is the single place that says what works.
