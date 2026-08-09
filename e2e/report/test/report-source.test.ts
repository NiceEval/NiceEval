// owner: docs/engineering/testing/e2e/report.md#证据切面
// rerun: pnpm e2e --repo report -- --run test/report-source.test.ts

import { command, only, withProjectCopy } from "@niceeval/testkit";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { reportProjectCopy, retainEvidence } from "./support.ts";

interface ExpEvent {
  event: string;
  evalId?: string;
  locator?: string;
}

const niceeval = command([join(process.cwd(), "node_modules", ".bin", "niceeval")]);

test("旧 locator 的 show --source 保留入口、调用链与导入断言快照", async () => {
  await withProjectCopy(reportProjectCopy, async ({ root }) => {
    try {
      const run = await niceeval.run(["exp", "source", "--rerun", "all", "--json"], { cwd: root });
      expect(run.exitCode, run.diagnostic()).toBe(0);
      const attempt = only(
        run.ndjson<ExpEvent>(),
        (event) => event.event === "eval" && event.evalId === "source-snapshot" && event.locator !== undefined,
        run.diagnostic(),
      );

      const entryPath = join(root, "evals", "source-snapshot.eval.ts");
      const assertionPath = join(root, "evals", "source-snapshot", "assertions.ts");
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
        ["show", attempt.locator!, "--record", ".niceeval", "--source", "--json"],
        { cwd: root },
      );
      expect(shown.exitCode, shown.diagnostic()).toBe(0);
      expect(shown.stdout).toContain("evals/source-snapshot.eval.ts");
      expect(shown.stdout).toContain("evals/source-snapshot/assertions.ts");
      expect(shown.stdout).toContain("ENTRY_SNAPSHOT_BEFORE");
      expect(shown.stdout).toContain("IMPORTED_ASSERTION_SNAPSHOT_BEFORE");
      expect(shown.stdout).toContain('"calls"');
      expect(shown.stdout).not.toContain("ENTRY_SNAPSHOT_AFTER");
      expect(shown.stdout).not.toContain("IMPORTED_ASSERTION_SNAPSHOT_AFTER");
    } finally {
      await retainEvidence(root, "source");
    }
  });
});
