import { about, expect, PASSWORD, ROOT_EMAIL, step, test, useServer } from "../harness/index.ts";

// Its own server: the lockout is per address and lasts 15 minutes, so it
// can't share one with the tests that need the right token to work. It keeps
// the service key, so a backend can name another visitor.
const app = useServer({ root: false, relaxLimits: false });

const ROOT = "/bootstrap/root";

test(
  "five wrong setup tokens lock the address out, even for the right token",
  {
    tag: ["@setup", "@limits", "@security"],
    annotation: about(
      "The setup token can't be guessed by trying: after 5 wrong tokens from one address, every request from it answers 429 RATE_LIMITED with a Retry-After of 15 minutes, the right token included. A visitor on another address, named by a backend, is not locked out.",
    ),
  },
  async () => {
    const setupToken = await app.server.setupToken();
    const attempt = (token: string, headers: Record<string, string> = {}) =>
      app.api.post(
        ROOT,
        { setupToken: token, email: ROOT_EMAIL, password: PASSWORD },
        { headers },
      );
    await step("Five wrong tokens each answer 401 SETUP_TOKEN_INVALID", async () => {
      for (let guess = 1; guess <= 5; guess++) {
        const refused = await attempt(`setup_guess-${guess}`);
        expect(refused.status, `guess ${guess}`).toBe(401);
        expect(refused.code).toBe("SETUP_TOKEN_INVALID");
      }
    });
    const locked = await step("The sixth request, with the right token, is refused", () =>
      attempt(setupToken),
    );
    await step("It is a 429 RATE_LIMITED that says to wait 15 minutes", async () => {
      expect(locked.status).toBe(429);
      expect(locked.code).toBe("RATE_LIMITED");
      expect(locked.headers["retry-after"]).toBe("900");
      expect(locked.body.error.RATE_LIMITED).toContain("15 minutes");
    });
    await step("A wrong token is a 429 as well, not a 401", async () => {
      const refused = await attempt("setup_guess-again");
      expect(refused.status).toBe(429);
    });
    await step("The instance is still not set up", async () => {
      const status = await app.api.get("/bootstrap/status", { record: false });
      expect(status.data.initialized).toBe(false);
    });
    await step("A visitor the backend names on another address still gets in", async () => {
      const created = await attempt(setupToken, {
        "x-dopgate-backend-key": app.serviceKey,
        "x-dopgate-client-ip": "203.0.113.50",
      });
      expect(created.status).toBe(201);
      expect(created.message).toBe("ROOT_CREATED");
    });
    await step("Once root exists the locked address hears 429 no more than before", async () => {
      const refused = await attempt(setupToken);
      expect(refused.status).toBe(429);
    });
  },
);
