import { PASSWORD, about, expect, step, test, useServer } from "../harness/index.ts";
import { eventsOf } from "./admin.support.ts";

const app = useServer();

const NAMES = [
  "verify_email",
  "login_code",
  "password_reset",
  "email_change",
  "email_changed",
  "password_changed",
];

const CODE_VARIABLES = ["app_name", "email", "display_name", "code", "expires_minutes"];
const VARIABLES: Record<string, string[]> = {
  verify_email: CODE_VARIABLES,
  login_code: CODE_VARIABLES,
  password_reset: CODE_VARIABLES,
  email_change: [...CODE_VARIABLES, "new_email"],
  email_changed: ["app_name", "email", "display_name", "new_email"],
  password_changed: ["app_name", "email", "display_name"],
};

const draft = (over: Record<string, string> = {}) => ({
  subject: "Hello {{app_name}}",
  html: "<p>Code {{code}}</p>",
  text: "Code {{code}}",
  ...over,
});

/** Puts one template back to the built-in version. */
async function reset(name: string) {
  await app.service.delete(`/admin/email-templates/${name}`, undefined, { record: false });
}

test(
  "the six built-in templates are listed, none of them customized",
  {
    tag: ["@templates", "@smoke"],
    annotation: about(
      "GET /admin/email-templates answers EMAIL_TEMPLATES_FETCHED with the six templates in order, each with a name, a description, its subject, customized false and no updatedAt.",
    ),
  },
  async () => {
    const list = await step("GET /admin/email-templates as a backend", () =>
      app.service.get("/admin/email-templates"),
    );
    await step("It answers 200 EMAIL_TEMPLATES_FETCHED", async () => {
      expect(list.status).toBe(200);
      expect(list.message).toBe("EMAIL_TEMPLATES_FETCHED");
    });
    await step("It lists the six names in the documented order", async () => {
      expect(list.data.map((template: any) => template.name)).toEqual(NAMES);
    });
    await step("Each has a description and a subject, and none is customized", async () => {
      for (const template of list.data) {
        expect(template.description.length, template.name).toBeGreaterThan(10);
        expect(template.subject, template.name).toContain("{{app_name}}");
        expect(template.customized, template.name).toBe(false);
        expect(template.updatedAt, template.name).toBeNull();
      }
    });
  },
);

