import {
  about,
  expect,
  PASSWORD,
  step,
  test,
  useServer,
} from "../harness/index.ts";
import { query } from "../harness/server.ts";
import { withSettings } from "./auth.support.ts";

// The defaults apply here: 20 requests a minute per address, 60 seconds
// between codes of one purpose, 5 codes an hour. Each test lowers what it
// needs through settings and calls from an address of its own, which a
// backend may name next to the service key.
const app = useServer({ relaxLimits: false });

let nextVisitor = 10;
/** Headers that make a call count against a visitor address nobody else uses. */
function visitor(): Record<string, string> {
  return {
    "X-Dopgate-Backend-Key": app.serviceKey,
    "X-Dopgate-Client-IP": `203.0.113.${nextVisitor++}`,
  };
}

/** A user who is not signed in, so setup does not spend any budget. */
function newUser(name: string, options: { verified?: boolean; password?: boolean } = {}) {
  return app.user(name, { signIn: false, ...options });
}

test(
  "the per-address limit answers 429 with Retry-After once the budget is spent",
  {
    tag: ["@auth", "@limits", "@security"],
    annotation: about(
      "Sign-in, sign-up, code and password reset routes share one budget per client address. Past limits.ipRequestsPerMinute the route answers 429 RATE_LIMITED with a Retry-After header, even for a request that would have succeeded. Other addresses and routes outside the group are not affected.",
    ),
  },
  async () => {
    const user = await newUser("busy");
    await withSettings(app, "limits", { ipRequestsPerMinute: 3 }, async () => {
      const headers = visitor();
      const login = (password: string) =>
        app.api.post("/auth/login", { email: user.email, password }, { headers });
      await step("Three requests from one address are answered normally", async () => {
        expect((await login("wrong password")).status).toBe(401);
        expect((await login("wrong password")).status).toBe(401);
        expect((await login(PASSWORD)).status).toBe(200);
      });
      const limited = await step("The fourth POST /auth/login is refused", () => login(PASSWORD));
      await step("It answers 429 RATE_LIMITED with a Retry-After in seconds", async () => {
        expect(limited.status).toBe(429);
        expect(limited.code).toBe("RATE_LIMITED");
        expect(limited.body.error.RATE_LIMITED).toMatch(/^Too many attempts\. Try again in \d+ seconds?\.$/);
        const wait = Number(limited.headers["retry-after"]);
        expect(Number.isInteger(wait)).toBe(true);
        expect(wait).toBeGreaterThan(0);
        expect(wait).toBeLessThanOrEqual(60);
      });
      await step("Other routes of the group share the same spent budget", async () => {
        const email = app.email("blocked");
        const routes: [string, Record<string, unknown>][] = [
          ["/auth/signup", { email, password: PASSWORD }],
          ["/auth/verification/send", { email, purpose: "login" }],
          ["/auth/verification/confirm", { email, purpose: "login", code: "123456" }],
          ["/auth/password/forgot", { email }],
          ["/auth/password/reset", { email, code: "123456", newPassword: PASSWORD }],
        ];
        for (const [path, body] of routes) {
          const result = await app.api.post(path, body, { headers });
          expect([path, result.status, result.code]).toEqual([path, 429, "RATE_LIMITED"]);
          expect(result.headers["retry-after"]).toBeDefined();
        }
      });
      await step("Routes outside the group still answer", async () => {
        expect((await app.api.get("/auth/methods", { headers })).status).toBe(200);
        expect((await app.api.get("/health", { headers })).status).toBe(200);
        expect((await app.api.get("/auth/me", { headers })).status).toBe(401);
      });
      await step("Another address has its own budget", async () => {
        const other = await app.api.post(
          "/auth/login",
          { email: user.email, password: PASSWORD },
          { headers: visitor() },
        );
        expect(other.status).toBe(200);
      });
    });
    await step("The setting is back at 20", async () => {
      const settings = await app.service.get("/admin/settings", { record: false });
      expect(settings.data.limits.ipRequestsPerMinute).toBe(20);
    });
  },
);

