import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { about, expect, step, test, useServer } from "../harness/index.ts";
import { freePort } from "../harness/server.ts";

const app = useServer();

// A stand-in server for the health route: it answers the status you give it,
// or never answers.
async function standIn(status: number | "silent") {
  const hits: string[] = [];
  const sockets = new Set<import("node:net").Socket>();
  const server: Server = createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    if (status === "silent") return;
    res.writeHead(status, { "content-type": "application/json" });
    res.end("{}");
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  return {
    port: (server.address() as AddressInfo).port,
    hits,
    close: () =>
      new Promise<void>((done) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => done());
      }),
  };
}

test(
  "healthcheck exits 0 against a healthy server and prints nothing",
  {
    tag: ["@smoke"],
    annotation: about(
      "`dopgate healthcheck --port N` asks the server on this machine for its health route. A healthy answer is exit 0 and no output at all, which is what a container health check wants.",
    ),
  },
  async () => {
    const done = await step("dopgate healthcheck --port <the server's port>", () =>
      app.cliRaw(["healthcheck", "--port", String(app.server.port)]).ok(),
    );
    await step("It printed nothing on either stream", async () => {
      expect(done.stdout).toBe("");
      expect(done.stderr).toBe("");
    });
  },
);

test(
  "healthcheck reads the port from DOPGATE_PORT, and --port wins",
  {
    tag: ["@smoke"],
    annotation: about(
      "Without --port the check uses DOPGATE_PORT, the setting the server itself listens on. With both, the flag decides.",
    ),
  },
  async () => {
    const dead = await freePort();
    await step("DOPGATE_PORT names the running server: exit 0", async () => {
      await app
        .cliRaw(["healthcheck"], { env: { DOPGATE_PORT: String(app.server.port) } })
        .ok();
    });
    await step("DOPGATE_PORT names a port nobody listens on: exit 1", async () => {
      await app.cliRaw(["healthcheck"], { env: { DOPGATE_PORT: String(dead) } }).fails(1);
    });
    await step("--port with the running server beats a dead DOPGATE_PORT: exit 0", async () => {
      await app
        .cliRaw(["healthcheck", "--port", String(app.server.port)], {
          env: { DOPGATE_PORT: String(dead) },
        })
        .ok();
    });
    await step("--port with a dead port beats a good DOPGATE_PORT: exit 1", async () => {
      await app
        .cliRaw(["healthcheck", "--port", String(dead)], {
          env: { DOPGATE_PORT: String(app.server.port) },
        })
        .fails(1);
    });
  },
);

test(
  "healthcheck exits 1 when nothing listens",
  {
    tag: ["@smoke"],
    annotation: about(
      "A server that is down, or not started yet, is unhealthy: exit 1, quickly, with nothing printed.",
    ),
  },
  async () => {
    const port = await freePort();
    const started = Date.now();
    const failed = await step("dopgate healthcheck --port <a free port>", () =>
      app.cliRaw(["healthcheck", "--port", String(port)]).fails(1),
    );
    await step("It fails at once and says nothing", async () => {
      expect(Date.now() - started).toBeLessThan(2_500);
      expect(failed.stdout).toBe("");
      expect(failed.stderr).toBe("");
    });
  },
);

test(
  "healthcheck asks for /api/v1/health on 127.0.0.1 and judges the status",
  {
    tag: ["@smoke"],
    annotation: about(
      "The check sends GET /api/v1/health to loopback. A 2xx answer is healthy. The 503 Dopgate sends while its database is down, and any other failure status, is unhealthy.",
    ),
  },
  async () => {
    const ok = await standIn(200);
    const unavailable = await standIn(503);
    const missing = await standIn(404);
    try {
      await step("A 200 answer is healthy, and the request was GET /api/v1/health", async () => {
        await app.cliRaw(["healthcheck", "--port", String(ok.port)]).ok();
        expect(ok.hits).toEqual(["GET /api/v1/health"]);
      });
      await step("A 503 answer is unhealthy", async () => {
        await app.cliRaw(["healthcheck", "--port", String(unavailable.port)]).fails(1);
        expect(unavailable.hits).toEqual(["GET /api/v1/health"]);
      });
      await step("A 404 answer is unhealthy too", async () => {
        await app.cliRaw(["healthcheck", "--port", String(missing.port)]).fails(1);
      });
    } finally {
      await ok.close();
      await unavailable.close();
      await missing.close();
    }
  },
);

test(
  "healthcheck gives up on a server that never answers after 3 seconds",
  {
    tag: ["@smoke"],
    annotation: about(
      "A hung server must not hang the container's health check. The request times out after 3 seconds and the command exits 1.",
    ),
  },
  async () => {
    const silent = await standIn("silent");
    try {
      const started = Date.now();
      await step("dopgate healthcheck against a server that accepts and never answers", () =>
        app.cliRaw(["healthcheck", "--port", String(silent.port)], { timeoutMs: 20_000 }).fails(1),
      );
      await step("It took about 3 seconds", async () => {
        const took = Date.now() - started;
        expect(took).toBeGreaterThanOrEqual(2_500);
        expect(took).toBeLessThan(10_000);
        expect(silent.hits).toEqual(["GET /api/v1/health"]);
      });
    } finally {
      await silent.close();
    }
  },
);

test(
  "healthcheck refuses a port that isn't one",
  {
    tag: ["@smoke"],
    annotation: about(
      "A port outside 0 to 65535, or text, is a usage error: exit 2 with the reason on standard error, not an unhealthy server.",
    ),
  },
  async () => {
    await step("dopgate healthcheck --port 70000", async () => {
      const refused = await app.cliRaw(["healthcheck", "--port", "70000"]).fails(2);
      expect(refused.stderr).toContain("invalid value '70000' for '--port <PORT>'");
    });
    await step("dopgate healthcheck --port http", async () => {
      const refused = await app.cliRaw(["healthcheck", "--port", "http"]).fails(2);
      expect(refused.stderr).toContain("invalid value 'http' for '--port <PORT>'");
    });
  },
);
