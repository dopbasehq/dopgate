import { claims } from "../harness/helpers.ts";
import {
  LEAKED_PASSWORD,
  PASSWORD,
  about,
  expect,
  step,
  test,
  useServer,
} from "../harness/index.ts";
import {
  DEFAULT_SECTIONS,
  RELAXED_LIMITS,
  eventsOf,
} from "./admin.support.ts";

// The defaults check needs the limits the way a real server has them.
const app = useServer({ relaxLimits: false });

/** Puts every section back to its defaults, with the limits the harness uses. */
async function restore(): Promise<void> {
  await app.service.patch(
    "/admin/settings",
    { ...DEFAULT_SECTIONS, limits: RELAXED_LIMITS },
    { record: false },
  );
}

async function read(): Promise<Record<string, any>> {
  return (await app.service.get("/admin/settings", { record: false })).data;
}

const DEFAULTS = {
  signup: { enabled: true, requireEmailVerification: true, passwordlessSignup: false },
  password: { minLength: 8, rejectLeaked: true },
  tokens: {
    accessTokenMinutes: 15,
    refreshTokenIdleDays: 30,
    sessionAbsoluteDays: 90,
    refreshReuseSeconds: 10,
  },
  limits: {
    codeMinutes: 10,
    codeMaxAttempts: 5,
    codeResendSeconds: 60,
    codesPerHour: 5,
    lockoutAttempts: 5,
    lockoutMinutes: 15,
    ipRequestsPerMinute: 20,
  },
  selfService: {
    agents: false,
    maxAgentsPerUser: 10,
    personalTokens: false,
    maxPersonalTokensPerUser: 10,
  },
  branding: { appName: "Dopgate", logoUrl: null },
};

test(
  "a new server has every section at its documented default",
  {
    tag: ["@settings", "@smoke"],
    annotation: about(
      "GET /admin/settings answers SETTINGS_FETCHED with the signup, password, tokens, limits, selfService, branding and smtp sections. Nothing has been changed yet, so each value is the documented default.",
    ),
  },
  async () => {
    const fetched = await step("GET /admin/settings as a backend", () =>
      app.service.get("/admin/settings"),
    );
    await step("It answers 200 SETTINGS_FETCHED", async () => {
      expect(fetched.status).toBe(200);
      expect(fetched.message).toBe("SETTINGS_FETCHED");
      expect(Object.keys(fetched.data).sort()).toEqual(
        ["branding", "limits", "password", "selfService", "signup", "smtp", "tokens"],
      );
    });
    await step("The sections hold the default values", async () => {
      for (const [section, values] of Object.entries(DEFAULTS)) {
        expect(fetched.data[section], section).toEqual(values);
      }
    });
    await step("smtp has no host and sends to the log", async () => {
      expect(fetched.data.smtp).toEqual({
        host: null,
        port: 587,
        username: null,
        passwordSet: false,
        security: "starttls",
        fromEmail: "no-reply@dopgate.com",
        fromName: null,
        source: "log",
        canStorePassword: true,
      });
    });
  },
);

test(
  "an admin password reset skips the code limits that a user's own request meets",
  {
    tag: ["@settings", "@limits"],
    annotation: about(
      "With the default 60 second wait between codes, a user asking twice for a reset gets RATE_LIMITED the second time. An admin sending resets from the admin API isn't held back by it.",
    ),
  },
  async () => {
    const user = await app.user("limited");
    const api = await app.newApi("forgot");
    await step("POST /auth/password/forgot once is accepted", async () => {
      const first = await api.post("/auth/password/forgot", { email: user.email });
      expect(first.status).toBe(200);
      await app.mail.last(user.email);
    });
    await step("A second request inside the wait is 429 RATE_LIMITED", async () => {
      const second = await api.post("/auth/password/forgot", { email: user.email });
      expect(second.status).toBe(429);
      expect(second.code).toBe("RATE_LIMITED");
      expect(Number(second.headers["retry-after"])).toBeGreaterThan(0);
    });
    await step("The admin reset still sends, twice in a row", async () => {
      const before = await app.mail.count(user.email);
      for (let sent = 1; sent <= 2; sent++) {
        const reset = await app.service.post(`/admin/users/${user.id}/password-reset`);
        expect(reset.status).toBe(200);
        expect(reset.message).toBe("PASSWORD_RESET_SENT");
        await app.mail.last(user.email, { after: before + sent - 1 });
      }
      expect(await app.mail.count(user.email)).toBe(before + 2);
    });
    await step("The code from the admin reset works", async () => {
      const reset = await api.post("/auth/password/reset", {
        email: user.email,
        code: await app.mail.code(user.email),
        newPassword: app.value(),
      });
      expect(reset.status).toBe(200);
    });
    await restore();
  },
);

