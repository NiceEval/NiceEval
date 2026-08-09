// owner: docs/engineering/testing/e2e/eval.md#eval-assertion-sandbox
// rerun: pnpm e2e --repo eval -- --run test/assertion-sandbox.test.ts

import { join } from "node:path";
import { openRecord, resolveLocator } from "niceeval/record";
import { command, only, withProjectCopy } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { evalArtifactStaging, evalProjectCopy } from "./support.ts";

interface ExpEvent {
  event: string;
  evalId?: string;
  locator?: string;
  status?: string;
  passed?: number;
  failed?: number;
}

const niceeval = command([join(process.cwd(), "node_modules", ".bin", "niceeval")]);

test("Sandbox 的真实文件与 shell evidence 由公开断言和 Record 判定", async () => {
  await withProjectCopy(
    evalProjectCopy,
    async ({ root }) => {
      const run = await niceeval.run(["exp", "assertion-sandbox", "--rerun", "all", "--json"], { cwd: root });
      expect(run.exitCode, run.diagnostic()).toBe(0);
      const result = only(run.ndjson<ExpEvent>(), (event) => event.event === "result", run.diagnostic());
      expect(result).toMatchObject({ event: "result", status: "passed", passed: 1, failed: 0 });
      const locator = only(
        run.ndjson<ExpEvent>(),
        (event) => event.event === "eval" && event.evalId === "assertion-sandbox" && event.locator !== undefined,
        run.diagnostic(),
      ).locator!;

      const shown = await niceeval.run(["show", locator, "--record", ".niceeval", "--execution"], { cwd: root });
      expect(shown.exitCode, shown.diagnostic()).toBe(0);
      expect(shown.stdout).toContain("workspace_edit");

      const record = await openRecord(join(root, ".niceeval"));
      const attempt = resolveLocator(record, locator);
      expect(attempt.result.verdict).toBe("passed");
      const diff = await attempt.diff();
      expect(JSON.stringify(diff)).toContain("after-agent-change");
      expect(JSON.stringify(diff)).toContain("created-by-agent");
    },
    evalArtifactStaging("sandbox"),
  );
});
