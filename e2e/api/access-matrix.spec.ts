// Who may call what, as a table. Every admin and console route of the API
// is listed once with the kind of caller it needs, and each test sends every
// route as one kind of caller and compares the answer with the table. A test
// collects every cell that differed, then fails listing them all.
//
// The requests are harmless on purpose: unknown ids and empty bodies. A
// caller who is let in gets a 404 or a 422 from the route itself, which is
// fine. What matters here is 401 and 403 against everything else.
import {
  about,
  expect,
  step,
  test,
  useServer,
  type Admin,
  type ApiClient,
  type ApiResult,
  type User,
} from "../harness/index.ts";

const app = useServer();

/**
 * What a route needs, from the docs (docs/reference/api.md, Authentication):
 * - admin: a console token of root or an admin, or the service key.
 * - console: a console token only. The service key is refused.
 * - root: the console token of root.
 */
type Need = "admin" | "console" | "root";

type Route = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** The route as the OpenAPI document spells it. */
  route: string;
  /** What is sent: the route with its ids filled in with unknown ones. */
  path: string;
  need: Need;
  body?: unknown;
  /** Left out of the loop because it changes what the other callers see. */
  last?: boolean;
};

const ADMIN_ID = "adm_00000000000000000000000000";
const USER_ID = "usr_00000000000000000000000000";
const AGENT_ID = "agt_00000000000000000000000000";
const SESSION_ID = "ses_00000000000000000000000000";

function r(
  method: Route["method"],
  route: string,
  need: Need,
  body?: unknown,
  path?: string,
): Route {
  const filled =
    path ??
    route
      .replace("{admin_id}", ADMIN_ID)
      .replace("{user_id}", USER_ID)
      .replace("{agent_id}", AGENT_ID)
      .replace("{session_id}", SESSION_ID)
      .replace("{token_id}", "ptk_00000000000000000000000000")
      .replace("{name}", "verify_email")
      .replace("{provider_id}", "sso_00000000000000000000000000");
  return { method, route, path: filled, need, body };
}

const ROUTES: Route[] = [
  // The console's own account.
  r("POST", "/console/password/change", "console", {}),
  r("GET", "/console/me", "console"),
  r("PATCH", "/console/me", "console", {}),
  r("POST", "/console/email/change", "console", {}),
  r("GET", "/console/sessions", "console"),
  r("DELETE", "/console/sessions", "console", undefined, "/console/sessions?keepCurrent=true"),
  r("DELETE", "/console/sessions/{session_id}", "console"),
  // Admins.
  r("GET", "/admin/admins", "admin"),
  r("GET", "/admin/admins/{admin_id}", "admin"),
  r("POST", "/admin/admins", "root", {}),
  r("PATCH", "/admin/admins/{admin_id}", "root", {}),
  r("DELETE", "/admin/admins/{admin_id}", "root"),
  r("POST", "/admin/admins/{admin_id}/disable", "root"),
  r("POST", "/admin/admins/{admin_id}/enable", "root"),
  // Users.
  r("GET", "/admin/users", "admin"),
  r("POST", "/admin/users", "admin", {}),
  r("GET", "/admin/users/{user_id}", "admin"),
  r("PATCH", "/admin/users/{user_id}", "admin", {}),
  r("DELETE", "/admin/users/{user_id}", "admin"),
  r("POST", "/admin/users/{user_id}/disable", "admin"),
  r("POST", "/admin/users/{user_id}/enable", "admin"),
  r("POST", "/admin/users/{user_id}/password-reset", "admin"),
  r("GET", "/admin/users/{user_id}/sessions", "admin"),
  r("DELETE", "/admin/users/{user_id}/sessions", "admin"),
  // Personal tokens, as admins see them.
  r("GET", "/admin/users/{user_id}/personal-tokens", "admin"),
  r("DELETE", "/admin/users/{user_id}/personal-tokens/{token_id}", "console"),
  // Settings.
  r("GET", "/admin/settings", "admin"),
  r("PATCH", "/admin/settings", "admin", {}),
  r("POST", "/admin/settings/smtp/test", "admin", { to: "not-an-email" }),
  // Email templates.
  r("GET", "/admin/email-templates", "admin"),
  r("GET", "/admin/email-templates/{name}", "admin"),
  r("PUT", "/admin/email-templates/{name}", "admin", {}),
  r("DELETE", "/admin/email-templates/{name}", "admin"),
  r("POST", "/admin/email-templates/{name}/preview", "admin", {}),
  r("POST", "/admin/email-templates/{name}/test", "admin", {}),
  // Signing keys. Rotating is run last by its own test.
  r("GET", "/admin/keys", "admin"),
  // Audit.
  r("GET", "/admin/audit-events", "admin"),
  r("GET", "/admin/audit-events/verify", "admin"),
  // Agents. Reading is for admins, every change needs the console.
  r("GET", "/admin/agents", "admin"),
  r("POST", "/admin/agents", "console", {}),
  r("GET", "/admin/agents/{agent_id}", "admin"),
  r("PATCH", "/admin/agents/{agent_id}", "console", {}),
  r("DELETE", "/admin/agents/{agent_id}", "console"),
  r("POST", "/admin/agents/{agent_id}/regenerate", "console"),
  r("POST", "/admin/agents/{agent_id}/disable", "console"),
  r("POST", "/admin/agents/{agent_id}/enable", "console"),
  // Single sign-on, planned: they check who you are, then answer 501.
  r("GET", "/admin/sso/presets", "admin"),
  r("GET", "/admin/sso/providers", "admin"),
  r("POST", "/admin/sso/providers", "admin", {}),
  r("GET", "/admin/sso/providers/{provider_id}", "admin"),
  r("PATCH", "/admin/sso/providers/{provider_id}", "admin", {}),
  r("DELETE", "/admin/sso/providers/{provider_id}", "admin"),
];

