// owner: docs/engineering/testing/e2e/report.md#report-source-snapshot
// rerun: pnpm e2e --repo report -- --run test/report-source.test.ts

import { mkdirSync, writeFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { PINNED_ENV, reportCaseArtifacts, reportE2E } from "./support/context.ts";
import { classicExpFacts } from "./support/exp.ts";
import { assertPublicShowJson } from "./support/show-json.ts";
import { expectTranscript, requiredTranscript, toTranscriptTemplate } from "./support/transcript.ts";

test("show --source keeps runtime BEFORE after copy source is rewritten", async () => {
  await reportE2E.case("source", { artifacts: reportCaseArtifacts() }, async ({ paths: { projectRoot }, commands: { niceeval } }) => {
    const run = await niceeval.run(["exp", "classic/baseline", "--rerun", "all", "--json"], {
      env: PINNED_ENV,
      timeoutMs: 120_000,
    });
    expect(run.exitCode, run.diagnostic()).toBe(1);
    const facts = classicExpFacts(run.stdout);
    const locator = facts.locator("classic/baseline", "source-snapshot");

    const entryPath = join(projectRoot, "evals", "source-snapshot.eval.ts");
    const assertionPath = join(projectRoot, "evals", "source-snapshot", "assertions.ts");
    const entry = await readFile(entryPath, "utf8");
    const assertions = await readFile(assertionPath, "utf8");
    expect(entry).toContain("ENTRY_SNAPSHOT_BEFORE");
    expect(assertions).toContain("IMPORTED_ASSERTION_SNAPSHOT_BEFORE");
    await writeFile(entryPath, entry.replace("ENTRY_SNAPSHOT_BEFORE", "ENTRY_SNAPSHOT_AFTER"), "utf8");
    await writeFile(
      assertionPath,
      assertions.replace("IMPORTED_ASSERTION_SNAPSHOT_BEFORE", "IMPORTED_ASSERTION_SNAPSHOT_AFTER"),
      "utf8",
    );

    const shown = await niceeval.run(["show", locator, "--source=full"], { env: PINNED_ENV });
    expect(shown.exitCode, shown.diagnostic()).toBe(0);
    expect(shown.stdout).toContain("evals/source-snapshot.eval.ts");
    expect(shown.stdout).toContain("evals/source-snapshot/assertions.ts");
    expect(shown.stdout).toContain("ENTRY_SNAPSHOT_BEFORE");
    expect(shown.stdout).toContain("IMPORTED_ASSERTION_SNAPSHOT_BEFORE");
    expect(shown.stdout).not.toContain("ENTRY_SNAPSHOT_AFTER");
    expect(shown.stdout).not.toContain("IMPORTED_ASSERTION_SNAPSHOT_AFTER");

    const bindings = { locators: { "classic/baseline:source-snapshot": locator }, runIds: facts.runIds };
    const fixturePath = join(import.meta.dirname, "fixtures", "transcripts", "show-source.full.txt");
    if (process.env.NICEEVAL_CAPTURE_TRANSCRIPTS === "1") {
      mkdirSync(join(import.meta.dirname, "fixtures", "transcripts"), { recursive: true });
      writeFileSync(fixturePath, toTranscriptTemplate(shown.stdout, bindings), "utf8");
    }
    expectTranscript(shown.stdout, requiredTranscript(import.meta.dirname, "show-source.full.txt"), bindings);

    const compact = await niceeval.run(["show", locator, "--source"], { env: PINNED_ENV });
    expect(compact.exitCode, compact.diagnostic()).toBe(0);
    expect(compact.stdout).toContain("Assertions: available");
    expect(compact.stdout).toContain("ENTRY_SNAPSHOT_BEFORE");

    const json = await niceeval.run(["show", locator, "--source", "--json"], { env: PINNED_ENV });
    expect(json.exitCode, json.diagnostic()).toBe(0);
    const document = assertPublicShowJson(json.json());
    expect(document.view).toBe("source");
    const payload = JSON.stringify(document.data);
    expect(payload).toContain("ENTRY_SNAPSHOT_BEFORE");
    expect(payload).toContain("IMPORTED_ASSERTION_SNAPSHOT_BEFORE");
    expect(payload).not.toContain("ENTRY_SNAPSHOT_AFTER");
    expect(payload).not.toContain("IMPORTED_ASSERTION_SNAPSHOT_AFTER");
  });
});
