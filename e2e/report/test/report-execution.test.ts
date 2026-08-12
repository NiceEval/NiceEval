// owner: docs/engineering/testing/e2e/report.md#report-execution-evidence
// rerun: pnpm e2e --repo report -- --run test/report-execution.test.ts

import { command, only, withProjectCopy } from "@niceeval/testkit";
import { join } from "node:path";
import { expect, test } from "vitest";
import { reportArtifactStaging, reportProjectCopy } from "./support.ts";

interface ExpEvent {
  event: string;
  evalId?: string;
  locator?: string;
}

const niceeval = command([join(process.cwd(), "node_modules", ".bin", "niceeval")]);

test("show --execution 呈现本轮 conversation 正文与终态", async () => {
  await withProjectCopy(
    reportProjectCopy,
    async ({ root }) => {
      const run = await niceeval.run(["exp", "main", "--rerun", "all", "--json"], { cwd: root });
      expect(run.exitCode, run.diagnostic()).not.toBe(0);

      const toolCall = only(
        run.ndjson<ExpEvent>(),
        (event) => event.event === "eval" && event.evalId === "tool-call" && event.locator !== undefined,
        run.diagnostic(),
      );

      const shown = await niceeval.run(
        ["show", toolCall.locator!, "--record", ".niceeval/record", "--execution"],
        { cwd: root },
      );
      expect(shown.exitCode, shown.diagnostic()).toBe(0);
      expect(shown.stdout).toContain("Deterministic report fixture response.");
      expect(shown.stdout).toMatch(/\bconversation\b/i);
      expect(shown.stdout).toMatch(/\bcompleted\b/i);
    },
    reportArtifactStaging("execution"),
  );
});
