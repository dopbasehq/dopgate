import { about, expect, PASSWORD, step, test, useServer } from "../harness/index.ts";

const app = useServer();

const BACKEND_UA = "the-backend/1.0";
const VISITOR_IP = "198.51.100.7";
const VISITOR_AGENT = "Mozilla/5.0 (Macintosh) Firefox/140.0";

// A user who can sign in, without a session yet.
function newUser(name = "ana") {
  return app.user(name, { signIn: false });
}

function relayHeaders(extra: Record<string, string> = {}) {
  return {
    "x-dopgate-backend-key": app.serviceKey,
    "user-agent": BACKEND_UA,
    ...extra,
  };
}

async function signIn(email: string, headers: Record<string, string>) {
  return app.api.post("/auth/login", { email, password: PASSWORD }, { headers });
}

// The device the access token belongs to, as the user's device list shows it.
async function currentDevice(accessToken: string) {
  const api = await app.newApi("visitor", accessToken);
  const devices = await api.get("/auth/sessions", { record: false });
  expect(devices.status).toBe(200);
  return devices.data.find((device: { current: boolean }) => device.current);
}

async function signedInEvent(userId: string) {
  const events = await app.service.get(
    "/admin/audit-events?action=user.signed_in&limit=200",
    { record: false },
  );
  expect(events.status).toBe(200);
  return events.data.items.find(
    (event: { actorId: string }) => event.actorId === userId,
  );
}

test(
  "with the backend key, the session and the audit log record the visitor",
  {
    tag: ["@smoke", "@auth", "@security"],
    annotation: about(
      "A backend signs people in for them. With the service key in X-Dopgate-Backend-Key, the visitor's address and browser, sent in X-Dopgate-Client-IP and X-Dopgate-Client-Agent, replace the backend's own in the device list and the audit log.",
    ),
  },
  async () => {
    const user = await newUser();
    const signedIn = await step("POST /auth/login with the key and the visitor's headers", () =>
      signIn(
        user.email,
        relayHeaders({
          "x-dopgate-client-ip": VISITOR_IP,
          "x-dopgate-client-agent": VISITOR_AGENT,
        }),
      ),
    );
    await step("The sign-in itself works as usual", async () => {
      expect(signedIn.status).toBe(200);
      expect(signedIn.message).toBe("SIGNED_IN");
    });
    await step("GET /auth/sessions shows the visitor's address and browser", async () => {
      const device = await currentDevice(signedIn.data.accessToken);
      expect(device.ipAddress).toBe(VISITOR_IP);
      expect(device.userAgent).toBe(VISITOR_AGENT);
    });
    await step("The user.signed_in audit event has the visitor's address", async () => {
      const event = await signedInEvent(user.id);
      expect(event).toMatchObject({ actorType: "user", ipAddress: VISITOR_IP });
    });
  },
);

test(
  "the visitor address may carry a port, and IPv6 works",
  {
    tag: ["@auth", "@security"],
    annotation: about(
      "X-Dopgate-Client-IP takes an address with or without a port, and an IPv6 address in brackets or bare. The port is dropped.",
    ),
  },
  async () => {
    const cases: [string, string][] = [
      ["203.0.113.9:51234", "203.0.113.9"],
      ["2001:db8::7", "2001:db8::7"],
      ["[2001:db8::8]:443", "2001:db8::8"],
      ["  203.0.113.10  ", "203.0.113.10"],
    ];
    for (const [sent, recorded] of cases) {
      const user = await newUser();
      await step(`Sign in with X-Dopgate-Client-IP "${sent}"`, async () => {
        const signedIn = await signIn(
          user.email,
          relayHeaders({ "x-dopgate-client-ip": sent }),
        );
        expect(signedIn.status).toBe(200);
        const device = await currentDevice(signedIn.data.accessToken);
        expect(device.ipAddress).toBe(recorded);
      });
    }
  },
);