test(
  "PATCH replaces a whole section and sends the fields it leaves out back to defaults",
  {
    tag: "@settings",
    annotation: about(
      "Sending one field of a section puts the others at their defaults. Sections left out of the request keep their values, and an empty request changes nothing.",
    ),
  },
  async () => {
    await restore();
    await step("PATCH signup and limits with one field changed each", async () => {
      const changed = await app.service.patch("/admin/settings", {
        signup: { enabled: false, requireEmailVerification: false },
        limits: { codeMinutes: 20, codesPerHour: 100, codeResendSeconds: 0, ipRequestsPerMinute: 10_000 },
      });
      expect(changed.status).toBe(200);
      expect(changed.message).toBe("SETTINGS_UPDATED");
      expect(changed.data.signup).toEqual({
        enabled: false,
        requireEmailVerification: false,
        passwordlessSignup: false,
      });
      expect(changed.data.limits).toMatchObject({
        codeMinutes: 20,
        codeMaxAttempts: 5,
        lockoutAttempts: 5,
        lockoutMinutes: 15,
      });
    });
    await step("A second PATCH with one field resets the rest of that section", async () => {
      const again = await app.service.patch("/admin/settings", {
        signup: { passwordlessSignup: true },
      });
      expect(again.data.signup).toEqual({
        enabled: true,
        requireEmailVerification: true,
        passwordlessSignup: true,
      });
    });
    await step("Sections left out kept their values", async () => {
      const current = await read();
      expect(current.limits.codeMinutes).toBe(20);
      expect(current.password).toEqual(DEFAULTS.password);
      expect(current.branding).toEqual(DEFAULTS.branding);
    });
    await step("An empty PATCH changes nothing", async () => {
      const before = await read();
      const empty = await app.service.patch("/admin/settings", {});
      expect(empty.status).toBe(200);
      expect(empty.data).toEqual(before);
    });
    await step("GET returns what PATCH answered", async () => {
      const sent = await app.service.patch("/admin/settings", {
        selfService: { agents: true, maxAgentsPerUser: 3 },
      });
      expect(await read()).toEqual(sent.data);
      expect(sent.data.selfService).toEqual({
        agents: true,
        maxAgentsPerUser: 3,
        personalTokens: false,
        maxPersonalTokensPerUser: 10,
      });
    });
    await restore();
  },
);

type Bad = [label: string, body: Record<string, unknown>];

