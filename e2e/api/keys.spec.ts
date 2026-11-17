import {
  about,
  expect,
  PASSWORD,
  ROOT_EMAIL,
  step,
  test,
  useServer,
} from "../harness/index.ts";
import { claims, jwtHeader, verifiedByJwks } from "../harness/helpers.ts";
import { query } from "../harness/server.ts";

const app = useServer();

// Tests that rotate the keys end the console tokens of everyone signed in,
// so they come last and use sessions of their own.

type Jwk = {
  kty: string;
  crv: string;
  x: string;
  y: string;
  kid: string;
  alg: string;
  use: string;
  d?: string;
};
type Key = {
  id: string;
  algorithm: string;
  status: "active" | "retiring" | "retired";
  createdAt: string;
  rotatedAt: string | null;
  retiredAt: string | null;
};

const jwks = async () =>
  (await app.api.get("/.well-known/jwks.json", { record: false })).body as {
    keys: Jwk[];
  };

test(
  "the key set lists the active signing key",
  {
    tag: ["@smoke", "@keys"],
    annotation: about(
      "GET /.well-known/jwks.json needs no sign-in. It is a plain JWKS, not the usual envelope, with one ES256 public key that carries its kid, alg and use, and it may be cached for five minutes.",
    ),
  },
  async () => {
    const res = await step("GET /.well-known/jwks.json with no credentials", () =>
      app.api.get("/.well-known/jwks.json"),
    );
    await step("It answers 200 as JSON without the envelope", async () => {
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("application/json");
      expect(Object.keys(res.body)).toEqual(["keys"]);
      expect(res.body.success).toBeUndefined();
    });
    await step("It may be cached for 5 minutes", async () => {
      expect(res.headers["cache-control"]).toBe("public, max-age=300");
    });
    await step("The only key is an ES256 signing key on P-256 with a key_ ID", async () => {
      expect(res.body.keys).toHaveLength(1);
      const key: Jwk = res.body.keys[0];
      expect(key).toMatchObject({
        kty: "EC",
        crv: "P-256",
        alg: "ES256",
        use: "sig",
      });
      expect(key.kid).toMatch(/^key_/);
      expect(key.x).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(key.y).toMatch(/^[A-Za-z0-9_-]{43}$/);
    });
    await step("There is no private part in it", async () => {
      expect(JSON.stringify(res.body)).not.toMatch(/"d"|PRIVATE/);
    });
  },
);