/** Routes of the console that need no sign-in. */
const PUBLIC_CONSOLE = [
  "POST /console/login",
  "POST /console/refresh",
  "POST /console/logout",
  "POST /console/codes/send",
  "POST /console/codes/confirm",
  "POST /console/password/forgot",
  "POST /console/password/reset",
];

/** The route that rotates keys: root only, and it replaces the console secret. */
const ROTATE = r("POST", "/admin/keys/rotate", "root");

type Caller = {
  name: string;
  /** Tells whether the table lets this caller in for a route. */
  allowed: (need: Need) => boolean;
  /** What a refusal looks like: status and error code. */
  refusal: { status: number; code: string[] };
  send: (route: Route) => Promise<ApiResult>;
};

function through(api: ApiClient, token?: string | null) {
  return (route: Route) =>
    api.send(route.method, route.path, route.body, { record: false, token });
}

async function callers() {
  const root: Admin = await app.root();
  const sam: Admin = await app.admin("sam");
  const ana: User = await app.user("ana");
  const forged = `${sam.tokens.accessToken.slice(0, -4)}AAAA`;
  const anonymous = app.api;
  const denied = { status: 403, code: ["AUTHORIZATION_DENIED"] };
  return {
    anonymous: {
      name: "no token",
      allowed: () => false,
      refusal: { status: 401, code: ["AUTHENTICATION_REQUIRED"] },
      send: through(anonymous, null),
    },
    garbage: {
      name: "a token that is not one",
      allowed: () => false,
      refusal: { status: 401, code: ["AUTHENTICATION_INVALID"] },
      send: through(anonymous, "not-a-token"),
    },
    badJwt: {
      name: "a token shaped like a JWT that nobody signed",
      allowed: () => false,
      refusal: { status: 401, code: ["TOKEN_INVALID"] },
      send: through(anonymous, "aaaa.bbbb.cccc"),
    },
    forged: {
      name: "an admin's console token with its signature changed",
      allowed: () => false,
      refusal: { status: 401, code: ["TOKEN_INVALID"] },
      send: through(anonymous, forged),
    },
    user: {
      name: "a user's access token",
      allowed: () => false,
      refusal: denied,
      send: through(ana.api),
    },
    admin: {
      name: "an admin's console token",
      allowed: (need) => need !== "root",
      refusal: denied,
      send: through(sam.api),
    },
    root: {
      name: "root's console token",
      allowed: () => true,
      refusal: denied,
      send: through(root.api),
    },
    service: {
      name: "the service key",
      allowed: (need) => need === "admin",
      refusal: denied,
      send: through(app.service),
    },
  } satisfies Record<string, Caller>;
}

