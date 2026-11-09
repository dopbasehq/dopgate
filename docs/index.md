---
layout: home
title: "Dopgate: authentication you host yourself"
titleTemplate: false
description: Dopgate is a self-hosted auth server for one app. It runs next to your app with PostgreSQL and handles sign-up, sign-in, email codes, password resets, and JWTs your backend verifies offline.

hero:
  name: "Dopgate"
  text: "Authentication you host yourself"
  tagline: Sign users up and in, confirm their email with a 6-digit code, reset passwords, and hand your backend JWTs it can check without calling back. One container next to your app, with its tables in a PostgreSQL schema.
  actions:
    - theme: brand
      text: Get started
      link: /guide/quick-start
    - theme: alt
      text: What works today
      link: /guide/product-status

features:
  - title: Runs with your app
    details: One container in the same compose stack as your app. PostgreSQL and Dopgate are the whole setup.
  - title: Its own schema
    details: Every table lives in the `dopgate` schema, so it can share your app's database without touching your tables.
  - title: JWTs with a public key set
    details: Your backend verifies ES256 access tokens against /.well-known/jwks.json and uses the sub claim as the user ID.
  - title: Email codes
    details: Verify an address, sign in without a password, reset a password, or change an email with a 6-digit code.
  - title: Admin console built in
    details: Root and admins manage users, email templates, settings, signing keys, and the audit log at the server's root URL.
  - title: Tamper-evident audit log
    details: Every record is hash-chained to the one before it, so edits and deletions show up when you verify the chain.
---

<div class="dopgate-home">
  <div class="dopgate-path" aria-label="Dopgate workflow">
    <div><strong>01 / Run</strong><span>Start PostgreSQL and Dopgate with docker compose.</span></div>
    <div><strong>02 / Sign in</strong><span>Open the console with the root password from the log.</span></div>
    <div><strong>03 / Connect</strong><span>Your frontend calls sign-up, sign-in, and refresh.</span></div>
    <div><strong>04 / Verify</strong><span>Your backend checks the JWT and reads <code>sub</code>.</span></div>
  </div>
</div>
