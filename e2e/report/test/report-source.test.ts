// owner: docs/engineering/testing/e2e/report.md#report-source-snapshot
// kill: 77ae005b with private `artifactPath` added to source JSON packed as
// sha256:c396a74f9f78db1f83cdb612df43f71379bec202d4a4a8383046a6ba501c778b;
// the public owner first failed at observe/outcome line 81 on the forbidden
// `artifactPath` field before inspecting private path values.
// rerun: pnpm e2e --repo report -- --run test/report-source.test.ts

import { only } from "@niceeval/testkit";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { reportCaseArtifacts, reportE2E } from "./support.ts";

interface ExpEvent {
  event: string;
  evalId?: string;
  locator?: string;
}

interface ShowDocument {
  format: string;
  view?: string;
  data?: unknown;
}

interface SourceCalculation {
  readonly state: "available" | "data-unavailable" | "execution-failed";
  readonly inputState?: "complete" | "partial";
  readonly problemIds: readonly number[];
  readonly value?: {
    readonly locator: string;
    readonly source: unknown | null;
    readonly unavailable?: string;
  };
}

test("show --source 从本轮 Record 呈现入口与导入断言快照", async () => {
  await reportE2E.case(
    "source",
    { artifacts: reportCaseArtifacts() },
    async ({ paths: { projectRoot }, commands: { niceeval } }) => {
      const run = await niceeval.run(["exp", "source", "--rerun", "all", "--json"]);
      expect(run.exitCode, run.diagnostic()).toBe(0);
      const attempt = only(
        run.ndjson<ExpEvent>(),
        (event) => event.event === "eval" && event.evalId === "source-snapshot" && event.locator !== undefined,
        run.diagnostic(),
      );
      const locator = attempt.locator!;

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

      const shown = await niceeval.run(
        ["show", locator, "--source"],
      );
      expect(shown.exitCode, shown.diagnostic()).toBe(0);
      expect(shown.stdout).toContain("evals/source-snapshot.eval.ts");
      expect(shown.stdout).toContain("evals/source-snapshot/assertions.ts");
      expect(shown.stdout).toContain("ENTRY_SNAPSHOT_BEFORE");
      expect(shown.stdout).toContain("Assertions: available");
      expect(shown.stdout).not.toContain("ENTRY_SNAPSHOT_AFTER");
      expect(shown.stdout).not.toContain("IMPORTED_ASSERTION_SNAPSHOT_AFTER");
      expect(shown.stdout).not.toContain("@unknown");
      expect(shown.stdout).not.toContain(".niceeval/");
      expect(shown.stdout).not.toContain("sources.json");

      const json = await niceeval.run(
        ["show", locator, "--source", "--json"],
      );
      expect(json.exitCode, json.diagnostic()).toBe(0);
      const recordRoot = join(projectRoot, ".niceeval", "record");
      expect(json.stdout).not.toContain(projectRoot);
      expect(json.stdout).not.toContain(recordRoot);
      expect(json.stdout).not.toContain("artifactPath");
      expect(json.stdout).not.toContain(".niceeval/");
      expect(json.stdout).not.toContain("sources.json");

      const document = json.json<ShowDocument>();
      expect(document.format).toBe("niceeval.show");
      expect(document.view).toBe("source");
      expect(document.data).toMatchObject({
        state: "available",
        inputState: "complete",
        problemIds: [],
        value: { locator },
      });
      const payload = JSON.stringify(document.data);
      expect(payload).toContain("ENTRY_SNAPSHOT_BEFORE");
      expect(payload).toContain("IMPORTED_ASSERTION_SNAPSHOT_BEFORE");
      expect(payload).not.toContain("ENTRY_SNAPSHOT_AFTER");
      expect(payload).not.toContain("IMPORTED_ASSERTION_SNAPSHOT_AFTER");
      expect(payload).not.toContain("@unknown");

      const missingSourceText = await niceeval.run(
        ["show", locator, "--source=evals/not-captured.ts"],
      );
      expect(missingSourceText.exitCode, missingSourceText.diagnostic()).toBe(0);
      expect(missingSourceText.stdout).toContain(
        "Captured source file not found in annotated source tree: evals/not-captured.ts",
      );
      expect(missingSourceText.stdout).toContain(locator);

      const missingSourceJson = await niceeval.run(
        ["show", locator, "--source=evals/not-captured.ts", "--json"],
      );
      expect(missingSourceJson.exitCode, missingSourceJson.diagnostic()).toBe(0);
      const missingSourceData = missingSourceJson.json<ShowDocument>().data as SourceCalculation;
      expect(missingSourceData).toMatchObject({
        state: "available",
        inputState: "complete",
        problemIds: [],
        value: {
          locator,
          source: null,
          unavailable: "Captured source file not found in annotated source tree: evals/not-captured.ts",
        },
      });
    },
  );
});