/** Sends every route as `caller` and returns each cell that differs. */
async function walk(caller: Caller, routes: Route[]): Promise<string[]> {
  const differences: string[] = [];
  for (const route of routes) {
    const result = await caller.send(route);
    const label = `${route.method} ${route.route}`;
    const refused = result.status === 401 || result.status === 403;
    if (caller.allowed(route.need)) {
      if (refused) {
        differences.push(
          `${label}: expected to be let in, got ${result.status} ${result.code}`,
        );
      }
    } else if (result.status !== caller.refusal.status) {
      differences.push(
        `${label}: expected ${caller.refusal.status}, got ${result.status} ${result.code ?? ""}`.trim(),
      );
    } else if (!caller.refusal.code.includes(result.code ?? "")) {
      differences.push(
        `${label}: expected ${caller.refusal.code.join(" or ")}, got ${result.code}`,
      );
    }
  }
  return differences;
}

const IN_LOOP = ROUTES.filter((route) => !route.last);

function matrixTest(
  key: keyof Awaited<ReturnType<typeof callers>>,
  title: string,
  description: string,
  tag: string[],
) {
  test(title, { tag, annotation: about(description) }, async () => {
    const all = await callers();
    const caller: Caller = all[key];
    const differences = await step(
      `Send ${IN_LOOP.length} admin and console routes as ${caller.name}`,
      () => walk(caller, IN_LOOP),
    );
    await step("Every answer matches the table", async () => {
      expect(differences).toEqual([]);
    });
  });
}

matrixTest(
  "anonymous",
  "with no token every admin and console route answers 401 AUTHENTICATION_REQUIRED",
  "A call without an Authorization header is refused on every route that isn't public, whatever the method.",
  ["@security"],
);
matrixTest(
  "garbage",
  "a bearer value that is not a token answers 401 AUTHENTICATION_INVALID everywhere",
  "A value with no dots is not a JWT, so it is compared with the service key and refused.",
  ["@security"],
);
matrixTest(
  "badJwt",
  "a JWT-shaped value nobody signed answers 401 TOKEN_INVALID everywhere",
  "Three dot-separated parts are tried as a token, and a header or signature nobody issued is refused.",
  ["@security"],
);
matrixTest(
  "forged",
  "a console token with a changed signature answers 401 TOKEN_INVALID everywhere",
  "Changing the signature of a real admin token makes it invalid, so a token can't be tampered with.",
  ["@security", "@console"],
);
matrixTest(
  "user",
  "a user's access token is refused with 403 AUTHORIZATION_DENIED everywhere",
  "A user of the app has no admin or console rights. Every route answers 403, including the ones an admin may call.",
  ["@security", "@users"],
);
matrixTest(
  "admin",
  "an admin's console token reaches everything except the root-only routes",
  "An admin gets through on admin and console routes (any answer but 401 or 403) and 403 AUTHORIZATION_DENIED on the routes only root may call: adding, changing, disabling, enabling and removing admins.",
  ["@admins", "@security"],
);
matrixTest(
  "root",
  "root's console token is let in on every admin and console route",
  "Root passes the admin, console and root-only checks on every route. Rotating keys is checked in its own test at the end.",
  ["@admins", "@security"],
);
matrixTest(
  "service",
  "the service key reaches the admin routes and is refused on console-only ones",
  "The backend's service key acts as an admin. It is let in on routes that take Admin and refused with 403 AUTHORIZATION_DENIED where a signed-in console account is required or where root is.",
  ["@admins", "@security"],
);

