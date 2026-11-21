---
title: "Capabilities in the token"
description: "Capabilities are the permissions an owner gives an AI agent: flat key-value pairs that Dopgate signs into the agent's access token for your backend to read."
---

# Capabilities in the token

Capabilities say what an agent may do. The owner sets them as flat key-value pairs when they [create the agent](/ai-agents/create-an-agent), Dopgate puts them in the agent's access token, and your backend reads them to decide whether to allow a request.

```json
{ "repo": "dopgate", "max_files": 20, "can_merge": false, "labels": ["bot"] }
```

The keys and their meaning are yours. Dopgate stores capabilities and signs them; it never enforces them.

## Rules

| Part | Rules |
| --- | --- |
| The object | Flat JSON, 4 KB at most |
| Keys | 1 to 64 letters, digits, `_`, `.`, or `:` |
| Values | A string, a number, `true` or `false`, or a list of up to 100 strings |

Anything else answers `422 CAPABILITIES_INVALID`. Keep capabilities small, since they travel in every access token the agent gets.

## How they reach the token

When the agent trades its token, the access token carries the capabilities as a claim:

```json
{
  "sub": "agt_01JC8Z...",
  "kind": "agent",
  "owner": "usr_01JC8Y...",
  "capabilities": { "repo": "dopgate", "max_files": 20, "can_merge": false, "labels": ["bot"] }
}
```

The signature covers the claim, so an agent can't change its own capabilities. Only the owner can, with `PATCH` on the agent. `PATCH` replaces the whole `capabilities` object, so send every key you want to keep.

## When capabilities change

New capabilities show up in the next access token the agent gets. A token the agent already holds keeps the old ones until it expires, which is 15 minutes by default (`accessTokenMinutes`). Turning the agent off or regenerating its token stops it from getting another access token; the one it holds still verifies until it expires.

## Reading them in your backend

[Check an agent in your backend](/ai-agents/verify-in-your-backend) has the full check. The short version: verify the token, confirm `kind` is `agent`, then read the capability your route needs and refuse the request when it is missing or wrong.
