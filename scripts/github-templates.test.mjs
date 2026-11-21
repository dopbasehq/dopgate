import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  extractChangelog,
  findPreviousVersion,
  parseChangelogRelease,
  renderReleaseNotes,
  validatePullRequestBody,
} from "./github-templates.mjs";

const pullRequestTemplate = readFileSync(
  new URL("../.github/pull_request_template.md", import.meta.url),
  "utf8",
);
const releaseTemplate = readFileSync(
  new URL("../.github/RELEASE_TEMPLATE.md", import.meta.url),
  "utf8",
);

const DEMO_PROMPT =
  '<!-- Features and improvements: attach a screenshot or a short video that shows the change working, in the UI or in a terminal. Drag the file into this box. Remove credentials, tokens, secret values, and private endpoints first. Docs, tests, CI, dependency, or refactor-only changes: write "Not needed:" and the reason. -->';

function completedPullRequest(
  demo = "Not needed: this only changes repository templates.",
) {
  return pullRequestTemplate
    .replace(DEMO_PROMPT, demo)
    .replace(
      "<!-- Explain what changed and why. Keep this focused on the problem this pull request solves. -->",
      "Add repository templates and validate them in CI.",
    )
    .replace(
      '<!-- List breaking changes, migration steps, or other compatibility effects. Write "No compatibility impact." when there are none. -->',
      "No compatibility impact.",
    )
    .replace(
      "<!-- List the commands or checks you ran. If a check was not run, say why. -->",
      "- `node --test scripts/github-templates.test.mjs`",
    )
    .replaceAll("- [ ]", "- [x]");
}

test("accepts a completed pull request template", () => {
  assert.deepEqual(validatePullRequestBody(completedPullRequest()), []);
});

test("rejects empty sections and unchecked checklist items", () => {
  const errors = validatePullRequestBody(pullRequestTemplate);
  assert(errors.includes("The Summary section needs an answer."));
  assert(errors.includes("The Compatibility section needs an answer."));
  assert(errors.includes("The Verification section needs an answer."));
  assert(errors.includes("The Demo section needs an answer."));
  assert(
    errors.some((error) => error.startsWith("Check this item before merging:")),
  );
});

test("accepts a screenshot, a video, or an uploaded file as the demo", () => {
  for (const demo of [
    "![run --only output](https://github.com/user-attachments/assets/1b2c3d4e-0000-4000-8000-000000000000)",
    '<img width="800" alt="Secrets table" src="https://github.com/user-attachments/assets/1b2c3d4e-0000-4000-8000-000000000000" />',
    "https://github.com/user-attachments/assets/1b2c3d4e-0000-4000-8000-000000000000",
    "Recording: https://example.com/demo/run-only.mp4",
  ]) {
    assert.deepEqual(
      validatePullRequestBody(completedPullRequest(demo)),
      [],
      demo,
    );
  }
});

test("rejects a demo without media or a reason", () => {
  for (const demo of [
    "Ran it locally and it works.",
    "Not needed:",
    "See https://example.com/demo",
  ]) {
    assert(
      validatePullRequestBody(completedPullRequest(demo)).includes(
        'The Demo section needs a screenshot or video, or "Not needed:" with a reason.',
      ),
      demo,
    );
  }
});

test("rejects a removed template marker", () => {
  const body = completedPullRequest().replace(
    "<!-- pr-template:compatibility -->",
    "",
  );
  assert(
    validatePullRequestBody(body).includes(
      "The Compatibility template marker must appear exactly once.",
    ),
  );
});

test("selects the greatest earlier semantic version", () => {
  assert.equal(
    findPreviousVersion("0.1.1", ["0.0.15", "notes", "0.1.0", "0.0.9"]),
    "0.1.0",
  );
  assert.equal(
    findPreviousVersion("1.0.0", ["0.9.9", "0.10.0", "0.2.10"]),
    "0.10.0",
  );
});

test("finds no previous version for the first release", () => {
  assert.equal(findPreviousVersion("0.1.0", ["0.1.0", "draft"]), null);
  assert.equal(findPreviousVersion("0.1.0", []), null);
});