const OUT_OF_RANGE: [section: string, cases: Bad[]][] = [
  [
    "password",
    [
      ["minLength 7", { password: { minLength: 7 } }],
      ["minLength 129", { password: { minLength: 129 } }],
    ],
  ],
  [
    "tokens",
    [
      ["accessTokenMinutes 0", { tokens: { accessTokenMinutes: 0 } }],
      ["accessTokenMinutes 1441", { tokens: { accessTokenMinutes: 1441 } }],
      ["refreshTokenIdleDays 0", { tokens: { refreshTokenIdleDays: 0 } }],
      ["refreshTokenIdleDays 3651", { tokens: { refreshTokenIdleDays: 3651, sessionAbsoluteDays: 3650 } }],
      ["sessionAbsoluteDays 0", { tokens: { sessionAbsoluteDays: 0 } }],
      ["sessionAbsoluteDays 3651", { tokens: { sessionAbsoluteDays: 3651 } }],
      ["refreshReuseSeconds 61", { tokens: { refreshReuseSeconds: 61 } }],
      [
        "idle longer than absolute",
        { tokens: { refreshTokenIdleDays: 40, sessionAbsoluteDays: 30 } },
      ],
    ],
  ],
  [
    "limits",
    [
      ["codeMinutes 0", { limits: { codeMinutes: 0 } }],
      ["codeMinutes 61", { limits: { codeMinutes: 61 } }],
      ["codeMaxAttempts 0", { limits: { codeMaxAttempts: 0 } }],
      ["codeMaxAttempts 21", { limits: { codeMaxAttempts: 21 } }],
      ["codeResendSeconds 3601", { limits: { codeResendSeconds: 3601 } }],
      ["codesPerHour 0", { limits: { codesPerHour: 0 } }],
      ["codesPerHour 101", { limits: { codesPerHour: 101 } }],
      ["lockoutAttempts 0", { limits: { lockoutAttempts: 0 } }],
      ["lockoutAttempts 101", { limits: { lockoutAttempts: 101 } }],
      ["lockoutMinutes 0", { limits: { lockoutMinutes: 0 } }],
      ["lockoutMinutes 1441", { limits: { lockoutMinutes: 1441 } }],
      ["ipRequestsPerMinute 0", { limits: { ipRequestsPerMinute: 0 } }],
      ["ipRequestsPerMinute 10001", { limits: { ipRequestsPerMinute: 10_001 } }],
    ],
  ],
  [
    "selfService",
    [
      ["maxAgentsPerUser 0", { selfService: { maxAgentsPerUser: 0 } }],
      ["maxAgentsPerUser 1001", { selfService: { maxAgentsPerUser: 1001 } }],
      ["maxPersonalTokensPerUser 0", { selfService: { maxPersonalTokensPerUser: 0 } }],
      ["maxPersonalTokensPerUser 1001", { selfService: { maxPersonalTokensPerUser: 1001 } }],
    ],
  ],
  [
    "branding",
    [
      ["empty appName", { branding: { appName: "" } }],
      ["blank appName", { branding: { appName: "   " } }],
      ["appName over 255 characters", { branding: { appName: "n".repeat(256) } }],
      ["appName with a line break", { branding: { appName: "Two\nLines" } }],
      ["logoUrl with another scheme", { branding: { appName: "A", logoUrl: "ftp://example.com/l.png" } }],
      ["logoUrl that isn't a URL", { branding: { appName: "A", logoUrl: "not a url" } }],
    ],
  ],
];

for (const [section, cases] of OUT_OF_RANGE) {
  test(
    `${section} settings out of range are refused with SETTINGS_INVALID`,
    {
      tag: "@settings",
      annotation: about(
        `Each value outside the documented range for ${section} answers 422 SETTINGS_INVALID, and the stored settings stay as they were.`,
      ),
    },
    async () => {
      await restore();
      const before = await read();
      for (const [label, body] of cases) {
        await step(`PATCH with ${label}`, async () => {
          const refused = await app.service.patch("/admin/settings", body);
          expect(refused.status, label).toBe(422);
          expect(refused.code, label).toBe("SETTINGS_INVALID");
        });
      }
      await step("Nothing was saved", async () => {
        expect(await read()).toEqual(before);
      });
    },
  );
}

