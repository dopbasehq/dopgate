import { about, expect, PASSWORD, step, test, useServer } from "../harness/index.ts";
import { query } from "../harness/server.ts";
import { consoleSignInOn, instanceEnv, tempFolder, withSchema, writeIn } from "./support.ts";

// The file's own server is only here for app.cli(): every case below runs the
// binary against a schema of its own, so each one starts without a root.
const app = useServer();

const lastLine = (text: string) => text.trim().split("\n").at(-1) ?? "";

test(
  "init creates the root account from an email and a password on standard input",
  {
    tag: ["@smoke", "@setup"],
    annotation: about(
      "`dopgate init --email … --password-stdin` creates the schema, runs the migrations and makes the root account. The email is lowercased and trimmed, the password's trailing newline is dropped, and the output says what to do next.",
    ),
  },
  async () => {
    await withSchema(async (schema, env) => {
      const done = await step("dopgate init --email ' Root@Example.COM ' --password-stdin", () =>
        app
          .cli(["init", "--email", " Root@Example.COM ", "--password-stdin"], {
            env,
            stdin: `${PASSWORD}\r\n`,
          })
          .ok(),
      );
      await step("It says root was created for the lowercase email and what to run next", async () => {
        expect(done.stdout).toContain("✓ Root account created for root@example.com.");
        expect(done.stdout).toContain("Start the server with `dopgate serve`.");
      });
      await step("The password never reaches the output", async () => {
        expect(done.stdout + done.stderr).not.toContain(PASSWORD);
      });
      await step("The root can sign in on a server started on that schema", async () => {
        const result = await consoleSignInOn(schema, "root@example.com", PASSWORD);
        expect(result.signedIn.status).toBe(200);
        expect(result.signedIn.data.admin).toMatchObject({
          email: "root@example.com",
          role: "root",
        });
      });
    });
  },
);

test(
  "init reads the password from DOPGATE_ROOT_PASSWORD, which wins over standard input",
  {
    tag: ["@setup"],
    annotation: about(
      "The password comes from DOPGATE_ROOT_PASSWORD first. With both set, standard input is ignored, so the password in the environment is the one that works.",
    ),
  },
  async () => {
    await withSchema(async (schema, env) => {
      const fromEnv = "password-from-the-environment";
      await step("dopgate init with the environment password and a different one on stdin", async () => {
        await app
          .cli(["init", "--email", "owner@example.com", "--password-stdin"], {
            env: { ...env, DOPGATE_ROOT_PASSWORD: fromEnv },
            stdin: "password-from-stdin\n",
          })
          .ok();
      });
      await step("The environment password signs root in", async () => {
        const result = await consoleSignInOn(schema, "owner@example.com", fromEnv);
        expect(result.signedIn.status).toBe(200);
      });
    });
  },
);

test(
  "init takes the email from DOPGATE_ROOT_EMAIL when no flag is given",
  {
    tag: ["@setup"],
    annotation: about(
      "DOPGATE_ROOT_EMAIL is the default for --email, so a container can run `dopgate init` with nothing but its environment. The email is lowercased.",
    ),
  },
  async () => {
    await withSchema(async (schema, env) => {
      const done = await step("dopgate init with DOPGATE_ROOT_EMAIL and DOPGATE_ROOT_PASSWORD", () =>
        app
          .cli(["init"], {
            env: {
              ...env,
              DOPGATE_ROOT_EMAIL: "Env.Owner@Example.com",
              DOPGATE_ROOT_PASSWORD: PASSWORD,
            },
          })
          .ok(),
      );
      await step("Root exists under the lowercase email", async () => {
        expect(done.stdout).toContain("Root account created for env.owner@example.com.");
        const rows = await query<{ email: string; role: string }>(
          schema,
          "SELECT email, role FROM admins",
        );
        expect(rows).toEqual([{ email: "env.owner@example.com", role: "root" }]);
      });
    });
  },
);

