---
title: "Errors"
description: "The shape of dopgate error responses and every error code."
---

# Errors

Every error is JSON, with the HTTP status telling the class of problem and a code telling the exact one:

```json
{ "success": false, "error": { "PASSWORD_INVALID": "Use at least 8 characters." } }
```

`error` maps codes to messages. It usually holds one entry; validation errors can hold several. Branch on the code. The message is for people and may change.

Every response also carries an `x-request-id` header. Quote it when reporting a problem; the server log has the same ID.

## Codes

| Code | Status | Meaning |
| --- | --- | --- |
| `REQUEST_INVALID` | 400, 404, other 4xx | The request is malformed, such as bad JSON, or the route does not exist. |
| `EMAIL_INVALID` | 400 | The email is not a usable address. |
| `PASSWORD_INVALID` | 400 | The new password breaks the policy. |
| `SETTINGS_INVALID` | 400 | A settings value was refused. The message names the field. |
| `SMTP_NOT_CONFIGURED` | 400 | A test message needs an SMTP host first. |
| `AUTHENTICATION_REQUIRED` | 401 | No `Authorization` header. |
| `AUTHENTICATION_INVALID` | 401 | The header or token is malformed, wrong, or expired. |
| `SETUP_TOKEN_INVALID` | 401 | The setup token is wrong. |
| `AUTHORIZATION_DENIED` | 403 | The caller is signed in but their role does not allow this. |
| `ALREADY_INITIALIZED` | 409 | The root account already exists. |
| `RATE_LIMITED` | 429 | Too many attempts. The message says how long to wait. |
| `INTERNAL_ERROR` | 500 | Something failed on the server. The log has details. |
| `NOT_IMPLEMENTED` | 501 | The endpoint is planned and not built yet. |
| `SMTP_SEND_FAILED` | 502 | The SMTP server refused the message or could not be reached. The message carries its answer. |
| `INSTANCE_RESTORING` | 503 | A backup is being restored. Retry shortly. |

Features add their own codes as they land, and this table grows with them.