test(
  "values at the edge of each range are accepted",
  {
    tag: "@settings",
    annotation: about(
      "The lowest and highest allowed values of every range save, so the documented bounds are exactly the real ones.",
    ),
  },
  async () => {
    await step("PATCH every minimum", async () => {
      const saved = await app.service.patch("/admin/settings", {
        password: { minLength: 8 },
        tokens: { accessTokenMinutes: 1, refreshTokenIdleDays: 1, sessionAbsoluteDays: 1, refreshReuseSeconds: 0 },
        limits: {
          codeMinutes: 1,
          codeMaxAttempts: 1,
          codeResendSeconds: 0,
          codesPerHour: 1,
          lockoutAttempts: 1,
          lockoutMinutes: 1,
          ipRequestsPerMinute: 10_000,
        },
        selfService: { maxAgentsPerUser: 1, maxPersonalTokensPerUser: 1 },
        branding: { appName: "A" },
      });
      expect(saved.status).toBe(200);
      expect(saved.data.tokens.accessTokenMinutes).toBe(1);
      expect(saved.data.limits.codesPerHour).toBe(1);
    });
    await step("PATCH every maximum", async () => {
      const saved = await app.service.patch("/admin/settings", {
        password: { minLength: 128 },
        tokens: { accessTokenMinutes: 1440, refreshTokenIdleDays: 3650, sessionAbsoluteDays: 3650, refreshReuseSeconds: 60 },
        limits: {
          codeMinutes: 60,
          codeMaxAttempts: 20,
          codeResendSeconds: 3600,
          codesPerHour: 100,
          lockoutAttempts: 100,
          lockoutMinutes: 1440,
          ipRequestsPerMinute: 10_000,
        },
        selfService: { maxAgentsPerUser: 1000, maxPersonalTokensPerUser: 1000 },
        branding: { appName: "n".repeat(255), logoUrl: "https://example.com/logo.png" },
      });
      expect(saved.status).toBe(200);
      expect(saved.data.password.minLength).toBe(128);
      expect(saved.data.branding.appName).toHaveLength(255);
    });
    await step("Idle days equal to the session's absolute days is allowed", async () => {
      const saved = await app.service.patch("/admin/settings", {
        tokens: { refreshTokenIdleDays: 45, sessionAbsoluteDays: 45 },
      });
      expect(saved.status).toBe(200);
    });
    await step("A blank logoUrl is stored as null and the app name is trimmed", async () => {
      const saved = await app.service.patch("/admin/settings", {
        branding: { appName: "  Padded  ", logoUrl: "   " },
      });
      expect(saved.data.branding).toEqual({ appName: "Padded", logoUrl: null });
    });
    await restore();
  },
);

test(
  "a value of the wrong type in settings is a REQUEST_INVALID",
  {
    tag: "@settings",
    annotation: about(
      "A negative number, a string where a number goes, or a section that isn't an object is refused before it reaches the range checks.",
    ),
  },
  async () => {
    await restore();
    const before = await read();
    for (const [label, body] of [
      ["a negative minLength", { password: { minLength: -1 } }],
      ["a string minLength", { password: { minLength: "ten" } }],
      ["a section that is a string", { limits: "many" }],
      ["a flag that is a string", { signup: { enabled: "yes" } }],
    ] as [string, Record<string, unknown>][]) {
      await step(`PATCH with ${label}`, async () => {
        const refused = await app.service.patch("/admin/settings", body);
        expect(refused.ok, label).toBe(false);
        expect(refused.code, label).toBe("REQUEST_INVALID");
      });
    }
    await step("Nothing was saved", async () => {
      expect(await read()).toEqual(before);
    });
  },
);

test(
  "accessTokenMinutes changes how long new access tokens last",
  {
    tag: ["@settings", "@tokens"],
    annotation: about(
      "With accessTokenMinutes at 5, a sign-in answers expiresIn 300 and the token's exp is five minutes after iat. Tokens issued before keep their own lifetime.",
    ),
  },
  async () => {
    await restore();
    const user = await app.user("lifetime", { signIn: false });
    const before = await app.userSession(user.email);
    try {
      await step("PATCH tokens.accessTokenMinutes to 5", async () => {
        const saved = await app.service.patch("/admin/settings", {
          tokens: { accessTokenMinutes: 5 },
        });
        expect(saved.data.tokens.accessTokenMinutes).toBe(5);
      });
      await step("The next sign-in expires in 300 seconds", async () => {
        const api = await app.newApi("short");
        const signedIn = await api.signIn("/auth/login", user.email, PASSWORD);
        expect(signedIn.data.expiresIn).toBe(300);
        const token = claims(signedIn.data.accessToken);
        expect(token.exp - token.iat).toBe(300);
      });
      await step("A refresh also uses the new lifetime", async () => {
        const refreshed = await before.api.post("/auth/refresh", {
          refreshToken: before.tokens.refreshToken,
        });
        expect(refreshed.data.expiresIn).toBe(300);
      });
      await step("The token issued earlier lasted 15 minutes", async () => {
        const token = claims(before.tokens.accessToken);
        expect(before.tokens.expiresIn).toBe(900);
        expect(token.exp - token.iat).toBe(900);
      });
    } finally {
      await restore();
    }
  },
);