test(
  "init --json prints the account it made",
  {
    tag: ["@setup"],
    annotation: about(
      "With --json the answer is one JSON line on standard output: success, the new admin's ID, the clean email and the schema it was made in. Nothing else is printed there.",
    ),
  },
  async () => {
    await withSchema(async (schema, env) => {
      const body = await step("dopgate --json init --email ' Json@Example.COM '", () =>
        app
          .cli(["--json", "init", "--email", " Json@Example.COM "], {
            env: { ...env, DOPGATE_ROOT_PASSWORD: PASSWORD },
          })
          .json(),
      );
      await step("It has adminId, email and schema, and nothing more", async () => {
        expect(body).toEqual({
          success: true,
          data: {
            adminId: expect.stringMatching(/^adm_/),
            email: "json@example.com",
            schema,
          },
        });
      });
      await step("The admin ID is the one in the database", async () => {
        const rows = await query<{ id: string }>(schema, "SELECT id FROM admins");
        expect(rows.map((row) => row.id)).toEqual([body.data.adminId]);
      });
    });
  },
);

test(
  "init records the setup in the audit log and the server needs no setup token",
  {
    tag: ["@setup", "@audit"],
    annotation: about(
      "Creating root from the command line leaves the same instance.initialized audit event as the setup page. A server started afterwards counts the instance as set up, prints no setup token and has no password in its log.",
    ),
  },
  async () => {
    await withSchema(async (schema, env) => {
      await step("dopgate init", async () => {
        await app
          .cli(["init", "--email", "audit@example.com"], {
            env: { ...env, DOPGATE_ROOT_PASSWORD: PASSWORD },
          })
          .ok();
      });
      const result = await step("Start a server on that schema", () =>
        consoleSignInOn(schema, "audit@example.com", PASSWORD),
      );
      await step("The instance counts as set up and the log offers no token", async () => {
        expect(result.initialized).toBe(true);
        expect(result.log).not.toContain("No root account yet.");
        expect(result.log).not.toContain(PASSWORD);
      });
      await step("The audit log has one instance.initialized event by the system", async () => {
        expect(result.setupEvents).toHaveLength(1);
        expect(result.setupEvents[0]).toMatchObject({
          actorType: "system",
          actorLabel: "setup",
          metadata: { email: "audit@example.com" },
        });
      });
    });
  },
);

test(
  "a second init refuses and leaves the first root alone",
  {
    tag: ["@setup"],
    annotation: about(
      "An instance has one root. A second `dopgate init` exits 1 and names the schema, in plain text or as a CLI_ERROR with --json, and the first account's email and password still work.",
    ),
  },
  async () => {
    await withSchema(async (schema, env) => {
      await step("dopgate init makes the first root", async () => {
        await app
          .cli(["init", "--email", "first@example.com"], {
            env: { ...env, DOPGATE_ROOT_PASSWORD: PASSWORD },
          })
          .ok();
      });
      await step("dopgate init again exits 1 and says the instance has a root", async () => {
        const again = await app
          .cli(["init", "--email", "second@example.com"], {
            env: { ...env, DOPGATE_ROOT_PASSWORD: "another long password" },
          })
          .fails(1);
        expect(again.stderr).toContain(`Error: this instance already has a root account (schema ${schema})`);
        expect(again.stdout).toBe("");
      });
      await step("With --json the error is a CLI_ERROR on standard error", async () => {
        const again = await app
          .cli(["--json", "init", "--email", "second@example.com"], {
            env: { ...env, DOPGATE_ROOT_PASSWORD: "another long password" },
          })
          .fails(1);
        expect(JSON.parse(lastLine(again.stderr))).toEqual({
          success: false,
          error: {
            CLI_ERROR: `this instance already has a root account (schema ${schema})`,
          },
        });
        expect(again.stdout).toBe("");
      });
      await step("The first root is still the only admin and its password works", async () => {
        const rows = await query<{ email: string }>(schema, "SELECT email FROM admins");
        expect(rows).toEqual([{ email: "first@example.com" }]);
        const result = await consoleSignInOn(schema, "first@example.com", PASSWORD);
        expect(result.signedIn.status).toBe(200);
      });
    });
  },
);

