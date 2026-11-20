---
layout: home
title: "Dopgate: modern auth for people and AI agents"
titleTemplate: false
description: Dopgate is an auth server for apps with users and AI agents. Agents get their own account, an owner, and signed permissions, and your backend verifies every token offline.
markdownStyles: false

hero:
  name: "Dopgate"
  text: "Modern auth for people and AI agents"
  tagline: Sign your users in with a password or an emailed code. Give every AI agent an account of its own, with an owner and permissions signed into its token. Dopgate runs in your infrastructure.
  image:
    src: /logo.svg
    alt: The Dopgate logo
  actions:
    - theme: brand
      text: Get started
      link: /guide/quick-start
    - theme: alt
      text: How agents sign in
      link: /ai-agents/

features:
  - title: First-class AI agents
    details: Every agent has its own account, an owner, and capabilities signed into its token. Your backend reads <code>kind</code> to tell a person from an agent.
    link: /ai-agents/
    linkText: Auth for AI agents
  - title: Tamper-evident audit log
    details: Every record is hash-chained to the one before it, so edits and deletions show up when you verify the chain.
    link: /reference/audit-events
    linkText: See the events
  - title: Secure by default
    details: ES256 access tokens, Argon2id password hashes, and tokens and codes stored only as hashes. A reused refresh token ends the session, and rate limits and lockout are built in.
    link: /reference/security
    linkText: Read the security model
  - title: Tested, and clear about status
    details: Backend tests and end-to-end suites cover the CLI, the API, and the console. One page lists what works today and what is still planned.
    link: /guide/product-status
    linkText: What works today
  - title: Your data stays yours
    details: Dopgate runs in your infrastructure and keeps every table in your own PostgreSQL. Your backend checks tokens against cached public keys and never calls back per request.
    link: /self-hosting/with-your-app
    linkText: Run it with your app
  - title: Sign-in for people
    details: Passwords, emailed 6-digit codes, password reset, and sessions with single-use refresh tokens. Personal tokens let a user sign in from a script.
    link: /guide/sign-in
    linkText: How sign-in works
  - title: Admin console built in
    details: Manage users, agents, admins, email templates, settings, and signing keys from a console that ships inside the binary.
    link: /guide/admin-console
    linkText: Open the console guide
  - title: Light on your server
    details: Dopgate holds 14 MiB of memory at rest. On two Apple M3 Pro cores shared with PostgreSQL it trades 5,803 agent tokens a second. The script that measured it is in the repository.
    link: /reference/benchmarks
    linkText: See the benchmarks
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
      <li><span class="dg-steps-num">03</span><strong>Connect your app</strong><span>Call sign-up, sign-in, and refresh from your frontend, and give an agent its token.</span></li>
      <li><span class="dg-steps-num">04</span><strong>Verify on your backend</strong><span>Check the JWT against the key set, then read <code>sub</code> and <code>kind</code>.</span></li>
    </ol>
  </div>
</section>