test(
  "one template shows what is in use, its variables and the built-in version",
  {
    tag: "@templates",
    annotation: about(
      "GET /admin/email-templates/{name} returns subject, html and text in use, the variables the template accepts and a defaults object. For a template nobody changed, the two match.",
    ),
  },
  async () => {
    for (const name of NAMES) {
      await step(`GET /admin/email-templates/${name}`, async () => {
        const template = await app.service.get(`/admin/email-templates/${name}`);
        expect(template.status).toBe(200);
        expect(template.message).toBe("EMAIL_TEMPLATE_FETCHED");
        expect(template.data).toMatchObject({ name, customized: false, updatedAt: null });
        expect(template.data.variables).toEqual(VARIABLES[name]);
        expect(template.data.html).toContain("<html>");
        expect(template.data.text.length).toBeGreaterThan(20);
        expect(template.data.defaults).toEqual({
          subject: template.data.subject,
          html: template.data.html,
          text: template.data.text,
        });
      });
    }
    await step("Every placeholder in the built-in text is one the template accepts", async () => {
      for (const name of NAMES) {
        const template = await app.service.get(`/admin/email-templates/${name}`);
        const used = [
          template.data.subject,
          template.data.html,
          template.data.text,
        ].flatMap((part: string) =>
          [...part.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((match) => match[1]),
        );
        for (const variable of used) {
          expect(VARIABLES[name], `${name} uses ${variable}`).toContain(variable);
        }
      }
    });
  },
);

test(
  "an unknown template name is 404 on every route",
  {
    tag: "@templates",
    annotation: about(
      "GET, PUT, DELETE, preview and test all answer 404 NOT_FOUND for a name that isn't one of the six.",
    ),
  },
  async () => {
    const root = await app.root();
    const calls: [string, string, unknown?][] = [
      ["GET", "/admin/email-templates/welcome"],
      ["PUT", "/admin/email-templates/welcome", draft()],
      ["DELETE", "/admin/email-templates/welcome"],
      ["POST", "/admin/email-templates/welcome/preview", draft()],
      ["POST", "/admin/email-templates/welcome/test", draft()],
    ];
    for (const [method, path, body] of calls) {
      await step(`${method} ${path}`, async () => {
        const result = await root.api.send(method, path, body);
        expect(result.status).toBe(404);
        expect(result.code).toBe("NOT_FOUND");
      });
    }
    await step("A name in capitals isn't one of the six either", async () => {
      expect((await root.api.get("/admin/email-templates/LOGIN_CODE")).status).toBe(404);
    });
    await step("Nothing was customized by the failed calls", async () => {
      const list = await app.service.get("/admin/email-templates");
      expect(list.data.every((template: any) => !template.customized)).toBe(true);
    });
  },
);

test(
  "a saved override is used for the real email and DELETE brings the built-in back",
  {
    tag: ["@templates", "@smoke"],
    annotation: about(
      "PUT saves a new verify_email. The next sign-up gets the new subject and text, the list marks it customized, and DELETE restores the built-in version for the sign-up after it.",
    ),
  },
  async () => {
    const original = await app.service.get("/admin/email-templates/verify_email");
    try {
      const saved = await step("PUT /admin/email-templates/verify_email", () =>
        app.service.put("/admin/email-templates/verify_email", {
          subject: "  Welcome to {{app_name}}, your code is {{code}}  ",
          html: "<p>Hi {{display_name}}, use {{ code }}.</p>",
          text: "Use {{code}} within {{expires_minutes}} minutes.",
        }),
      );
      await step("It answers 200 EMAIL_TEMPLATE_SAVED with the new template", async () => {
        expect(saved.status).toBe(200);
        expect(saved.message).toBe("EMAIL_TEMPLATE_SAVED");
        expect(saved.data).toMatchObject({
          name: "verify_email",
          customized: true,
          subject: "Welcome to {{app_name}}, your code is {{code}}",
          html: "<p>Hi {{display_name}}, use {{ code }}.</p>",
          text: "Use {{code}} within {{expires_minutes}} minutes.",
        });
        expect(Date.parse(saved.data.updatedAt)).not.toBeNaN();
        expect(saved.data.defaults).toEqual(original.data.defaults);
      });
      await step("GET and the list show it as customized", async () => {
        const got = await app.service.get("/admin/email-templates/verify_email");
        expect(got.data.customized).toBe(true);
        expect(got.data.subject).toBe("Welcome to {{app_name}}, your code is {{code}}");
        const list = await app.service.get("/admin/email-templates");
        const entry = list.data.find((template: any) => template.name === "verify_email");
        expect(entry).toMatchObject({
          customized: true,
          subject: "Welcome to {{app_name}}, your code is {{code}}",
        });
        expect(entry.updatedAt).toEqual(expect.any(String));
        const others = list.data.filter((template: any) => template.name !== "verify_email");
        expect(others.every((template: any) => !template.customized)).toBe(true);
      });
      await step("The next sign-up email uses it", async () => {
        const email = app.email("custom");
        await app.api.post("/auth/signup", { email, password: PASSWORD });
        const mail = await app.mail.last(email);
        const code = await app.mail.code(email);
        expect(mail.subject).toBe(`Welcome to Dopgate, your code is ${code}`);
        expect(mail.text).toContain(`Use ${code} within 10 minutes.`);
      });
      await step("DELETE /admin/email-templates/verify_email", async () => {
        const gone = await app.service.delete("/admin/email-templates/verify_email");
        expect(gone.status).toBe(200);
        expect(gone.message).toBe("EMAIL_TEMPLATE_RESET");
        expect(gone.data).toMatchObject({
          customized: false,
          updatedAt: null,
          subject: original.data.subject,
          html: original.data.html,
          text: original.data.text,
        });
      });
      await step("The next sign-up email is the built-in one again", async () => {
        const email = app.email("builtin");
        await app.api.post("/auth/signup", { email, password: PASSWORD });
        const mail = await app.mail.last(email);
        expect(mail.subject).toMatch(/^Your Dopgate code is \d{6}$/);
      });
    } finally {
      await reset("verify_email");
    }
  },
);

test(
  "a saved override can be saved again, and the admin password reset email follows it",
  {
    tag: "@templates",
    annotation: about(
      "A second PUT replaces the first. An override of password_reset is used when an admin sends a reset, and the code is still in the email.",
    ),
  },
  async () => {
    const user = await app.user("override");
    try {
      await step("PUT twice, the second wins", async () => {
        await app.service.put("/admin/email-templates/password_reset", draft({ subject: "First {{code}}" }));
        const second = await app.service.put(
          "/admin/email-templates/password_reset",
          draft({ subject: "Second {{code}}", text: "Reset with {{code}} for {{email}}" }),
        );
        expect(second.data.subject).toBe("Second {{code}}");
        expect(
          (await app.service.get("/admin/email-templates/password_reset")).data.text,
        ).toBe("Reset with {{code}} for {{email}}");
      });
      await step("POST /admin/users/{id}/password-reset sends the override", async () => {
        const sent = await app.service.post(`/admin/users/${user.id}/password-reset`);
        expect(sent.status).toBe(200);
        const mail = await app.mail.last(user.email);
        const code = await app.mail.code(user.email);
        expect(mail.subject).toBe(`Second ${code}`);
        expect(mail.text).toContain(`Reset with ${code} for ${user.email}`);
      });
    } finally {
      await reset("password_reset");
    }
  },
);

test(
  "saving and resetting a template are written to the audit log",
  {
    tag: ["@templates", "@audit"],
    annotation: about(
      "PUT records email_template.updated and DELETE records email_template.reset, both with the template name as the resource. A DELETE with nothing to reset records nothing.",
    ),
  },
  async () => {
    const root = await app.root();
    const updatedBefore = (await eventsOf(app.service, "email_template.updated")).length;
    const resetBefore = (await eventsOf(app.service, "email_template.reset")).length;
    await step("PUT /admin/email-templates/login_code as root", async () => {
      const saved = await root.api.put("/admin/email-templates/login_code", draft({ subject: "Login {{code}}" }));
      expect(saved.status).toBe(200);
    });
    await step("email_template.updated names root and the template", async () => {
      const events = await eventsOf(app.service, "email_template.updated");
      expect(events).toHaveLength(updatedBefore + 1);
      expect(events[0]).toMatchObject({
        actorType: "root",
        actorLabel: root.email,
        resourceType: "email_template",
        resourceId: "login_code",
      });
    });
    await step("DELETE records email_template.reset", async () => {
      expect((await root.api.delete("/admin/email-templates/login_code")).status).toBe(200);
      const events = await eventsOf(app.service, "email_template.reset");
      expect(events).toHaveLength(resetBefore + 1);
      expect(events[0]).toMatchObject({ resourceType: "email_template", resourceId: "login_code" });
    });
    await step("DELETE with no override answers 200 and records nothing", async () => {
      const again = await root.api.delete("/admin/email-templates/login_code");
      expect(again.status).toBe(200);
      expect(again.data.customized).toBe(false);
      expect(await eventsOf(app.service, "email_template.reset")).toHaveLength(resetBefore + 1);
    });
  },
);

test(
  "a draft is refused with TEMPLATE_INVALID when it is incomplete or breaks the rules",
  {
    tag: "@templates",
    annotation: about(
      "An empty or too long subject, an empty body, an oversize body, an unclosed placeholder and an unknown variable are all 422 TEMPLATE_INVALID on PUT, and nothing is saved.",
    ),
  },
  async () => {
    const bad: [string, Record<string, string>][] = [
      ["an empty subject", { subject: "" }],
      ["a blank subject", { subject: "   " }],
      ["a subject over 255 characters", { subject: "s".repeat(256) }],
      ["an empty html", { html: "" }],
      ["a blank text", { text: "  \n " }],
      ["an html over 100 KB", { html: "h".repeat(100 * 1024 + 1) }],
      ["a text over 100 KB", { text: "t".repeat(100 * 1024 + 1) }],
      ["an unclosed placeholder in the subject", { subject: "Code {{code" }],
      ["an unclosed placeholder in the html", { html: "<p>{{code</p>" }],
      ["an unclosed placeholder in the text", { text: "Hello {{ app_name" }],
      ["an unknown variable in the subject", { subject: "Hi {{nickname}}" }],
      ["an unknown variable in the html", { html: "<p>{{secret}}</p>" }],
      ["an unknown variable in the text", { text: "{{password}}" }],
      ["an empty placeholder", { text: "Hi {{}}" }],
    ];
    for (const [label, over] of bad) {
      await step(`PUT with ${label}`, async () => {
        const refused = await app.service.put("/admin/email-templates/login_code", draft(over));
        expect(refused.status, label).toBe(422);
        expect(refused.code, label).toBe("TEMPLATE_INVALID");
      });
    }
    await step("A variable only another template has is unknown here", async () => {
      const refused = await app.service.put(
        "/admin/email-templates/login_code",
        draft({ text: "Go to {{new_email}}" }),
      );
      expect(refused.code).toBe("TEMPLATE_INVALID");
      const fine = await app.service.put(
        "/admin/email-templates/email_change",
        draft({ text: "Go to {{new_email}}" }),
      );
      expect(fine.status).toBe(200);
      await reset("email_change");
    });
    await step("A body with a field missing is REQUEST_INVALID", async () => {
      const missing = await app.service.put("/admin/email-templates/login_code", {
        subject: "Only a subject",
      });
      expect(missing.status).toBeGreaterThanOrEqual(400);
      expect(missing.code).toBe("REQUEST_INVALID");
    });
    await step("login_code is still the built-in template", async () => {
      const got = await app.service.get("/admin/email-templates/login_code");
      expect(got.data.customized).toBe(false);
    });
  },
);

test(
  "a draft at the limits is accepted",
  {
    tag: "@templates",
    annotation: about(
      "A 255 character subject, 100 KB bodies and placeholders written with spaces inside the braces all save.",
    ),
  },
  async () => {
    try {
      await step("PUT a subject of 255 characters and bodies of 100 KB", async () => {
        const saved = await app.service.put(
          "/admin/email-templates/password_changed",
          draft({
            subject: "s".repeat(255),
            html: "h".repeat(100 * 1024),
            text: "t".repeat(100 * 1024),
          }),
        );
        expect(saved.status).toBe(200);
        expect(saved.data.subject).toHaveLength(255);
      });
      await step("Spaces inside the braces are allowed", async () => {
        const saved = await app.service.put(
          "/admin/email-templates/password_changed",
          draft({
            subject: "{{ app_name }} changed {{   email}}",
            html: "<p>{{app_name}}</p>",
            text: "{{ display_name }}",
          }),
        );
        expect(saved.status).toBe(200);
      });
      await step("A template with no placeholder at all is fine", async () => {
        const saved = await app.service.put(
          "/admin/email-templates/password_changed",
          { subject: "Changed", html: "<p>Changed</p>", text: "Changed" },
        );
        expect(saved.status).toBe(200);
      });
    } finally {
      await reset("password_changed");
    }
  },
);

test(
  "preview renders sample values without saving or sending",
  {
    tag: "@templates",
    annotation: about(
      "POST /preview fills a draft with sample values (the code 482913, the name Alex, the caller's email). It returns subject, html and text, leaves the template as it was, and sends no email.",
    ),
  },
  async () => {
    const root = await app.root();
    const input = {
      subject: "{{app_name}} code {{code}} for {{display_name}}",
      html: "<p>{{email}} {{ code }} {{expires_minutes}}</p>",
      text: "{{email}} / {{code}} / {{expires_minutes}} / {{display_name}}",
    };
    const preview = await step("POST /admin/email-templates/login_code/preview as root", () =>
      root.api.post("/admin/email-templates/login_code/preview", input),
    );
    await step("It answers 200 EMAIL_TEMPLATE_PREVIEWED with the rendered draft", async () => {
      expect(preview.status).toBe(200);
      expect(preview.message).toBe("EMAIL_TEMPLATE_PREVIEWED");
      expect(preview.data).toEqual({
        subject: "Dopgate code 482913 for Alex",
        html: `<p>${root.email} 482913 10</p>`,
        text: `${root.email} / 482913 / 10 / Alex`,
      });
    });
    await step("With the service key the email sample is person@example.com", async () => {
      const asService = await app.service.post("/admin/email-templates/login_code/preview", input);
      expect(asService.status).toBe(200);
      expect(asService.data.text).toBe("person@example.com / 482913 / 10 / Alex");
    });
    await step("expires_minutes follows the codeMinutes limit", async () => {
      await app.settings("limits", { codeMinutes: 25 });
      try {
        const again = await app.service.post("/admin/email-templates/login_code/preview", input);
        expect(again.data.html).toContain(" 25</p>");
      } finally {
        await app.settings("limits", { codeMinutes: 10 });
      }
    });
    await step("new_email has a sample in the templates that accept it", async () => {
      const result = await app.service.post("/admin/email-templates/email_change/preview", {
        subject: "S",
        html: "<p>{{new_email}}</p>",
        text: "{{new_email}}",
      });
      expect(result.data.text).toBe("new.address@example.com");
    });
    await step("The template itself was not saved", async () => {
      const got = await app.service.get("/admin/email-templates/login_code");
      expect(got.data.customized).toBe(false);
      expect(got.data.subject).not.toBe(input.subject);
    });
    await step("No email was sent for it", async () => {
      await new Promise((wait) => setTimeout(wait, 300));
      const mails = await app.mail.to(root.email);
      expect(mails.some((mail) => mail.subject.includes("482913"))).toBe(false);
    });
  },
);

test(
  "preview escapes values in the HTML part only",
  {
    tag: ["@templates", "@security"],
    annotation: about(
      "With an app name that holds markup, the HTML part shows it escaped while the subject and text keep it as typed, and control characters in the subject become spaces.",
    ),
  },
  async () => {
    try {
      await step("PATCH branding with an app name that holds markup", async () => {
        const saved = await app.service.patch("/admin/settings", {
          branding: { appName: `A&B <Co> "Q" 'S'` },
        });
        expect(saved.status).toBe(200);
      });
      const preview = await step("POST /preview with {{app_name}} in all three parts", () =>
        app.service.post("/admin/email-templates/login_code/preview", {
          subject: "Hi {{app_name}}",
          html: "<b>{{app_name}}</b> <i>raw</i>",
          text: "Hi {{app_name}}",
        }),
      );
      await step("The HTML escapes & < > and both quotes, the others don't", async () => {
        expect(preview.data.html).toBe(
          "<b>A&amp;B &lt;Co&gt; &quot;Q&quot; &#39;S&#39;</b> <i>raw</i>",
        );
        expect(preview.data.subject).toBe(`Hi A&B <Co> "Q" 'S'`);
        expect(preview.data.text).toBe(`Hi A&B <Co> "Q" 'S'`);
      });
    } finally {
      await app.settings("branding", { appName: "Dopgate", logoUrl: null });
    }
  },
);

test(
  "preview and test refuse the same bad drafts as PUT",
  {
    tag: "@templates",
    annotation: about(
      "A draft with an unknown variable, an unclosed placeholder or an empty field is TEMPLATE_INVALID on preview and on test, and the test sends nothing.",
    ),
  },
  async () => {
    const root = await app.root();
    const before = await app.mail.count(root.email);
    for (const route of ["preview", "test"]) {
      await step(`POST /${route} with an unknown variable`, async () => {
        const refused = await root.api.post(
          `/admin/email-templates/login_code/${route}`,
          draft({ text: "Hi {{nobody}}" }),
        );
        expect(refused.status).toBe(422);
        expect(refused.code).toBe("TEMPLATE_INVALID");
      });
      await step(`POST /${route} with an unclosed placeholder`, async () => {
        const refused = await root.api.post(
          `/admin/email-templates/login_code/${route}`,
          draft({ subject: "Hi {{code" }),
        );
        expect(refused.code).toBe("TEMPLATE_INVALID");
      });
      await step(`POST /${route} with an empty subject`, async () => {
        const refused = await root.api.post(
          `/admin/email-templates/login_code/${route}`,
          draft({ subject: "" }),
        );
        expect(refused.code).toBe("TEMPLATE_INVALID");
      });
    }
    await step("Nothing reached the mailbox", async () => {
      await new Promise((wait) => setTimeout(wait, 300));
      expect(await app.mail.count(root.email)).toBe(before);
    });
  },
);

test(
  "the template test emails the rendered draft to the signed-in admin",
  {
    tag: "@templates",
    annotation: about(
      "POST /test sends the draft with sample values to the caller's own address. Without SMTP it is written to the server log. The service key has no address and gets EMAIL_INVALID.",
    ),
  },
  async () => {
    const root = await app.root();
    const sam = await app.admin("sam");
    const input = {
      subject: "Test {{app_name}} {{code}}",
      html: "<p>Hello {{display_name}}</p>",
      text: "Sample code {{code}} for {{email}}",
    };
    await step("POST /admin/email-templates/verify_email/test as root", async () => {
      const sent = await root.api.post("/admin/email-templates/verify_email/test", input);
      expect(sent.status).toBe(200);
      expect(sent.message).toBe("EMAIL_TEMPLATE_TEST_SENT");
    });
    await step("The message went to root with sample values", async () => {
      const mail = await app.mail.last(root.email);
      expect(mail.subject).toBe("Test Dopgate 482913");
      expect(mail.text).toContain(`Sample code 482913 for ${root.email}`);
    });
    await step("Another admin gets it at their own address", async () => {
      const before = await app.mail.count(sam.email);
      const sent = await sam.api.post("/admin/email-templates/password_changed/test", {
        subject: "Sam {{email}}",
        html: "<p>x</p>",
        text: "x",
      });
      expect(sent.status).toBe(200);
      const mail = await app.mail.last(sam.email, { after: before });
      expect(mail.subject).toBe(`Sam ${sam.email}`);
    });
    await step("The service key is 400 EMAIL_INVALID", async () => {
      const refused = await app.service.post("/admin/email-templates/verify_email/test", input);
      expect(refused.status).toBe(400);
      expect(refused.code).toBe("EMAIL_INVALID");
    });
    await step("Testing doesn't save the draft", async () => {
      const got = await app.service.get("/admin/email-templates/verify_email");
      expect(got.data.customized).toBe(false);
    });
  },
);

test(
  "only admins and the service key may use the template routes",
  {
    tag: ["@templates", "@security"],
    annotation: about(
      "No token is 401. A user's access token is 403 AUTHORIZATION_DENIED on every template route, and nothing is changed or sent.",
    ),
  },
  async () => {
    const user = await app.user("outsider");
    const routes: [string, string, unknown?][] = [
      ["GET", "/admin/email-templates"],
      ["GET", "/admin/email-templates/login_code"],
      ["PUT", "/admin/email-templates/login_code", draft()],
      ["DELETE", "/admin/email-templates/login_code"],
      ["POST", "/admin/email-templates/login_code/preview", draft()],
      ["POST", "/admin/email-templates/login_code/test", draft()],
    ];
    await step("Without a token every route is 401", async () => {
      for (const [method, path, body] of routes) {
        const result = await app.api.send(method, path, body);
        expect(result.status, `${method} ${path}`).toBe(401);
        expect(result.code, `${method} ${path}`).toBe("AUTHENTICATION_REQUIRED");
      }
    });
    await step("With a user's token every route is 403", async () => {
      for (const [method, path, body] of routes) {
        const result = await user.api.send(method, path, body);
        expect(result.status, `${method} ${path}`).toBe(403);
        expect(result.code, `${method} ${path}`).toBe("AUTHORIZATION_DENIED");
      }
    });
    await step("login_code is untouched and the user got no mail", async () => {
      expect((await app.service.get("/admin/email-templates/login_code")).data.customized).toBe(false);
      expect(await app.mail.count(user.email)).toBe(0);
    });
  },
);