test(
  "the table lists every admin and console route in the OpenAPI document",
  {
    tag: ["@security"],
    annotation: about(
      "The routes under /admin and /console in /api/v1/openapi.json are all either in the matrix or public on purpose, so a new route can't ship without a row here.",
    ),
  },
  async () => {
    const document = await step("GET /api/v1/openapi.json", async () => {
      const result = await app.api.get("/api/v1/openapi.json", { record: false });
      expect(result.status).toBe(200);
      return result.body;
    });
    const listed = new Set(
      [...ROUTES, ROTATE].map((route) => `${route.method} ${route.route}`),
    );
    const found: string[] = [];
    for (const [path, methods] of Object.entries<any>(document.paths)) {
      const local = path.replace(/^\/api\/v1/, "");
      if (!local.startsWith("/admin") && !local.startsWith("/console")) continue;
      for (const method of Object.keys(methods)) {
        if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
        found.push(`${method.toUpperCase()} ${local}`);
      }
    }
    await step("Every documented route has a row or is public", async () => {
      expect(found.length).toBeGreaterThan(50);
      const normalise = (route: string) =>
        route
          .replace(/\{[^}]+\}/g, "{}")
          .replace(/\/\{\}\//g, "/{}/");
      const rows = new Set([...listed].map(normalise));
      const missing = found
        .filter((route) => !PUBLIC_CONSOLE.includes(route))
        .filter((route) => !rows.has(normalise(route)));
      expect(missing).toEqual([]);
    });
    await step("Every row names a documented route", async () => {
      const normalise = (route: string) => route.replace(/\{[^}]+\}/g, "{}");
      const documented = new Set(found.map(normalise));
      const planned = [...listed].filter((route) => route.includes("/admin/sso/"));
      const unknown = [...listed]
        .filter((route) => !planned.includes(route))
        .filter((route) => !documented.has(normalise(route)));
      expect(unknown).toEqual([]);
    });
  },
);

test(
  "the public console routes answer without a token",
  {
    tag: ["@console", "@security"],
    annotation: about(
      "Sign-in, refresh, codes and password recovery are open on purpose. Sent with no token and an empty body they fail on the body, never on authentication. Logout alone asks for a token to end.",
    ),
  },
  async () => {
    const open = PUBLIC_CONSOLE.filter((route) => route !== "POST /console/logout");
    for (const route of open) {
      await step(`${route} with no token and an empty body`, async () => {
        const path = route.replace("POST ", "");
        const result = await app.api.post(path, {}, { record: false });
        expect(result.status, JSON.stringify(result.body)).not.toBe(403);
        expect(result.code).not.toBe("AUTHENTICATION_REQUIRED");
      });
    }
    await step("POST /console/logout with nothing to end asks for a token", async () => {
      const result = await app.api.post("/console/logout", {}, { record: false });
      expect(result.status).toBe(401);
      expect(result.code).toBe("AUTHENTICATION_REQUIRED");
    });
  },
);

test(
  "only root may rotate the signing keys",
  {
    tag: ["@keys", "@security"],
    annotation: about(
      "POST /admin/keys/rotate answers 403 to an admin, the service key and a user, and works for root. It runs last because rotating replaces the console secret, which ends the console tokens made before it.",
    ),
  },
  async () => {
    const all = await callers();
    const refused = [all.admin, all.service, all.user] as Caller[];
    for (const caller of refused) {
      await step(`POST /admin/keys/rotate as ${caller.name}`, async () => {
        const result = await caller.send(ROTATE);
        expect(result.status).toBe(403);
        expect(result.code).toBe("AUTHORIZATION_DENIED");
      });
    }
    await step("POST /admin/keys/rotate with no token", async () => {
      const result = await all.anonymous.send(ROTATE);
      expect(result.status).toBe(401);
    });
    await step("POST /admin/keys/rotate as root", async () => {
      const result = await all.root.send(ROTATE);
      expect(result.status, JSON.stringify(result.body)).toBe(200);
      expect(result.message).toBe("SIGNING_KEY_ROTATED");
    });
  },
);