test(
  "init refuses a bad email or a short password and creates no account",
  {
    tag: ["@setup"],
    annotation: about(
      "The same rules as the setup page apply: an email that isn't an address and a password under 8 characters, or over 1024 bytes, exit 1 with a message that says what to fix. An empty standard input counts as a short password.",
    ),
  },
  async () => {
    await withSchema(async (schema, env) => {
      await step("An email that isn't an address", async () => {
        const refused = await app
          .cli(["init", "--email", "not-an-email"], {
            env: { ...env, DOPGATE_ROOT_PASSWORD: PASSWORD },
          })
          .fails(1);
        expect(refused.stderr).toContain("Error: Enter a valid email address.");
      });
      await step("A password of 5 characters", async () => {
        const refused = await app
          .cli(["init", "--email", "ok@example.com"], {
            env: { ...env, DOPGATE_ROOT_PASSWORD: "short" },
          })
          .fails(1);
        expect(refused.stderr).toContain("Error: Use at least 8 characters.");
      });
      await step("A password over 1024 bytes", async () => {
        const refused = await app
          .cli(["--json", "init", "--email", "ok@example.com"], {
            env: { ...env, DOPGATE_ROOT_PASSWORD: "a".repeat(1025) },
          })
          .fails(1);
        const body = JSON.parse(lastLine(refused.stderr));
        expect(body.success).toBe(false);
        expect(body.error.CLI_ERROR).toEqual(expect.any(String));
      });
      await step("Nothing on standard input with --password-stdin", async () => {
        const refused = await app
          .cli(["--json", "init", "--email", "ok@example.com", "--password-stdin"], {
            env,
            stdin: "",
          })
          .fails(1);
        expect(JSON.parse(lastLine(refused.stderr)).error.CLI_ERROR).toBe(
          "Use at least 8 characters.",
        );
      });
      await step("No account was made", async () => {
        const rows = await query(schema, "SELECT id FROM admins");
        expect(rows).toEqual([]);
      });
    });
  },
);

test(
  "init without an email or a terminal fails instead of waiting",
  {
    tag: ["@setup"],
    annotation: about(
      "With no --email and no DOPGATE_ROOT_EMAIL, init would ask for the email. When there is no terminal to ask on, it exits 1 and says so.",
    ),
  },
  async () => {
    await withSchema(async (_schema, env) => {
      const refused = await step("dopgate init with nothing to go on and no terminal", () =>
        app
          .cli(["init"], { env: { ...env, DOPGATE_ROOT_PASSWORD: PASSWORD }, timeoutMs: 20_000 })
          .fails(1),
      );
      await step("It says the input device is not a terminal", async () => {
        expect(refused.stderr).toContain("The input device is not a TTY");
      });
    });
  },
);

