---
title: "Check an agent in your backend"
description: "How an AI agent trades its Dopgate token for a JWT, which claims the JWT carries, and how your backend verifies it and tells an agent from a person."
---

# Check an agent in your backend

An agent signs in by trading its token for an access token. Your backend then verifies that access token the same way it verifies a person's, and reads `kind` to see which one it has.

## The agent gets an access token

The agent trades its token at `POST /api/v1/auth/token`, the same endpoint [personal tokens](/guide/personal-tokens) use:

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

There is no email, session, or refresh token. When the access token expires, the agent trades its token again.

| Answer at `/auth/token` | When |
| --- | --- |
| `401 TOKEN_INVALID` | The token is wrong, regenerated, or the agent was deleted. Recorded as `agent.token_rejected`, with only the last four characters. |
| `403 AGENT_DISABLED` | The agent is turned off, or its owner is. Turning both back on makes the same token work. |
| `429 RATE_LIMITED` | Too many attempts from this address. |

A successful trade isn't recorded in the audit log. It updates the agent's `lastUsedAt`, at most once a minute.

## Your backend checks the token

Check `kind` before anything else. A `human` token has `email`; an `agent` token has `owner` and `capabilities` instead.

```js
const { payload } = await jwtVerify(token, jwks, {
  issuer: DOPGATE_URL,
  audience: DOPGATE_URL,
});
if (payload.kind === "agent") {
  if (payload.capabilities?.can_merge !== true) throw new Error("This agent can't merge.");
}
```

On routes that only people should reach, refuse any token whose `kind` is `agent`. [Tokens and sessions](/guide/tokens-and-sessions) has the signature check in Go and Python, and [Token claims](/reference/token-claims) describes every claim.

## What an agent token can't do

Agent tokens are for your backend. Every Dopgate endpoint refuses them with `403 AUTHORIZATION_DENIED`: an agent can't read a profile, make tokens, or manage other agents.