test(
  "a visitor address is only believed when the service key comes with it",
  {
    tag: ["@auth", "@limits", "@security"],
    annotation: about(
      "A backend names the visitor in X-Dopgate-Client-IP, next to X-Dopgate-Backend-Key. Without the key the header is ignored, so a browser cannot pick the address its limit is counted against. A wrong key answers 401 BACKEND_KEY_INVALID and a bad address 400.",
    ),
  },
  async () => {
    await withSettings(app, "limits", { ipRequestsPerMinute: 2 }, async () => {
      await step("The header alone is ignored: new addresses share one budget", async () => {
        const send = (ip: string) =>
          app.api.post(
            "/auth/login",
            { email: app.email("nobody"), password: PASSWORD },
            { headers: { "X-Dopgate-Client-IP": ip } },
          );
        expect((await send("198.51.100.1")).status).toBe(401);
        expect((await send("198.51.100.2")).status).toBe(401);
        const third = await send("198.51.100.3");
        expect(third.status).toBe(429);
        expect(third.code).toBe("RATE_LIMITED");
      });
      await step("With the key each visitor address has a budget of its own", async () => {
        for (let visitorIndex = 0; visitorIndex < 2; visitorIndex++) {
          const headers = visitor();
          for (let i = 0; i < 2; i++) {
            const result = await app.api.post(
              "/auth/login",
              { email: app.email("nobody"), password: PASSWORD },
              { headers },
            );
            expect(result.status).toBe(401);
          }
          const limited = await app.api.post(
            "/auth/login",
            { email: app.email("nobody"), password: PASSWORD },
            { headers },
          );
          expect(limited.status).toBe(429);
        }
      });
      await step("A wrong backend key is 401 BACKEND_KEY_INVALID", async () => {
        const result = await app.api.get("/auth/methods", {
          headers: { "X-Dopgate-Backend-Key": "e2e_not_the_key", "X-Dopgate-Client-IP": "203.0.113.200" },
        });
        expect(result.status).toBe(401);
        expect(result.code).toBe("BACKEND_KEY_INVALID");
      });
      await step("An address that does not parse is 400 REQUEST_INVALID", async () => {
        const result = await app.api.get("/auth/methods", {
          headers: { "X-Dopgate-Backend-Key": app.serviceKey, "X-Dopgate-Client-IP": "not-an-address" },
        });
        expect(result.status).toBe(400);
        expect(result.code).toBe("REQUEST_INVALID");
      });
    });
  },
);

