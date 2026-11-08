---
title: "Email verification"
description: "Verify email addresses and sign users in without a password, with a one-time code or a link."
---

# Email verification

::: warning Planned
Email verification arrives in phase 3, together with SMTP settings.
:::

dopgate proves a user owns an email address by sending them something only that inbox receives. Your app picks one of two methods per request:

| Method | The user gets | Good for |
| --- | --- | --- |
| `otp` | A 6-digit code to type into your app | Mobile apps, and flows where the user stays on one screen |
| `link` | A link that opens your app | Web apps, and users who read mail on another device than they sign in on |

The same mechanism serves three purposes:

| Purpose | What confirming it does |
| --- | --- |
| `email_verify` | Marks the account's email as verified |
| `login` | Signs the user in without a password, and creates a member account when settings allow it |
| `email_change` | Moves the account to the new address |

## Flow

1. Your app calls `POST /api/v1/auth/verification/send` with `email`, `purpose`, `method`, and for links a `redirectUrl` from the client's list.
2. dopgate emails the code or link. The response is the same whether or not the address has an account.
3. The user types the code, or follows the link to your app, which reads the `token` from the URL.
4. Your app calls `POST /api/v1/auth/verification/confirm`. For `login`, the response carries tokens.

## Limits

A code or link is valid for 10 minutes and works once. Sending again replaces the earlier one. Five wrong codes burn it. dopgate also limits how many messages one address and one email can trigger.

Only a hash of each code and link is stored, so a copy of the database does not reveal them.