test(
  "branding appName shows in /auth/methods and in the next email's subject",
  {
    tag: ["@settings", "@templates"],
    annotation: about(
      "Changing branding.appName and logoUrl shows on the public methods route and in the {{app_name}} of the verification email a new sign-up gets.",
    ),
  },
  async () => {
    await restore();
    try {
      await step("GET /auth/methods starts with the default name", async () => {
        const methods = await app.api.get("/auth/methods");
        expect(methods.data.branding).toEqual({ appName: "Dopgate", logoUrl: null });
      });
      await step("PATCH branding", async () => {
        const saved = await app.service.patch("/admin/settings", {
          branding: { appName: "Acme Cloud", logoUrl: "https://example.com/logo.png" },
        });
        expect(saved.status).toBe(200);
      });
      await step("GET /auth/methods shows the new name and logo", async () => {
        const methods = await app.api.get("/auth/methods");
        expect(methods.data.branding).toEqual({
          appName: "Acme Cloud",
          logoUrl: "https://example.com/logo.png",
        });
      });
      await step("A sign-up email carries the new name", async () => {
        const email = app.email("brand");
        const signedUp = await app.api.post("/auth/signup", { email, password: PASSWORD });
        expect(signedUp.status).toBe(201);
        const mail = await app.mail.last(email);
        const code = await app.mail.code(email);
        expect(mail.subject).toBe(`Your Acme Cloud code is ${code}`);
        expect(mail.text).toContain("Acme Cloud");
      });
    } finally {
      await restore();
    }
  },
);

test(
  "password settings decide which new passwords are accepted",
  {
    tag: ["@settings", "@security"],
    annotation: about(
      "Raising minLength makes a shorter password PASSWORD_INVALID at sign-up and in the admin API. Turning rejectLeaked off lets a leaked password through.",
    ),
  },
  async () => {
    await restore();
    try {
      await step("PATCH password.minLength to 12", async () => {
        const saved = await app.service.patch("/admin/settings", {
          password: { minLength: 12 },
        });
        expect(saved.data.password.minLength).toBe(12);
      });
      await step("An 11 character password is refused at sign-up", async () => {
        const refused = await app.api.post("/auth/signup", {
          email: app.email("pw"),
          password: "elevenchars",
        });
        expect(refused.status).toBe(422);
        expect(refused.code).toBe("PASSWORD_INVALID");
      });
      await step("And by POST /admin/users", async () => {
        const refused = await app.service.post("/admin/users", {
          email: app.email("pw"),
          password: "elevenchars",
        });
        expect(refused.code).toBe("PASSWORD_INVALID");
      });
      await step("A 12 character password is accepted", async () => {
        const ok = await app.api.post("/auth/signup", {
          email: app.email("pw"),
          password: "twelve chars",
        });
        expect(ok.status).toBe(201);
      });
      await step("The leaked password is refused while rejectLeaked is on", async () => {
        await restore();
        const refused = await app.api.post("/auth/signup", {
          email: app.email("pw"),
          password: LEAKED_PASSWORD,
        });
        expect(refused.code).toBe("PASSWORD_LEAKED");
      });
      await step("With rejectLeaked off it is accepted", async () => {
        await app.service.patch("/admin/settings", { password: { rejectLeaked: false } });
        const ok = await app.api.post("/auth/signup", {
          email: app.email("pw"),
          password: LEAKED_PASSWORD,
        });
        expect(ok.status).toBe(201);
      });
    } finally {
      await restore();
    }
  },
);