test("extracts only the requested changelog section", () => {
  const changelog = `# Changelog

## 0.2.0 - 2026-09-08

Short release summary.

### Added

- New release.

## 0.1.0 - 2026-09-01

- Earlier release.
`;
  assert.equal(
    extractChangelog(changelog, "0.2.0"),
    "## 0.2.0 - 2026-09-08\n\nShort release summary.\n\n### Added\n\n- New release.",
  );
});

test("renders the required fields and populated optional sections", () => {
  const changelog = `# Changelog

## 0.2.0 - 2026-09-08

Dopgate adds passkeys and shortens sign-in codes.

### Added

- Added passkeys.

### Changed

- Sign-in codes expire after five minutes.

### Security

- Limited repeated sign-in attempts.

## 0.1.0 - 2026-09-01

Earlier release.
`;
  const notes = renderReleaseNotes({
    template: releaseTemplate,
    changelog,
    currentVersion: "0.2.0",
    previousVersion: "0.1.0",
    repository: "dopbasehq/dopgate",
  });

  assert(notes.startsWith("## Summary\n\nDopgate adds passkeys"));
  assert(notes.includes("## Added\n\n- Added passkeys."));
  assert(
    notes.includes("## Changed\n\n- Sign-in codes expire after five minutes."),
  );
  assert(
    notes.indexOf("## Added") < notes.indexOf("## Changed") &&
      notes.indexOf("## Changed") < notes.indexOf("## Security"),
  );
  assert(notes.includes("## Security\n\n- Limited repeated sign-in attempts."));
  assert(!notes.includes("## Fixed"));
  assert(!notes.includes("## Removed"));
  assert.match(
    notes,
    /\*\*Full Changelog\*\*: https:\/\/github\.com\/dopbasehq\/dopgate\/compare\/0\.1\.0\.\.\.0\.2\.0/,
  );
  assert(!notes.includes("## 0.1.0 - 2026-09-01"));
  assert(!notes.includes("{{"));
});

test("allows a release with only the required fields", () => {
  const notes = renderReleaseNotes({
    template: releaseTemplate,
    changelog: "## 1.0.0 - 2026-09-08\n\nFirst stable release.\n",
    currentVersion: "1.0.0",
    previousVersion: "0.9.0",
    repository: "dopbasehq/dopgate",
  });

  assert(notes.includes("## Summary\n\nFirst stable release."));
  assert(!notes.includes("## Added"));
  assert(notes.includes("**Full Changelog**:"));
  assert(!notes.includes("\n\n\n"));
});

test("links the first release to its commit history", () => {
  const notes = renderReleaseNotes({
    template: releaseTemplate,
    changelog: "## 0.1.0 - 2026-11-20\n\nThe first release.\n",
    currentVersion: "0.1.0",
    previousVersion: null,
    repository: "dopbasehq/dopgate",
  });

  assert(
    notes.endsWith(
      "**Full Changelog**: https://github.com/dopbasehq/dopgate/commits/0.1.0\n",
    ),
  );
  assert(!notes.includes("{{"));
});

test("rejects missing summaries and unsupported release sections", () => {
  assert.throws(
    () =>
      parseChangelogRelease(
        "## 1.0.0 - 2026-09-08\n\n### Added\n\n- Feature.\n",
        "1.0.0",
      ),
    /needs a summary/,
  );
  assert.throws(
    () =>
      parseChangelogRelease(
        "## 1.0.0 - 2026-09-08\n\nRelease summary.\n\n### Improvement\n\n- Change.\n",
        "1.0.0",
      ),
    /unsupported section Improvement/,
  );
});

test("rejects empty and repeated optional release sections", () => {
  assert.throws(
    () =>
      parseChangelogRelease(
        "## 1.0.0 - 2026-09-08\n\nRelease summary.\n\n### Added\n",
        "1.0.0",
      ),
    /Added section is empty/,
  );
  assert.throws(
    () =>
      parseChangelogRelease(
        "## 1.0.0 - 2026-09-08\n\nRelease summary.\n\n### Fixed\n\n- First.\n\n### Fixed\n\n- Second.\n",
        "1.0.0",
      ),
    /repeats the Fixed section/,
  );
});
