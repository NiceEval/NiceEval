// owner: docs/engineering/testing/e2e/report.md#report-source-snapshot
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
        ["show", attempt.locator!, "--source"],
      );
      expect(shown.exitCode, shown.diagnostic()).toBe(0);
      expect(shown.stdout).toContain("evals/source-snapshot.eval.ts");
      expect(shown.stdout).toContain("evals/source-snapshot/assertions.ts");
      expect(shown.stdout).toContain("ENTRY_SNAPSHOT_BEFORE");
      expect(shown.stdout).toContain("IMPORTED_ASSERTION_SNAPSHOT_BEFORE");
      expect(shown.stdout).not.toContain("ENTRY_SNAPSHOT_AFTER");
      expect(shown.stdout).not.toContain("IMPORTED_ASSERTION_SNAPSHOT_AFTER");
    },
  );
});