test(
  "signup settings turn sign-up off and relax email verification",
  {
    tag: ["@settings", "@auth"],
    annotation: about(
      "With signup.enabled off, POST /auth/signup answers SIGNUP_DISABLED while an admin can still create users. With requireEmailVerification off, a sign-up is signed in at once.",
    ),
  },
  async () => {
    await restore();
    try {
      await step("signup.enabled false is SIGNUP_DISABLED and shows in /auth/methods", async () => {
        await app.service.patch("/admin/settings", { signup: { enabled: false } });
        const refused = await app.api.post("/auth/signup", {
          email: app.email("closed"),
          password: PASSWORD,
        });
        expect(refused.status).toBe(403);
        expect(refused.code).toBe("SIGNUP_DISABLED");
        const methods = await app.api.get("/auth/methods");
        expect(methods.data.signupEnabled).toBe(false);
      });
      await step("An admin can still create an account", async () => {
        const created = await app.service.post("/admin/users", {
          email: app.email("invited"),
          password: PASSWORD,
        });
        expect(created.status).toBe(201);
      });
      await step("requireEmailVerification false signs the new user in", async () => {
        await app.service.patch("/admin/settings", {
          signup: { requireEmailVerification: false },
        });
        const email = app.email("open");
        const signedUp = await app.api.post("/auth/signup", { email, password: PASSWORD });
        expect(signedUp.status).toBe(201);
        expect(signedUp.data.verificationRequired).toBe(false);
        expect(signedUp.data.tokens.accessToken).toEqual(expect.any(String));
        const methods = await app.api.get("/auth/methods");
        expect(methods.data.emailVerificationRequired).toBe(false);
      });
      await step("With it on, sign-up gives no tokens and waits for the code", async () => {
        await restore();
        const email = app.email("waits");
        const signedUp = await app.api.post("/auth/signup", { email, password: PASSWORD });
        expect(signedUp.data.verificationRequired).toBe(true);
        expect(signedUp.data.tokens).toBeNull();
        expect((await app.api.get("/auth/methods")).data.emailVerificationRequired).toBe(true);
      });
      await step("passwordlessSignup lets a login code create the account", async () => {
        await app.service.patch("/admin/settings", { signup: { passwordlessSignup: true } });
        const email = app.email("nopass");
        const api = await app.newApi("nopass");
        await api.post("/auth/verification/send", { email, purpose: "login" });
        const confirmed = await api.post("/auth/verification/confirm", {
          email,
          purpose: "login",
          code: await app.mail.code(email),
        });
        expect(confirmed.status).toBe(200);
        expect(confirmed.data.user).toMatchObject({ email, hasPassword: false, emailVerified: true });
      });
    } finally {
      await restore();
    }
  },
);

test(
  "limits settings change lockout and the refresh reuse window",
  {
    tag: ["@settings", "@limits"],
    annotation: about(
      "lockoutAttempts of 2 locks an account after two wrong passwords, and the admin view shows lockedUntil. refreshReuseSeconds of 0 makes a repeated refresh token end the session.",
    ),
  },
  async () => {
    await restore();
    try {
      await app.service.patch("/admin/settings", {
        limits: { ...RELAXED_LIMITS, lockoutAttempts: 2, lockoutMinutes: 5 },
        tokens: { refreshReuseSeconds: 0 },
      });
      const user = await app.user("lockme");
      await step("Two wrong passwords lock the account", async () => {
        const api = await app.newApi("lockme");
        for (let attempt = 0; attempt < 2; attempt++) {
          expect((await api.signIn("/auth/login", user.email, "wrong password")).code).toBe(
            "AUTHENTICATION_INVALID",
          );
        }
        const locked = await app.service.get(`/admin/users/${user.id}`);
        const until = Date.parse(locked.data.lockedUntil);
        expect(until).toBeGreaterThan(Date.now() + 3 * 60_000);
        expect(until).toBeLessThan(Date.now() + 6 * 60_000);
      });
      await step("The right password is refused while it is locked", async () => {
        const api = await app.newApi("lockme");
        const refused = await api.signIn("/auth/login", user.email, PASSWORD);
        expect(refused.status).toBe(401);
        expect(refused.code).toBe("AUTHENTICATION_INVALID");
      });
      await step("A repeated refresh token ends the session when reuse is 0", async () => {
        const other = await app.user("reuse");
        const first = await other.api.post("/auth/refresh", {
          refreshToken: other.tokens!.refreshToken,
        });
        expect(first.status).toBe(200);
        const again = await other.api.post("/auth/refresh", {
          refreshToken: other.tokens!.refreshToken,
        });
        expect(again.status).toBe(401);
        expect(again.code).toBe("TOKEN_INVALID");
      });
    } finally {
      await restore();
    }
  },
);

