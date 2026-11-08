---
title: "Password reset"
description: "Let users reset a forgotten password with an emailed code or link."
---

# Password reset

::: warning Planned
Password reset arrives in phase 3, together with SMTP settings.
:::

1. Your app calls `POST /api/v1/auth/password/forgot` with the user's `email`, and optionally `method` (`link` by default, or `otp`) and a `redirectUrl`.
2. dopgate emails a code or a link. The response is the same whether or not an account uses the address, so the endpoint cannot be used to find out who has an account.
3. The user follows the link to your app, or types the code.
4. Your app calls `POST /api/v1/auth/password/reset` with the new password and either `token` from the link or `email` and `code`.

A reset ends every session of the account, so a device someone else signed in on is signed out too.

Signed-in users who know their password change it with `POST /api/v1/auth/password/change` instead.
