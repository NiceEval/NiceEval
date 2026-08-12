// owner: docs/engineering/testing/e2e/eval.md#eval-assertion-scopes
// rerun: pnpm e2e --repo eval -- --run test/assertion-scopes.test.ts

import { join } from "node:path";
import { openRecord, resolveLocator } from "niceeval/record";
import { command, only, withProjectCopy } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { evalArtifactStaging, evalProjectCopy } from "./support.ts";

interface ExpEvent {
  event: string;
  evalId?: string;
  locator?: string;
  verdict?: string;
  attempts?: number;
  passed?: number;
}

const niceeval = command([join(process.cwd(), "node_modules", ".bin", "niceeval")]);

test("turn、session 与 attempt scope 都以同一批真实工具事件完成断言", async () => {
  await withProjectCopy(
    evalProjectCopy,
    async ({ root }) => {
      const run = await niceeval.run(["exp", "assertion-scopes", "--rerun", "all", "--json"], { cwd: root });
      expect(run.exitCode, run.diagnostic()).toBe(0);
      const evaluation = only(
        run.ndjson<ExpEvent>(),
        (event) => event.event === "eval" && event.evalId === "assertion-scopes" && event.locator !== undefined,
        run.diagnostic(),
      );
      expect(evaluation).toMatchObject({
        event: "eval",
        evalId: "assertion-scopes",
        verdict: "passed",
        attempts: 1,
        passed: 1,
      });
      const locator = evaluation.locator!;

      const shown = await niceeval.run(["show", locator, "--record", ".niceeval", "--execution"], { cwd: root });
      expect(shown.exitCode, shown.diagnostic()).toBe(0);
      expect(shown.stdout).toContain("scope_main_tool");
      expect(shown.stdout).toContain("scope_branch_tool");

      const record = await openRecord(join(root, ".niceeval"));
      const attempt = resolveLocator(record, locator);
      expect(attempt.result.verdict).toBe("passed");
      expect((await attempt.events())?.filter((event) => event.type === "operation.started")).toHaveLength(2);
    },
    evalArtifactStaging("scopes"),
  );
});