test(
  "ipRequestsPerMinute and codesPerHour answer 429 RATE_LIMITED when passed",
  {
    tag: ["@settings", "@limits"],
    annotation: about(
      "With ipRequestsPerMinute at 3, a fourth sign-in attempt from the same address is 429 with a Retry-After header. With codesPerHour at 2, a third emailed code for one email is refused.",
    ),
  },
  async () => {
    await restore();
    try {
      await app.service.patch("/admin/settings", {
        limits: { ...RELAXED_LIMITS, ipRequestsPerMinute: 3, codesPerHour: 2 },
      });
      await step("Three sign-ins from one address pass, the fourth is limited", async () => {
        // The service key vouches for a made-up visitor address, so the
        // count belongs to that address alone.
        const headers = {
          "X-Dopgate-Backend-Key": app.serviceKey,
          "X-Dopgate-Client-IP": "198.51.100.23",
        };
        for (let attempt = 0; attempt < 3; attempt++) {
          const wrong = await app.api.post(
            "/auth/login",
            { email: app.email("nobody"), password: "wrong password" },
            { headers },
          );
          expect(wrong.code).toBe("AUTHENTICATION_INVALID");
        }
        const limited = await app.api.post(
          "/auth/login",
          { email: app.email("nobody"), password: "wrong password" },
          { headers },
        );
        expect(limited.status).toBe(429);
        expect(limited.code).toBe("RATE_LIMITED");
        expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
      });
      await step("A different address has its own budget", async () => {
        const other = await app.api.post(
          "/auth/login",
          { email: app.email("nobody"), password: "wrong password" },
          {
            headers: {
              "X-Dopgate-Backend-Key": app.serviceKey,
              "X-Dopgate-Client-IP": "198.51.100.24",
            },
          },
        );
        expect(other.code).toBe("AUTHENTICATION_INVALID");
      });
      await step("A third code for one email in an hour is refused", async () => {
        await app.service.patch("/admin/settings", {
          limits: { ...RELAXED_LIMITS, ipRequestsPerMinute: 10_000, codesPerHour: 2 },
        });
        const email = app.email("flood");
        const api = await app.newApi("flood");
        for (let attempt = 0; attempt < 2; attempt++) {
          expect((await api.post("/auth/verification/send", { email, purpose: "email_verify" })).status).toBe(200);
        }
        const refused = await api.post("/auth/verification/send", { email, purpose: "email_verify" });
        expect(refused.status).toBe(429);
        expect(refused.code).toBe("RATE_LIMITED");
      });
    } finally {
      await restore();
    }
  },
);