test(
  "init without a usable database fails with a message that names the setting",
  {
    tag: ["@setup"],
    annotation: about(
      "A missing database URL, one that isn't PostgreSQL, a bad schema name and a login the database refuses each exit 1 with a CLI_ERROR under --json. The password in the URL is never printed.",
    ),
  },
  async () => {
    const noDatabase = {
      DOPGATE_ROOT_PASSWORD: PASSWORD,
      RUST_LOG: "off",
    };
    await step("No database URL, in plain text", async () => {
      const refused = await app
        .cliRaw(["init", "--email", "ok@example.com"], { env: noDatabase })
        .fails(1);
      expect(refused.stderr).toContain("Error: set DOPGATE_DATABASE_URL to a PostgreSQL URL");
    });
    await step("No database URL, with --json", async () => {
      const refused = await app
        .cliRaw(["--json", "init", "--email", "ok@example.com"], { env: noDatabase })
        .fails(1);
      const body = JSON.parse(lastLine(refused.stderr));
      expect(body.success).toBe(false);
      expect(body.error.CLI_ERROR).toContain("DOPGATE_DATABASE_URL");
      expect(Object.keys(body.error)).toEqual(["CLI_ERROR"]);
    });
    await step("A URL that isn't PostgreSQL", async () => {
      const refused = await app
        .cliRaw(["init", "--email", "ok@example.com"], {
          env: { ...noDatabase, DOPGATE_DATABASE_URL: "mysql://localhost/app" },
        })
        .fails(1);
      expect(refused.stderr).toContain("must start with postgres:// or postgresql://");
    });
    await step("A schema name PostgreSQL would have to quote", async () => {
      await withSchema(async (_schema, env) => {
        const refused = await app
          .cli(["init", "--email", "ok@example.com"], {
            env: { ...env, DOPGATE_DATABASE_SCHEMA: "Bad-Schema", DOPGATE_ROOT_PASSWORD: PASSWORD },
          })
          .fails(1);
        expect(refused.stderr).toContain('database schema "Bad-Schema" must use lowercase letters');
      });
    });
    await step("A login the database refuses, whose password stays out of the message", async () => {
      await withSchema(async (_schema, env) => {
        // A role that doesn't exist is refused whether the test database
        // asks for passwords or trusts every connection, as the one in CI
        // does. A wrong password alone would get in there.
        const url = new URL(env.DOPGATE_DATABASE_URL!);
        url.username = "e2e_no_such_login";
        url.password = "wrong-secret-pw";
        const refused = await app
          .cli(["--json", "init", "--email", "ok@example.com"], {
            env: { ...env, DOPGATE_DATABASE_URL: url.toString(), DOPGATE_ROOT_PASSWORD: PASSWORD },
          })
          .fails(1);
        expect(refused.stderr).toContain("failed to reach PostgreSQL");
        expect(refused.stderr).not.toContain("wrong-secret-pw");
      });
    });
  },
);

test(
  "init takes the database from --database-url and --config",
  {
    tag: ["@setup"],
    annotation: about(
      "The instance can be named on the command line instead of in the environment: --database-url for the URL, and --config for a TOML file that holds the URL and the schema. The flag wins over the environment.",
    ),
  },
  async () => {
    const folder = await tempFolder("init-config");
    try {
      await withSchema(async (schema) => {
        await step("dopgate init --database-url, with a wrong URL in the environment", async () => {
          const done = await app
            .cliRaw(["--json", "init", "--email", "flag@example.com", "--database-url", instanceEnv(schema).DOPGATE_DATABASE_URL!], {
              env: {
                DOPGATE_DATABASE_URL: "postgres://nobody@127.0.0.1:1/none",
                DOPGATE_DATABASE_SCHEMA: schema,
                DOPGATE_ROOT_PASSWORD: PASSWORD,
                RUST_LOG: "off",
              },
            })
            .json();
          expect(done.data).toMatchObject({ email: "flag@example.com", schema });
        });
      });
      await withSchema(async (schema) => {
        const path = await writeIn(
          folder.dir,
          "dopgate.toml",
          `database_url = "${instanceEnv(schema).DOPGATE_DATABASE_URL}"\ndatabase_schema = "${schema}"\n`,
        );
        await step("dopgate init --config with the URL and schema in the file", async () => {
          const done = await app
            .cliRaw(["--json", "init", "--email", "file@example.com", "--config", path], {
              env: { DOPGATE_ROOT_PASSWORD: PASSWORD, RUST_LOG: "off" },
            })
            .json();
          expect(done.data).toMatchObject({ email: "file@example.com", schema });
        });
        await step("DOPGATE_CONFIG names the same file", async () => {
          const again = await app
            .cliRaw(["--json", "init", "--email", "again@example.com"], {
              env: { DOPGATE_CONFIG: path, DOPGATE_ROOT_PASSWORD: PASSWORD, RUST_LOG: "off" },
            })
            .fails(1);
          expect(JSON.parse(lastLine(again.stderr)).error.CLI_ERROR).toContain(
            "already has a root account",
          );
        });
      });
    } finally {
      await folder.remove();
    }
  },
);
