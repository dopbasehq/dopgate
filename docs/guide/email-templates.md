---
title: "Email templates"
description: "The six emails Dopgate sends, the variables each accepts, and how to customize, preview, test, and reset them."
---

# Email templates

Dopgate sends six emails. Each has a built-in version that works without setup, and admins can replace the subject, the HTML, and the plain text of any of them from the console's **Email templates** page or the API.

| Name | Sent when | Variables |
| --- | --- | --- |
| `verify_email` | After sign-up, and when a user asks to confirm their email | `app_name`, `email`, `display_name`, `code`, `expires_minutes` |
| `login_code` | A user signs in with an emailed code | `app_name`, `email`, `display_name`, `code`, `expires_minutes` |
| `password_reset` | A user forgets their password, or an admin sends a reset | `app_name`, `email`, `display_name`, `code`, `expires_minutes` |
| `email_change` | A user changes their email; goes to the new address | `app_name`, `email`, `display_name`, `code`, `expires_minutes`, `new_email` |
| `email_changed` | An email change went through; goes to the old address | `app_name`, `email`, `display_name`, `new_email` |
| `password_changed` | A password was changed or reset | `app_name`, `email`, `display_name` |

Admins get the same emails from the console: `login_code` when they sign in with a code, `password_reset`, `email_change`, `email_changed`, and `password_changed`. [Email template variables](/reference/email-template-variables) says what each variable holds.

## Writing a template

Placeholders look like <code v-pre>{{code}}</code>. Spaces inside the braces are fine, as in <code v-pre>{{ code }}</code>. Templates have no conditions or loops: each placeholder is replaced by its value, and a variable with no value, such as `display_name` for a user without a name, becomes an empty string.

In the HTML part, values are HTML-escaped, so a display name like `<b>Ana</b>` shows up as text. The subject and the text part get values as they are. Line breaks and other control characters in the subject become spaces.

A template is refused with `422 TEMPLATE_INVALID` when:

- the subject is empty or longer than 255 characters,
- the HTML or the text is empty, or larger than 100 KB,
- a <code v-pre>{{</code> is never closed,
- a placeholder is not one of the template's variables.

The app name in every email comes from `branding.appName` in settings, `Dopgate` by default.

## From the API

All template endpoints need an admin, root, or the service key.

```bash
# List the six templates and whether each is customized
curl https://auth.example.com/api/v1/admin/email-templates \
  -H "authorization: Bearer $TOKEN"

# Read one: the version in use, the built-in version, and its variables
curl https://auth.example.com/api/v1/admin/email-templates/login_code \
  -H "authorization: Bearer $TOKEN"
```

Save an override with `PUT` and all three parts:

```bash
curl -X PUT https://auth.example.com/api/v1/admin/email-templates/login_code \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d @login_code.json
```

where `login_code.json` holds:

```json
{
  "subject": "{{code}} is your Acme sign-in code",
  "html": "<p>Hi {{display_name}},</p><p>Your code is <strong>{{code}}</strong>. It works for {{expires_minutes}} minutes.</p>",
  "text": "Hi {{display_name}},\n\nYour code is {{code}}. It works for {{expires_minutes}} minutes.\n"
}
```

| Call | What it does |
| --- | --- |
| `POST /api/v1/admin/email-templates/{name}/preview` | Render a draft with sample values. Nothing is saved or sent. |
| `POST /api/v1/admin/email-templates/{name}/test` | Render a draft with sample values and send it to the signed-in admin's email. |
| `DELETE /api/v1/admin/email-templates/{name}` | Remove the override and go back to the built-in version. |

Preview and test take the same body as `PUT`. The sample values are the app name, the admin's email (`person@example.com` for the service key), `Alex`, the code `482913`, the current code lifetime, and `new.address@example.com`. The service key can't send a test, because it has no email of its own (`400 EMAIL_INVALID`). A test the SMTP server refuses answers `502 SMTP_SEND_FAILED`. An unknown template name answers `404 NOT_FOUND`.

Saving and resetting are recorded in the audit log as `email_template.updated` and `email_template.reset`.

## How emails go out

Dopgate sends emails in the background, so an API answer never waits for the SMTP server and takes the same time whether or not an email went out. A failed send is written to the server log. Without an SMTP server, every email is written to the log instead. See [Email (SMTP)](/self-hosting/smtp).