test(
  "selfService settings switch personal tokens on and cap how many a user holds",
  {
    tag: ["@settings", "@tokens"],
    annotation: about(
      "Personal tokens are off by default, so creating one is FEATURE_DISABLED. Turned on, a user can make tokens up to maxPersonalTokensPerUser, then gets LIMIT_REACHED.",
    ),
  },
  async () => {
    await restore();
    const user = await app.user("selfservice");
    try {
      await step("POST /auth/personal-tokens is FEATURE_DISABLED by default", async () => {
        const refused = await user.api.post("/auth/personal-tokens", { name: "first" });
        expect(refused.status).toBe(403);
        expect(refused.code).toBe("FEATURE_DISABLED");
      });
      await step("With personalTokens on and a cap of 1, the first is created", async () => {
        await app.service.patch("/admin/settings", {
          selfService: { personalTokens: true, maxPersonalTokensPerUser: 1 },
        });
        const created = await user.api.post("/auth/personal-tokens", { name: "first" });
        expect(created.status).toBe(201);
      });
      await step("The second is LIMIT_REACHED", async () => {
        const refused = await user.api.post("/auth/personal-tokens", { name: "second" });
        expect(refused.status).toBe(409);
        expect(refused.code).toBe("LIMIT_REACHED");
      });
    } finally {
      await restore();
    }
  },
);

test(
  "a settings change is written to the audit log with its sections",
  {
    tag: ["@settings", "@audit"],
    annotation: about(
      "Each PATCH that saves something records settings.updated with who changed it and which sections. An empty PATCH records nothing.",
    ),
  },
  async () => {
    await restore();
    const root = await app.root();
    const count = async () => (await eventsOf(app.service, "settings.updated")).length;
    const before = await count();
    await step("PATCH signup and branding as root", async () => {
      const saved = await root.api.patch("/admin/settings", {
        signup: { enabled: true },
        branding: { appName: "Audited" },
      });
      expect(saved.status).toBe(200);
    });
    await step("The newest settings.updated names root and both sections", async () => {
      const [event] = await eventsOf(app.service, "settings.updated");
      expect(event).toMatchObject({
        actorType: "root",
        actorId: root.id,
        actorLabel: root.email,
        resourceType: "settings",
        metadata: { sections: ["signup", "branding"] },
      });
    });
    await step("The service key shows up as the actor of its own change", async () => {
      await app.service.patch("/admin/settings", { limits: RELAXED_LIMITS });
      const [event] = await eventsOf(app.service, "settings.updated");
      expect(event).toMatchObject({
        actorType: "service",
        actorLabel: "service",
        metadata: { sections: ["limits"] },
      });
    });
    await step("An empty PATCH adds no event", async () => {
      const total = await count();
      await app.service.patch("/admin/settings", {});
      expect(await count()).toBe(total);
      expect(total).toBe(before + 2);
    });
    await step("A refused PATCH adds no event either", async () => {
      const total = await count();
      await app.service.patch("/admin/settings", { password: { minLength: 1 } });
      expect(await count()).toBe(total);
    });
    await restore();
  },
);

test(
  "only admins and the service key read or change settings",
  {
    tag: ["@settings", "@security"],
    annotation: about(
      "No token is 401, a user's token is 403, and an admin who isn't root can read and change settings.",
    ),
  },
  async () => {
    await restore();
    const user = await app.user("nosy");
    await step("Without a token GET and PATCH are 401", async () => {
      for (const result of [
        await app.api.get("/admin/settings"),
        await app.api.patch("/admin/settings", { signup: { enabled: false } }),
      ]) {
        expect(result.status).toBe(401);
        expect(result.code).toBe("AUTHENTICATION_REQUIRED");
      }
    });
    await step("With a user's token GET and PATCH are 403", async () => {
      for (const result of [
        await user.api.get("/admin/settings"),
        await user.api.patch("/admin/settings", { signup: { enabled: false } }),
        await user.api.post("/admin/settings/smtp/test", { to: user.email }),
      ]) {
        expect(result.status).toBe(403);
        expect(result.code).toBe("AUTHORIZATION_DENIED");
      }
    });
    await step("Nothing changed", async () => {
      expect((await read()).signup.enabled).toBe(true);
    });
    await step("An admin who isn't root changes a setting", async () => {
      const sam = await app.admin("sam");
      const saved = await sam.api.patch("/admin/settings", { signup: { enabled: true, passwordlessSignup: true } });
      expect(saved.status).toBe(200);
      const [event] = await eventsOf(app.service, "settings.updated");
      expect(event).toMatchObject({ actorType: "admin", actorLabel: sam.email });
    });
    await restore();
  },
);