test(
  "a second code of the same purpose has to wait, and the answer is the same for every email",
  {
    tag: ["@auth", "@limits", "@security"],
    annotation: about(
      "One email gets one code per purpose every limits.codeResendSeconds. The first answer says how long that is in retryAfter. A second request inside that time answers 429 RATE_LIMITED with Retry-After. A known and an unknown email behave the same, so the limit cannot be used to find accounts.",
    ),
  },
  async () => {
    const known = await newUser("known");
    const unknown = app.email("ghost");
    const headers = visitor();
    const send = (email: string, purpose = "login") =>
      app.api.post("/auth/verification/send", { email, purpose }, { headers });
    await step("The first login code for each email answers 200 CODE_SENT with the wait", async () => {
      for (const email of [known.email, unknown]) {
        const result = await send(email);
        expect([result.status, result.message]).toEqual([200, "CODE_SENT"]);
        expect(result.data).toEqual({ retryAfter: 60 });
      }
      await app.mail.code(known.email);
    });
    const knownAgain = await step("A second login code for the known email is refused", () => send(known.email));
    const unknownAgain = await step("A second login code for the unknown email is refused", () => send(unknown));
    await step("Both answer 429 RATE_LIMITED with a Retry-After of at most 60 seconds", async () => {
      for (const result of [knownAgain, unknownAgain]) {
        expect(result.status).toBe(429);
        expect(result.code).toBe("RATE_LIMITED");
        const wait = Number(result.headers["retry-after"]);
        expect(wait).toBeGreaterThan(0);
        expect(wait).toBeLessThanOrEqual(60);
      }
      expect(Object.keys(knownAgain.body.error)).toEqual(Object.keys(unknownAgain.body.error));
    });
    await step("No second message went out", async () => {
      expect(await app.mail.count(known.email)).toBe(1);
      expect(await app.mail.count(unknown)).toBe(0);
    });
    await step("The wait is per purpose: an email_verify code is still allowed", async () => {
      const pending = await newUser("pending", { verified: false });
      expect((await send(pending.email, "email_verify")).status).toBe(200);
      expect((await send(pending.email, "email_verify")).status).toBe(429);
      expect((await send(pending.email, "login")).status).toBe(200);
      await app.mail.code(pending.email);
    });
    await step("Password reset has its own wait", async () => {
      const forgot = () => app.api.post("/auth/password/forgot", { email: known.email }, { headers });
      expect((await forgot()).status).toBe(200);
      const again = await forgot();
      expect(again.status).toBe(429);
      expect(again.headers["retry-after"]).toBeDefined();
      const ghost = await app.api.post("/auth/password/forgot", { email: unknown }, { headers });
      expect(ghost.status).toBe(200);
      expect((await app.api.post("/auth/password/forgot", { email: unknown }, { headers })).status).toBe(429);
    });
    await step("A two-second wait lets the next code through once it has passed", async () => {
      const patient = await newUser("patient");
      await withSettings(app, "limits", { codeResendSeconds: 2 }, async () => {
        const first = await send(patient.email);
        expect(first.status).toBe(200);
        const early = await send(patient.email);
        expect(early.status).toBe(429);
        expect(Number(early.headers["retry-after"])).toBeLessThanOrEqual(2);
        await expect
          .poll(
            // Each poll comes from a new address, so the per-address budget stays out of it.
            async () =>
              (
                await app.api.post(
                  "/auth/verification/send",
                  { email: patient.email, purpose: "login" },
                  { headers: visitor() },
                )
              ).status,
            { intervals: [300], timeout: 8000 },
          )
          .toBe(200);
        expect(await app.mail.count(patient.email)).toBeGreaterThanOrEqual(2);
      });
    });
  },
);

test(
  "the hourly cap counts codes of every purpose for one email",
  {
    tag: ["@auth", "@limits"],
    annotation: about(
      "With the wait turned off, one email can still only get limits.codesPerHour codes an hour, all purposes together. Past that every code route answers 429 RATE_LIMITED. A known and an unknown email are capped the same way, and another email is not affected.",
    ),
  },
  async () => {
    const known = await newUser("capped");
    const other = await newUser("free");
    const unknown = app.email("ghost");
    await withSettings(app, "limits", { codeResendSeconds: 0, codesPerHour: 2 }, async () => {
      const headers = visitor();
      const ask = (path: string, body: Record<string, unknown>) => app.api.post(path, body, { headers });
      await step("A login code and a reset code use up the hour", async () => {
        const first = await ask("/auth/verification/send", { email: known.email, purpose: "login" });
        const second = await ask("/auth/password/forgot", { email: known.email });
        expect([first.status, second.status]).toEqual([200, 200]);
        await app.mail.last(known.email, { after: 1 });
      });
      const refused = await step("A third code, of another purpose, is refused", () =>
        ask("/auth/verification/send", { email: known.email, purpose: "email_verify" }),
      );
      await step("It answers 429 RATE_LIMITED with a Retry-After", async () => {
        expect(refused.status).toBe(429);
        expect(refused.code).toBe("RATE_LIMITED");
        expect(Number(refused.headers["retry-after"])).toBeGreaterThan(0);
      });
      await step("So are the login and reset routes", async () => {
        const login = await ask("/auth/verification/send", { email: known.email, purpose: "login" });
        const forgot = await ask("/auth/password/forgot", { email: known.email });
        expect([login.status, forgot.status]).toEqual([429, 429]);
        expect(await app.mail.count(known.email)).toBe(2);
      });
      await step("An unknown email is capped at the same point", async () => {
        const results = [
          await ask("/auth/verification/send", { email: unknown, purpose: "login" }),
          await ask("/auth/password/forgot", { email: unknown }),
          await ask("/auth/verification/send", { email: unknown, purpose: "login" }),
        ];
        expect(results.map((result) => result.status)).toEqual([200, 200, 429]);
        expect(await app.mail.count(unknown)).toBe(0);
      });
      await step("Another email is not affected", async () => {
        const result = await ask("/auth/verification/send", { email: other.email, purpose: "login" });
        expect(result.status).toBe(200);
        await app.mail.code(other.email);
      });
    });
  },
);