test(
  "with the key but no visitor headers, the backend's own address and agent are kept",
  {
    tag: ["@auth"],
    annotation: about(
      "The key only vouches for the two headers. Leaving them out keeps the connection's address and the User-Agent the backend sent, and an empty agent header counts as absent.",
    ),
  },
  async () => {
    const user = await newUser();
    const signedIn = await step("POST /auth/login with the key and no visitor headers", () =>
      signIn(user.email, relayHeaders({ "x-dopgate-client-agent": "   " })),
    );
    await step("The device list shows the loopback address and the backend's agent", async () => {
      expect(signedIn.status).toBe(200);
      const device = await currentDevice(signedIn.data.accessToken);
      expect(device.ipAddress).toMatch(/^(127\.0\.0\.1|::1)$/);
      expect(device.userAgent).toBe(BACKEND_UA);
    });
  },
);

test(
  "a long visitor agent is cut to 512 characters",
  {
    tag: ["@auth"],
    annotation: about(
      "The browser string a backend passes on is stored in full up to 512 characters and no further, so one visitor can't fill the device list with text.",
    ),
  },
  async () => {
    const user = await newUser();
    const signedIn = await step("POST /auth/login with a 2000 character agent", () =>
      signIn(
        user.email,
        relayHeaders({
          "x-dopgate-client-ip": VISITOR_IP,
          "x-dopgate-client-agent": "a".repeat(2000),
        }),
      ),
    );
    await step("The device list keeps the first 512", async () => {
      const device = await currentDevice(signedIn.data.accessToken);
      expect(device.userAgent).toBe("a".repeat(512));
    });
  },
);

test(
  "without the key, the visitor headers are ignored",
  {
    tag: ["@auth", "@security"],
    annotation: about(
      "Anyone can send X-Dopgate-Client-IP, so without the backend key it is ignored and the connection's address and the real User-Agent are recorded. A visitor can't pick the address their limits and audit trail use.",
    ),
  },
  async () => {
    const user = await newUser();
    const signedIn = await step("POST /auth/login with the visitor headers but no key", () =>
      signIn(user.email, {
        "x-dopgate-client-ip": VISITOR_IP,
        "x-dopgate-client-agent": "Forged agent",
        "user-agent": "curl/8.4",
      }),
    );
    await step("The device list has the connection's address and the real agent", async () => {
      expect(signedIn.status).toBe(200);
      const device = await currentDevice(signedIn.data.accessToken);
      expect(device.ipAddress).toMatch(/^(127\.0\.0\.1|::1)$/);
      expect(device.userAgent).toBe("curl/8.4");
    });
    await step("An address that doesn't parse is ignored too, not refused", async () => {
      const again = await signIn(user.email, {
        "x-dopgate-client-ip": "not-an-address",
      });
      expect(again.status).toBe(200);
    });
    await step("The audit event has the connection's address", async () => {
      const event = await signedInEvent(user.id);
      expect(event.ipAddress).toMatch(/^(127\.0\.0\.1|::1)$/);
    });
  },
);

test(
  "a wrong backend key is refused on every route",
  {
    tag: ["@auth", "@security"],
    annotation: about(
      "A misconfigured backend fails loudly. A wrong key answers 401 BACKEND_KEY_INVALID, a code of its own so it can't pass for the visitor's wrong password, on sign-in, on public routes and on the admin API, with the usual request ID and headers.",
    ),
  },
  async () => {
    const user = await newUser();
    await step("POST /auth/login with the right password and a wrong key", async () => {
      const refused = await signIn(user.email, {
        "x-dopgate-backend-key": "not-the-key",
        "x-dopgate-client-ip": VISITOR_IP,
      });
      expect(refused.status).toBe(401);
      expect(refused.code).toBe("BACKEND_KEY_INVALID");
      expect(refused.body.error.AUTHENTICATION_INVALID).toBeUndefined();
      expect(refused.headers["x-request-id"]).toBeTruthy();
      expect(refused.headers["x-frame-options"]).toBe("DENY");
    });
    await step("GET /auth/methods, a public route, is refused too", async () => {
      const refused = await app.api.get("/auth/methods", {
        headers: { "x-dopgate-backend-key": "not-the-key" },
      });
      expect(refused.status).toBe(401);
      expect(refused.code).toBe("BACKEND_KEY_INVALID");
    });
    await step("GET /health is refused too", async () => {
      const refused = await app.api.get("/health", {
        headers: { "x-dopgate-backend-key": "not-the-key" },
        record: false,
      });
      expect(refused.status).toBe(401);
      expect(refused.code).toBe("BACKEND_KEY_INVALID");
    });
    await step("The service key as the bearer doesn't help when the backend key is wrong", async () => {
      const refused = await app.service.get("/admin/users", {
        headers: { "x-dopgate-backend-key": "not-the-key" },
        record: false,
      });
      expect(refused.status).toBe(401);
      expect(refused.code).toBe("BACKEND_KEY_INVALID");
    });
    await step("An empty key is wrong as well", async () => {
      const refused = await app.api.get("/auth/methods", {
        headers: { "x-dopgate-backend-key": "" },
        record: false,
      });
      expect(refused.status).toBe(401);
      expect(refused.code).toBe("BACKEND_KEY_INVALID");
    });
    await step("The right key on a public route works", async () => {
      const ok = await app.api.get("/auth/methods", {
        headers: { "x-dopgate-backend-key": app.serviceKey },
        record: false,
      });
      expect(ok.status).toBe(200);
    });
  },
);

