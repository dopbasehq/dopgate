---
title: "Create an agent"
description: "Who can create an AI agent in Dopgate, the fields it takes, the token it returns once, and how owners and admins edit, disable, and delete agents."
---

# Create an agent

An agent is an account for an AI agent, a bot, or a script with its own identity. Every agent belongs to an owner and signs in only with its token. [Auth for AI agents](/ai-agents/) explains the idea; this page covers making and managing one.

## Who makes agents

- **Admins** make agents on the console's **Agents** page or with `POST /api/v1/admin/agents`. The admin who made it owns it.
- **Users** make their own through your app with `POST /api/v1/auth/agents`, once an admin turns on `selfService.agents` (**Settings → Tokens and agents**). The same section caps how many agents one user may have, 10 by default. Like personal tokens, this needs a password or code sign-in: an access token traded from a personal token gets `403 AUTHORIZATION_DENIED`.

The service key can list and read agents but can't make or change them.

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

## Names and descriptions

| Field | Rules |
| --- | --- |
| `name` | 1 to 64 lowercase letters, digits, and dashes, unique among the owner's agents |
| `description` | Optional, one line of up to 280 characters. Shown in the console only, never in the token. |
| `capabilities` | A flat JSON object. [Capabilities in the token](/ai-agents/capabilities) has the rules. |

A name the owner already uses answers `409 AGENT_NAME_TAKEN`, and a user at the cap gets `409 LIMIT_REACHED`. Any other bad field answers `422 CAPABILITIES_INVALID` or `422 REQUEST_INVALID`.

## Owners and admins

The owner edits an agent, regenerates its token, turns it off and on, and deletes it. Any admin can see every agent, read its capabilities, and turn off, turn on, or delete it, but only the owner edits it or regenerates its token. Admins change agents from the console only; the service key can't.

| Call | Who | What it does |
| --- | --- | --- |
| `GET /api/v1/auth/agents` | The user | List their own agents |
| `GET`, `PATCH`, `DELETE /api/v1/auth/agents/{id}` | The user | Read, edit, or delete one of their agents |
| `POST /api/v1/auth/agents/{id}/regenerate` | The user | Get a new token |
| `POST /api/v1/auth/agents/{id}/disable` and `/enable` | The user | Turn it off or on |
| `GET /api/v1/admin/agents` | Admins, the service key | List every agent. Filter with `owner`, `status`, and `search` (the name), and page with `cursor` and `limit`. |
| `GET /api/v1/admin/agents/{id}` | Admins, the service key | Read one agent |
| `POST /api/v1/admin/agents` | Admins in the console | Make an agent the admin owns |
| `PATCH /api/v1/admin/agents/{id}`, `POST .../regenerate` | The owning admin | Edit it or get a new token |
| `POST .../disable`, `POST .../enable`, `DELETE /api/v1/admin/agents/{id}` | Admins in the console | Turn any agent off or on, or delete it |

`PATCH` changes only the fields you send. `capabilities` replaces the whole object, and an empty `description` clears it.

When an owner is disabled, their agents stop signing in until the owner is enabled again. When an owner is deleted, their agents are deleted with them.

With `selfService.agents` off, users can't make, edit, or regenerate agents (`403 FEATURE_DISABLED`). The agents they have keep working, and users can still list, read, turn off, turn on, and delete them.
