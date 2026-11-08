---
layout: home
title: "dopgate: authentication you host yourself"
titleTemplate: false
description: dopgate is a self-hosted authentication server. One binary and one SQLite file handle sign-up, sign-in, email verification, password resets, and JWTs for your apps.

hero:
  name: "dopgate"
  text: "Authentication you host yourself"
  tagline: Sign users up and in, verify their email, reset passwords, and hand your apps JWTs they can check offline. One binary, one SQLite file.
  actions:
    - theme: brand
      text: Get started
      link: /guide/quick-start
    - theme: alt
      text: What works today
      link: /guide/product-status

features:
  - title: One binary
    details: The server, REST API, Swagger docs, and database migrations ship in a single executable.
  - title: SQLite storage
    details: Accounts, sessions, and the audit log live in one file you can back up and move.
  - title: JWTs with a public key set
    details: Your backend verifies access tokens against /.well-known/jwks.json without calling dopgate.
  - title: Codes and links
    details: Verify email or sign in without a password, with a typed code or a clicked link.
  - title: Single sign-on
    details: Let users sign in with Google, Microsoft, Okta, or any OpenID Connect provider.
  - title: Tamper-evident audit log
    details: Every record is hash-chained to the one before it, so edits and deletions show up.
---

<div class="dopgate-home">
  <div class="dopgate-path" aria-label="dopgate workflow">
    <div><strong>01 / Run</strong><span>Start the binary and create the root account.</span></div>
    <div><strong>02 / Register</strong><span>Add your app as a client.</span></div>
    <div><strong>03 / Sign in</strong><span>Users sign up and in through the API.</span></div>
    <div><strong>04 / Verify</strong><span>Your backend checks the JWT.</span></div>
  </div>
</div>
