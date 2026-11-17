import { readFileSync } from "node:fs";
import { about, expect, step, test, useServer } from "../harness/index.ts";

const app = useServer();
const pkg = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as { version: string };

test(
  "health names the product, its version and the database",
  {
    tag: "@smoke",
    annotation: about(
      "The health route answers without signing in. It says which product and version is running and whether the database answers, which is what the container health check reads.",
    ),
  },
  async () => {
    const health = await step("GET /health with no credentials", () =>
      app.api.get("/health"),
    );
    await step("It answers 200 in the standard envelope", async () => {
      expect(health.status).toBe(200);
      expect(health.body).toMatchObject({
        success: true,
        message: "HEALTH_OK",
      });
    });
    await step("It reports dopgate, its version and a working database", async () => {
      expect(health.data).toEqual({
        product: "dopgate",
        version: pkg.version,
        apiVersion: "v1",
        status: "ok",
        database: "ok",
      });
    });
  },
);
