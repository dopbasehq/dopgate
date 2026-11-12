---
title: "Errors"
description: "The shape of Dopgate error responses and every error code, with its HTTP status and when it happens."
---

# Errors

Every error answers with JSON in the same shape:

```json
{
  "success": false,
  "error": {
    "CODE_INVALID": "That code is wrong. 4 tries left."
  }
}
```

`error` maps one code to a message. Branch on the code; the message is plain English you can show to a user, and its wording may change. Answers with status `429` also carry a `Retry-After` header in seconds.

Errors that come from the HTTP layer itself, such as malformed JSON, a missing field, an unknown route, or a request that took longer than 30 seconds, use the same shape with `REQUEST_INVALID`, or `INTERNAL_ERROR` for `5xx`. Request bodies are limited to 3 MB.

## Codes

| Code | Status | When |
| --- | --- | --- |
| `ACCOUNT_DISABLED` | 403 | The account is disabled: at sign-in after the right password, at refresh, at code confirmation, at password reset, when its personal token is traded, or when its access token is used on Dopgate. |
| `AGENT_DISABLED` | 403 | An agent token was traded while the agent, or its owner, is turned off. |
| `AGENT_NAME_TAKEN` | 409 | The owner already has an agent with this name. |
| `ALREADY_INITIALIZED` | 409 | `POST /bootstrap/root` on an instance that already has root. |
| `AUTHENTICATION_INVALID` | 401 | Wrong email or password, a locked account, a wrong current password, an `Authorization` header that isn't `Bearer <token>`, or a bearer token that is neither a JWT nor the service key. |
| `AUTHENTICATION_REQUIRED` | 401 | No `Authorization` header, or `POST /auth/logout` with neither an access token nor a refresh token. |
| `AUTHORIZATION_DENIED` | 403 | The caller can't do this: an agent token on any Dopgate endpoint, an admin editing or regenerating an agent they don't own, a user on the admin API, an admin token on a user endpoint or a user token on a console endpoint, anyone but root managing admins or rotating keys, an access token traded from a personal token on an endpoint that needs a password or code sign-in, or the service key on an endpoint for a signed-in account. |
| `CAPABILITIES_INVALID` | 422 | An agent's capabilities aren't a flat object of strings, numbers, true or false, and lists of strings, or are over 4 KB. |
| `CODE_EXPIRED` | 400 | The emailed code is past its lifetime. |
| `CODE_INVALID` | 400 | The code is wrong, used up after too many wrong tries, or there is no code for this email and purpose. |
| `EMAIL_INVALID` | 422 | The email isn't valid, an email change names the current address, or the service key sends an SMTP test without `to`. `400` when the service key asks for an email template test, which it has no address for. |
| `EMAIL_NOT_VERIFIED` | 403 | Sign-in with the right password while the email is unconfirmed and settings require it. |
| `EMAIL_TAKEN` | 409 | Another account already uses this email. |
| `FEATURE_DISABLED` | 403 | A user tried to make a personal token while `selfService.personalTokens` is off, or to make, edit, or regenerate an agent while `selfService.agents` is off. |
| `INTERNAL_ERROR` | 500 | Something failed on the server, such as a database error. The log has the details. |
| `LIMIT_REACHED` | 409 | The user already has `selfService.maxPersonalTokensPerUser` personal tokens, or `selfService.maxAgentsPerUser` agents. |
| `METADATA_INVALID` | 422 | A metadata value isn't a JSON object, or is larger than 16 KB. |
| `NOT_FOUND` | 404 | No such user, admin, session, agent, personal token, or email template, or the signed-in account was deleted. |
| `NOT_IMPLEMENTED` | 501 | A planned endpoint: single sign-on or multi-factor authentication. |
| `PASSWORD_INVALID` | 422 | The new password is shorter than the minimum length or longer than 1024 bytes. |
| `PROFILE_INVALID` | 422 | The display name is longer than 255 characters or has a line break, or the avatar URL isn't an `http(s)` URL of at most 2048 characters. |
| `RATE_LIMITED` | 429 | Too many requests from this address, too many codes for this email, or too many wrong setup tokens. |
| `REQUEST_INVALID` | 400, 404, 422, and others | A malformed request: bad JSON, a missing field, an invalid pagination cursor, an incomplete audit anchor, a code purpose the endpoint doesn't take (`422`), a personal token name or expiry out of range (`422`), or an unknown API route (`404`). |
| `ROOT_PROTECTED` | 403 | An attempt to update, disable, enable, or delete root through `/admin/admins`. |
| `SETTINGS_INVALID` | 422 | A settings value is out of range, the request tried to change SMTP while `DOPGATE_SMTP_HOST` is set, or it saved an SMTP password without `DOPGATE_SERVICE_KEY`. |
| `SETUP_TOKEN_INVALID` | 401 | The setup token for `POST /bootstrap/root` is wrong. |
| `SIGNUP_DISABLED` | 403 | Sign-up is turned off in settings. |
| `SMTP_NOT_CONFIGURED` | 400 | An SMTP test while no SMTP host is set. |
| `SMTP_PASSWORD_UNREADABLE` | 400 | An SMTP test or an email template test needs the SMTP password saved in the console, and it can't be decrypted because `DOPGATE_SERVICE_KEY` changed or was removed. |
| `SMTP_SEND_FAILED` | 502 | The SMTP server refused an SMTP test or an email template test, or couldn't be reached. |
| `TEMPLATE_INVALID` | 422 | An email template draft has an empty or too long subject, an empty or too large body, an unclosed placeholder, or an unknown variable. |
| `TOKEN_EXPIRED` | 401 | A personal token traded at `/auth/token` is past its expiry. |
| `TOKEN_INVALID` | 401 | The access token is invalid, expired, signed by an unknown key, or its session or personal token ended; the refresh token is unknown, used, expired, or its session ended; or the token traded at `/auth/token` is wrong or deleted. |
| `TOKEN_NAME_TAKEN` | 409 | The user already has a personal token with this name. |

## CLI errors

The CLI uses two more codes in `--json` mode: `CLI_ERROR` for any failure and `CLI_CANCELLED` when you cancel a prompt. See [the CLI overview](/cli/#json-output).