test(
  "an email change is limited per new address and by the address budget",
  {
    tag: ["@auth", "@limits", "@security"],
    annotation: about(
      "The code for an email change goes to the new address, so the hourly cap counts against that address. A wrong password on the change, and on a password change, also spends the per-address budget.",
    ),
  },
  async () => {
    const user = await newUser("mover");
    const headers = visitor();
    const signedIn = await app.api.signIn("/auth/login", user.email, PASSWORD, { headers, record: false });
    expect(signedIn.status).toBe(200);
    const api = await app.newApi("mover", signedIn.data.accessToken);
    await withSettings(app, "limits", { codeResendSeconds: 0, codesPerHour: 2, ipRequestsPerMinute: 6 }, async () => {
      const target = app.email("target");
      const change = (newEmail: string) =>
        api.post("/auth/email/change", { newEmail, password: PASSWORD }, { headers });
      await step("Two codes to the new address are sent", async () => {
        expect((await change(target)).status).toBe(200);
        expect((await change(target)).status).toBe(200);
        await app.mail.last(target, { after: 1 });
      });
      await step("A third code to the same address answers 429 RATE_LIMITED", async () => {
        const result = await change(target);
        expect(result.status).toBe(429);
        expect(result.code).toBe("RATE_LIMITED");
        expect(await app.mail.count(target)).toBe(2);
      });
      await step("A different new address is still allowed", async () => {
        expect((await change(app.email("elsewhere"))).status).toBe(200);
      });
      await step("The address budget of 6 is now spent, wrong passwords included", async () => {
        const wrong = await api.post(
          "/auth/password/change",
          { currentPassword: "wrong", newPassword: "another long passphrase" },
          { headers },
        );
        expect(wrong.status).toBe(401);
        const spent = await api.post(
          "/auth/password/change",
          { currentPassword: "wrong", newPassword: "another long passphrase" },
          { headers },
        );
        expect(spent.status).toBe(429);
        expect(spent.code).toBe("RATE_LIMITED");
      });
    });
  },
);

test(
  "the code lifetime and the number of tries follow the settings",
  {
    tag: ["@auth", "@limits", "@settings"],
    annotation: about(
      "limits.codeMinutes sets how long a code lives, and limits.codeMaxAttempts how many wrong tries it allows. The stored expiry matches, and the wrong-try message counts from the new number.",
    ),
  },
  async () => {
    const user = await newUser("timed", { verified: false });
    await withSettings(app, "limits", { codeResendSeconds: 0, codeMinutes: 1, codeMaxAttempts: 3 }, async () => {
      const headers = visitor();
      await step("POST /auth/verification/send with a 1-minute lifetime", async () => {
        const result = await app.api.post(
          "/auth/verification/send",
          { email: user.email, purpose: "email_verify" },
          { headers },
        );
        expect(result.status).toBe(200);
        await app.mail.code(user.email);
      });
      await step("The mail says one minute and the stored code lives 60 seconds", async () => {
        const mail = await app.mail.last(user.email);
        expect(mail.text).toMatch(/expires in 1 minute/);
        const rows = await query<{ lifetime: number }>(
          app.server.schema,
          "SELECT EXTRACT(EPOCH FROM expires_at - created_at)::int AS lifetime FROM verification_tokens WHERE email = $1",
          [user.email],
        );
        expect(rows.at(-1)?.lifetime).toBe(60);
      });
      await step("A wrong try leaves two of three", async () => {
        const code = await app.mail.code(user.email);
        const wrong = code === "000000" ? "111111" : "000000";
        const result = await app.api.post(
          "/auth/verification/confirm",
          { email: user.email, purpose: "email_verify", code: wrong },
          { headers },
        );
        expect(result.body.error.CODE_INVALID).toBe("That code is wrong. 2 tries left.");
      });
    });
  },
);
