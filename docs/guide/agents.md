---
title: "Agents"
description: "Give bots and AI agents their own accounts: owned by an admin or a user, signed in with one token, and carrying capabilities your backend reads from the access token."
---

# Agents

An agent is an account for a bot, a script with its own identity, or an AI agent. Every agent belongs to an owner, an admin or one of your users, and signs in only with its token. The owner gives it **capabilities**: flat key-value pairs that Dopgate puts in the agent's access token and your backend reads to decide what the agent may do.

Agents are separate from [personal tokens](/guide/personal-tokens). A personal token signs in as its user. An agent signs in as itself, with its own `agt_` ID, and its token says who owns it.

## Who makes agents

- **Admins** make agents on the console's **Agents** page or with `POST /api/v1/admin/agents`. The admin who made it owns it.
- **Users** make their own through your app with `POST /api/v1/auth/agents`, once an admin turns on `selfService.agents` (**Settings → Tokens and agents**). The same section caps how many agents one user may have, 10 by default.

The service key can list agents but can't make or change them.

```bash
curl -X POST https://auth.example.com/api/v1/auth/agents \
  -H "authorization: Bearer $USER_ACCESS_TOKEN" \
  -H 'content-type: application/json' \
  -d '{
    "name": "cursor",
    "description": "Opens pull requests",
    "capabilities": { "repo": "dopgate", "max_files": 20, "can_merge": false, "labels": ["bot"] }
  }'
```

The answer has the agent and its `token`, `dga_` and 43 characters. The token is in this answer only: Dopgate stores a SHA-256 hash and the last four characters. Each agent has one token. Regenerating it gives a new one and stops the old one at once.

## Names and capabilities

| Field | Rules |
| --- | --- |
| `name` | 1 to 64 lowercase letters, digits, and dashes, unique among the owner's agents |
| `description` | Optional, one line of up to 280 characters. Shown in the console only, never in the token. |
| `capabilities` | A flat JSON object of 4 KB at most. Keys are 1 to 64 letters, digits, `_`, `.`, or `:`. Values are a string, a number, `true` or `false`, or a list of up to 100 strings. |

Anything else answers `422 CAPABILITIES_INVALID` or `422 REQUEST_INVALID`. Dopgate stores capabilities and signs them; it never enforces them. Keep them small, since they travel in every access token the agent gets.

## Signing in

The agent trades its token at `POST /api/v1/auth/token`, the same endpoint personal tokens use:

```bash
curl -X POST https://auth.example.com/api/v1/auth/token \
  -H 'content-type: application/json' \
  -d '{"token":"dga_Q2x9...3f9c"}'
```

It gets an ES256 access token, verified against the JWKS like any other:

```json
{
  "iss": "https://auth.example.com",
  "sub": "agt_01JC8Z...",
  "kind": "agent",
  "owner": "usr_01JC8Y...",
  "capabilities": { "repo": "dopgate", "max_files": 20, "can_merge": false, "labels": ["bot"] },
  "iat": 1762700000,
  "exp": 1762700900
}
```

There is no email, session, or refresh token. When the access token expires, the agent trades its token again. New capabilities show up in the next access token after the owner changes them.

In your backend, check `kind` before anything else. A `human` token has `email`; an `agent` token has `owner` and `capabilities` instead.

```js
const { payload } = await jwtVerify(token, jwks, { issuer: DOPGATE_URL });
if (payload.kind === "agent") {
  if (payload.capabilities?.can_merge !== true) throw new Error("This agent can't merge.");
}
```

Agent tokens are for your backend. Every Dopgate endpoint refuses them with `403 AUTHORIZATION_DENIED`: an agent can't read a profile, make tokens, or manage other agents.

| Answer at `/auth/token` | When |
| --- | --- |
| `401 TOKEN_INVALID` | The token is wrong, regenerated, or the agent was deleted. Recorded as `agent.token_rejected`, with only the last four characters. |
| `403 AGENT_DISABLED` | The agent is turned off, or its owner is. Turning both back on makes the same token work. |
| `429 RATE_LIMITED` | Too many attempts from this address. |

A successful trade isn't recorded in the audit log. It updates the agent's `lastUsedAt`, at most once a minute.

## Owners and admins

The owner edits an agent, regenerates its token, turns it off and on, and deletes it. Any admin can see every agent, read its capabilities, and turn off, turn on, or delete it, but only the owner edits it or regenerates its token.

When an owner is disabled, their agents stop signing in until the owner is enabled again. When an owner is deleted, their agents are deleted with them.

With `selfService.agents` off, users can't make, edit, or regenerate agents (`403 FEATURE_DISABLED`). The agents they have keep working, and users can still list, turn off, and delete them.