test(
  "an address that doesn't parse is a 400 when the key is right",
  {
    tag: ["@auth", "@security"],
    annotation: about(
      "With a valid key, X-Dopgate-Client-IP has to be an address. Anything else answers 400 REQUEST_INVALID and signs nobody in, so a bug in the backend can't quietly share one address between all its visitors.",
    ),
  },
  async () => {
    const user = await newUser();
    for (const bad of ["not-an-address", "999.1.1.1", "198.51.100.7, 203.0.113.1", ""]) {
      await step(`POST /auth/login with X-Dopgate-Client-IP "${bad}"`, async () => {
        const refused = await signIn(
          user.email,
          relayHeaders({ "x-dopgate-client-ip": bad }),
        );
        expect(refused.status).toBe(400);
        expect(refused.code).toBe("REQUEST_INVALID");
        expect(refused.body.error.REQUEST_INVALID).toContain("X-Dopgate-Client-IP");
      });
    }
  },
);

test(
  "each visitor address gets its own request budget",
  {
    tag: ["@limits", "@security"],
    annotation: about(
      "Behind a backend, every visitor shares one connection address. With the key and X-Dopgate-Client-IP the per-address limit is counted for the visitor, so one visitor running out of requests doesn't lock out the others. The limit is set to 2 for this test and put back after.",
    ),
  },
  async () => {
    const user = await newUser();
    // Addresses no other test of this file used, so their budgets start empty.
    const first = `2001:db8:${Math.floor(Math.random() * 0xffff).toString(16)}::1`;
    const second = `2001:db8:${Math.floor(Math.random() * 0xffff).toString(16)}::2`;
    const from = (address: string) =>
      relayHeaders({ "x-dopgate-client-ip": address });
    await step("PATCH /admin/settings: limit each address to 2 requests a minute", async () => {
      await app.settings("limits", { ipRequestsPerMinute: 2 });
    });
    try {
      await step("The first visitor signs in twice", async () => {
        for (let attempt = 1; attempt <= 2; attempt++) {
          const ok = await signIn(user.email, from(first));
          expect(ok.status, `attempt ${attempt}`).toBe(200);
        }
      });
      await step("The third request from that visitor is a 429 with Retry-After", async () => {
        const limited = await signIn(user.email, from(first));
        expect(limited.status).toBe(429);
        expect(limited.code).toBe("RATE_LIMITED");
        expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
      });
      await step("A second visitor of the same backend still has the whole budget", async () => {
        const other = await signIn(user.email, from(second));
        expect(other.status).toBe(200);
      });
      await step("The first visitor's address in brackets with a port is the same budget", async () => {
        const same = await signIn(user.email, from(`[${first}]:40000`));
        expect(same.status).toBe(429);
      });
    } finally {
      await app.settings("limits", { ipRequestsPerMinute: 10_000 });
    }
  },
);
