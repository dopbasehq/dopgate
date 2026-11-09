---
title: "Email template variables"
description: "Every placeholder Dopgate's six email templates accept, what it holds, and which templates accept it."
---

# Email template variables

Write a variable as its name in double braces, such as <code v-pre>{{code}}</code>. A template may only use the variables listed for it; anything else is refused with `422 TEMPLATE_INVALID`. See [Email templates](/guide/email-templates) for how to edit them.

## Variables

| Variable | Holds | Preview and test value |
| --- | --- | --- |
| `app_name` | `branding.appName` from settings, `dopgate` by default | The current app name |
| `email` | The account's current email. For `email_change`, the address before the change. | The admin's email, or `person@example.com` for the service key |
| `display_name` | The account's display name, or an empty string | `Alex` |
| `code` | The 6-digit code | `482913` |
| `expires_minutes` | Minutes until the code expires, from `limits.codeMinutes` | The current setting |
| `new_email` | The new address in an email change | `new.address@example.com` |

## Which template accepts which

| Template | `app_name` | `email` | `display_name` | `code` | `expires_minutes` | `new_email` |
| --- | --- | --- | --- | --- | --- | --- |
| `verify_email` | yes | yes | yes | yes | yes | |
| `login_code` | yes | yes | yes | yes | yes | |
| `password_reset` | yes | yes | yes | yes | yes | |
| `email_change` | yes | yes | yes | yes | yes | yes |
| `email_changed` | yes | yes | yes | | | yes |
| `password_changed` | yes | yes | yes | | | |

## Escaping

In the HTML part every value is HTML-escaped: `&`, `<`, `>`, `"`, and `'` become entities. The subject and the plain text part get values unchanged, and control characters in the rendered subject become spaces. A placeholder with no value renders as an empty string.

## Where each email goes

| Template | Recipient |
| --- | --- |
| `verify_email`, `login_code`, `password_reset`, `password_changed` | The account's email |
| `email_change` | The new address |
| `email_changed` | The old address |