test(
  "the discovery document names the issuer and where the key set is",
  {
    tag: ["@smoke", "@keys"],
    annotation: about(
      "GET /.well-known/openid-configuration tells a gateway that only knows the issuer URL where to find the keys. It has the five fixed fields and nothing else, it isn't wrapped in the envelope, and it can be cached for five minutes.",
    ),
  },
  async () => {
    const res = await step("GET /.well-known/openid-configuration with no credentials", () =>
      app.api.get("/.well-known/openid-configuration"),
    );
    await step("It answers 200 with the five fields", async () => {
      expect(res.status).toBe(200);
      expect(res.headers["cache-control"]).toBe("public, max-age=300");
      expect(res.body).toEqual({
        issuer: app.url,
        jwks_uri: `${app.url}/.well-known/jwks.json`,
        response_types_supported: ["id_token"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["ES256"],
      });
    });
    await step("The jwks_uri it names serves the key set", async () => {
      const set = await fetch(res.body.jwks_uri);
      expect(set.status).toBe(200);
      expect(((await set.json()) as { keys: Jwk[] }).keys).toHaveLength(1);
    });
  },
);

test(
  "an access token is signed by the key in the set and passes the checks a backend runs",
  {
    tag: ["@smoke", "@keys", "@tokens"],
    annotation: about(
      "A backend verifies tokens offline. The header names ES256 and a kid from the key set, the signature checks out against that key, and the issuer and audience are the public URL the discovery document gave.",
    ),
  },
  async () => {
    const user = await app.user("ana");
    const token = user.tokens!.accessToken;
    const set = await step("GET /.well-known/jwks.json", jwks);
    await step("The token header is ES256 with the active key's kid", async () => {
      expect(jwtHeader(token)).toMatchObject({
        alg: "ES256",
        typ: "JWT",
        kid: set.keys[0]!.kid,
      });
    });
    await step("The signature verifies against the key set", async () => {
      expect(await verifiedByJwks(token, set)).toBe(true);
    });
    await step("A token with one byte of the signature changed does not", async () => {
      const [head, body, signature] = token.split(".");
      const flipped = signature!.startsWith("A") ? `B${signature!.slice(1)}` : `A${signature!.slice(1)}`;
      expect(await verifiedByJwks(`${head}.${body}.${flipped}`, set)).toBe(false);
    });
    await step("Issuer and audience are the discovery document's issuer", async () => {
      const discovery = await app.api.get("/.well-known/openid-configuration", {
        record: false,
      });
      expect(claims(token)).toMatchObject({
        iss: discovery.body.issuer,
        aud: discovery.body.issuer,
        sub: user.id,
        kind: "human",
      });
    });
  },
);

test(
  "signing keys can be read by root, an admin and the service key",
  {
    tag: ["@keys", "@admins"],
    annotation: about(
      "GET /admin/keys lists every key with its status and times. Root, an admin and a backend with the service key can read it. Nobody else can.",
    ),
  },
  async () => {
    const root = await app.root();
    const sam = await app.admin("sam");
    const listed = await step("GET /admin/keys as root", () => root.api.get("/admin/keys"));
    await step("It answers 200 SIGNING_KEYS_FETCHED with the one active key", async () => {
      expect(listed.status).toBe(200);
      expect(listed.message).toBe("SIGNING_KEYS_FETCHED");
      expect(listed.data).toHaveLength(1);
      expect(listed.data[0]).toMatchObject({
        algorithm: "ES256",
        status: "active",
        rotatedAt: null,
        retiredAt: null,
      });
      expect(listed.data[0].id).toMatch(/^key_/);
      expect(new Date(listed.data[0].createdAt).getTime()).not.toBeNaN();
    });
    await step("It is the key the key set serves", async () => {
      expect((await jwks()).keys.map((key) => key.kid)).toEqual([listed.data[0].id]);
    });
    await step("An admin reads the same list", async () => {
      const asAdmin = await sam.api.get("/admin/keys", { record: false });
      expect(asAdmin.status).toBe(200);
      expect(asAdmin.data).toEqual(listed.data);
    });
    await step("The service key reads the same list", async () => {
      const asService = await app.service.get("/admin/keys", { record: false });
      expect(asService.status).toBe(200);
      expect(asService.data).toEqual(listed.data);
    });
    await step("The private key never shows in the list", async () => {
      expect(JSON.stringify(listed.body)).not.toMatch(/PRIVATE|privatePem|"d"/);
    });
  },
);

test(
  "only an admin can list keys",
  {
    tag: ["@keys", "@security"],
    annotation: about(
      "GET /admin/keys refuses a caller with no token, a user's token and a made-up token.",
    ),
  },
  async () => {
    const user = await app.user("ana");
    await step("No token is a 401 AUTHENTICATION_REQUIRED", async () => {
      const refused = await app.api.get("/admin/keys", { record: false });
      expect(refused.status).toBe(401);
      expect(refused.code).toBe("AUTHENTICATION_REQUIRED");
    });
    await step("A user's token is a 403 AUTHORIZATION_DENIED", async () => {
      const refused = await user.api.get("/admin/keys", { record: false });
      expect(refused.status).toBe(403);
      expect(refused.code).toBe("AUTHORIZATION_DENIED");
    });
    await step("A made-up token is a 401", async () => {
      const refused = await app.api.get("/admin/keys", {
        token: "not.a.token",
        record: false,
      });
      expect(refused.status).toBe(401);
    });
  },
);

test(
  "only root can rotate the keys",
  {
    tag: ["@keys", "@security"],
    annotation: about(
      "POST /admin/keys/rotate is root only. An admin, the service key, a user and a caller with no token are all refused, and nothing changes.",
    ),
  },
  async () => {
    const sam = await app.admin("sam");
    const user = await app.user("ana");
    const before = (await (await app.root()).api.get("/admin/keys", { record: false })).data;
    await step("No token is a 401 AUTHENTICATION_REQUIRED", async () => {
      const refused = await app.api.post("/admin/keys/rotate");
      expect(refused.status).toBe(401);
      expect(refused.code).toBe("AUTHENTICATION_REQUIRED");
    });
    await step("An admin is a 403 AUTHORIZATION_DENIED", async () => {
      const refused = await sam.api.post("/admin/keys/rotate", undefined, { record: false });
      expect(refused.status).toBe(403);
      expect(refused.code).toBe("AUTHORIZATION_DENIED");
    });
    await step("The service key is a 403 AUTHORIZATION_DENIED", async () => {
      const refused = await app.service.post("/admin/keys/rotate", undefined, { record: false });
      expect(refused.status).toBe(403);
      expect(refused.code).toBe("AUTHORIZATION_DENIED");
    });
    await step("A user's token is a 403 AUTHORIZATION_DENIED", async () => {
      const refused = await user.api.post("/admin/keys/rotate", undefined, { record: false });
      expect(refused.status).toBe(403);
      expect(refused.code).toBe("AUTHORIZATION_DENIED");
    });
    await step("The keys are as they were", async () => {
      const after = await app.service.get("/admin/keys", { record: false });
      expect(after.data).toEqual(before);
      expect((await jwks()).keys).toHaveLength(1);
    });
  },
);

test(
  "rotating makes a new active key, keeps the old one verifying and replaces the console secret",
  {
    tag: ["@smoke", "@keys", "@tokens"],
    annotation: about(
      "Root rotates the keys. The new key signs from then on, the previous key is retiring and stays in the key set so tokens signed before still verify and still work, and the console's token is replaced: the old one stops working, and a refresh gives a new one. The audit log records who did it.",
    ),
  },
  async () => {
    const user = await app.user("ana");
    const oldToken = user.tokens!.accessToken;
    const oldKid = jwtHeader(oldToken).kid as string;
    // A console session of its own: rotating ends the shared root token.
    const root = await app.consoleSession(ROOT_EMAIL, PASSWORD, "rotating-root");
    const oldConsoleToken = root.tokens.accessToken;

    const rotated = await step("POST /admin/keys/rotate as root", () =>
      root.api.post("/admin/keys/rotate"),
    );
    await step("It answers 200 SIGNING_KEY_ROTATED with the new active key", async () => {
      expect(rotated.status).toBe(200);
      expect(rotated.message).toBe("SIGNING_KEY_ROTATED");
      expect(rotated.data).toMatchObject({ algorithm: "ES256", status: "active" });
      expect(rotated.data.id).toMatch(/^key_/);
      expect(rotated.data.id).not.toBe(oldKid);
    });
    const newKid = rotated.data.id as string;

    await step("The old console token stops working at once", async () => {
      const refused = await app.api.get("/admin/keys", {
        token: oldConsoleToken,
        record: false,
      });
      expect(refused.status).toBe(401);
      expect(refused.code).toBe("TOKEN_INVALID");
    });
    await step("POST /console/refresh trades the refresh token for a working one", async () => {
      const refreshed = await app.api.post(
        "/console/refresh",
        { refreshToken: root.tokens.refreshToken },
        { record: false },
      );
      expect(refreshed.status).toBe(200);
      expect(refreshed.data.accessToken).not.toBe(oldConsoleToken);
      root.api.token = refreshed.data.accessToken;
    });
    await step("GET /admin/keys lists the new key active and the old one retiring", async () => {
      const keys = await root.api.get("/admin/keys", { record: false });
      expect(keys.status).toBe(200);
      const byId = new Map<string, Key>(keys.data.map((key: Key) => [key.id, key]));
      expect(byId.get(newKid)).toMatchObject({ status: "active", rotatedAt: null });
      expect(byId.get(oldKid)).toMatchObject({ status: "retiring", retiredAt: null });
      expect(byId.get(oldKid)!.rotatedAt).toBeTruthy();
    });
    await step("The key set has both keys, new first", async () => {
      const set = await jwks();
      expect(set.keys.map((key) => key.kid)).toEqual([newKid, oldKid]);
      expect(set.keys.every((key) => key.alg === "ES256" && key.use === "sig")).toBe(true);
    });
    await step("A token signed before the rotation still verifies and still works", async () => {
      expect(await verifiedByJwks(oldToken, await jwks())).toBe(true);
      const me = await user.api.get("/auth/me", { record: false });
      expect(me.status).toBe(200);
      expect(me.data.email).toBe(user.email);
    });
    await step("A new sign-in is signed by the new key", async () => {
      const again = await app.userSession(user.email);
      const token = again.tokens.accessToken;
      expect(jwtHeader(token).kid).toBe(newKid);
      expect(await verifiedByJwks(token, await jwks())).toBe(true);
    });
    await step("A refresh of the old session is signed by the new key too", async () => {
      const fresh = await app.api.post(
        "/auth/refresh",
        { refreshToken: user.tokens!.refreshToken },
        { record: false },
      );
      expect(fresh.status).toBe(200);
      expect(jwtHeader(fresh.data.accessToken).kid).toBe(newKid);
    });
    await step("The audit log has a key.rotated event by root for the new key", async () => {
      const events = await root.api.get("/admin/audit-events?action=key.rotated", {
        record: false,
      });
      expect(events.status).toBe(200);
      expect(events.data.items[0]).toMatchObject({
        actorType: "root",
        actorLabel: ROOT_EMAIL,
        action: "key.rotated",
        resourceType: "signing_key",
        resourceId: newKid,
      });
    });
  },
);

test(
  "a retiring key leaves the key set after a day, and its tokens stop working",
  {
    tag: ["@keys", "@tokens"],
    annotation: about(
      "A rotated-out key keeps verifying for 24 hours, the longest an access token lives. Once that time has passed, the next rotation retires it: it drops out of the key set, the list shows it retired with a time, and tokens it signed are refused. The test sets the clock back by editing the key's rotation time.",
    ),
  },
  async () => {
    const oldUser = await app.user("old");
    const oldKid = jwtHeader(oldUser.tokens!.accessToken).kid as string;
    let root = await app.consoleSession(ROOT_EMAIL, PASSWORD, "second-rotation");

    await step("POST /admin/keys/rotate so the key the user's token names is retiring", async () => {
      const first = await root.api.post("/admin/keys/rotate", undefined, { record: false });
      expect(first.status).toBe(200);
      // The rotation replaced the console secret, so root signs in again.
      root = await app.consoleSession(ROOT_EMAIL, PASSWORD, "third-rotation");
    });
    await step("Make that key look 25 hours past its rotation", async () => {
      await query(
        app.server.schema,
        "UPDATE signing_keys SET rotated_at = now() - interval '25 hours' WHERE id = $1",
        [oldKid],
      );
    });
    const rotated = await step("POST /admin/keys/rotate again", () =>
      root.api.post("/admin/keys/rotate"),
    );
    await step("The aged key is retired, with a time, and the newest key is active", async () => {
      expect(rotated.status).toBe(200);
      // The rotation ended root's console token, so the service key reads.
      const keys = await app.service.get("/admin/keys", { record: false });
      const byId = new Map<string, Key>(keys.data.map((key: Key) => [key.id, key]));
      expect(byId.get(oldKid)).toMatchObject({ status: "retired" });
      expect(byId.get(oldKid)!.retiredAt).toBeTruthy();
      expect(byId.get(rotated.data.id)).toMatchObject({ status: "active" });
      expect(keys.data.filter((key: Key) => key.status === "active")).toHaveLength(1);
    });
    await step("The key set no longer has the retired key", async () => {
      const kids = (await jwks()).keys.map((key) => key.kid);
      expect(kids).not.toContain(oldKid);
      expect(kids).toContain(rotated.data.id);
    });
    await step("A token it signed no longer verifies and is refused by the server", async () => {
      expect(await verifiedByJwks(oldUser.tokens!.accessToken, await jwks())).toBe(false);
      const refused = await oldUser.api.get("/auth/me", { record: false });
      expect(refused.status).toBe(401);
    });
  },
);
