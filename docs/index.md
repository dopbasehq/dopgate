---
layout: home
title: "Dopgate: authentication you host yourself"
titleTemplate: false
description: Dopgate is a self-hosted auth server for one app. It runs next to your app with PostgreSQL and handles sign-up, sign-in, email codes, password resets, and JWTs your backend verifies offline.
markdownStyles: false

hero:
  name: "Dopgate"
  text: "Authentication you host yourself"
  tagline: Sign users up and in, confirm their email with a 6-digit code, reset passwords, and hand your backend JWTs it can check without calling back. One container next to your app, with its tables in a PostgreSQL schema.
  image:
    src: /logo.svg
    alt: The Dopgate logo
  actions:
    - theme: brand
      text: Get started
      link: /guide/quick-start
    - theme: alt
      text: What works today
      link: /guide/product-status

features:
  - title: Runs next to your app
    details: One container in your compose stack. Its tables live in the <code>dopgate</code> schema, so it can share your app's database without touching your tables.
    link: /self-hosting/with-your-app
    linkText: Add it to your stack
  - title: JWTs your backend checks offline
    details: Access tokens are ES256. Verify them against <code>/.well-known/jwks.json</code> and use the <code>sub</code> claim as the user ID.
    link: /guide/add-to-your-app
    linkText: Verify a token
  - title: Email codes
    details: Verify an address, sign in without a password, reset a password, or change an email with a 6-digit code.
    link: /guide/sign-in
    linkText: Sign-in options
  - title: Personal tokens and agents
    details: Scripts sign in as their user with a personal token. Bots and AI agents get accounts of their own, with capabilities in their JWT.
    link: /guide/agents
    linkText: Read about agents
  - title: Admin console built in
    details: Root and admins manage users, agents, email templates, settings, signing keys, and the audit log at the server's root URL.
    link: /guide/admin-console
    linkText: Tour the console
  - title: Tamper-evident audit log
    details: Every record is hash-chained to the one before it, so edits and deletions show up when you verify the chain.
    link: /reference/audit-events
    linkText: See the events
---

<section class="dg-steps" aria-labelledby="dg-steps-title">
  <div class="dg-steps-inner">
    <div class="dg-steps-head">
      <h2 id="dg-steps-title">From an empty database to a verified token</h2>
      <a class="dg-steps-link" href="/guide/quick-start">Follow the quick start</a>
    </div>
    <ol class="dg-steps-list">
      <li><span class="dg-steps-num">01</span><strong>Run it</strong><span>Start PostgreSQL and Dopgate with <code>docker compose up</code>.</span></li>
      <li><span class="dg-steps-num">02</span><strong>Sign in to the console</strong><span>Open the server's root URL and sign in as root with the password from the log.</span></li>
      <li><span class="dg-steps-num">03</span><strong>Connect your frontend</strong><span>Call sign-up, sign-in, and refresh from your app.</span></li>
      <li><span class="dg-steps-num">04</span><strong>Verify on your backend</strong><span>Check the JWT against the key set and read <code>sub</code>.</span></li>
    </ol>
  </div>
</section>
