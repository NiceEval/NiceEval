// owner: docs/engineering/testing/e2e/eval.md#eval-assertion-score
// rerun: pnpm e2e --repo eval -- --run test/assertion-score.test.ts

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

test("计分制 handle modifiers 与直接给分写入公开 Record", async () => {
  await withProjectCopy(
    evalProjectCopy,
    async ({ root }) => {
      const run = await niceeval.run(["exp", "assertion-score", "--rerun", "all", "--json"], { cwd: root });
      expect(run.exitCode, run.diagnostic()).toBe(0);
      const result = only(run.ndjson<ExpEvent>(), (event) => event.event === "result", run.diagnostic());
      expect(result).toMatchObject({ event: "result", status: "passed", passed: 1, failed: 0 });
      const locator = only(
        run.ndjson<ExpEvent>(),
        (event) => event.event === "eval" && event.evalId === "assertion-score" && event.locator !== undefined,
        run.diagnostic(),
      ).locator!;

      const record = await openRecord(join(root, ".niceeval"));
      const attempt = resolveLocator(record, locator);
      expect(attempt.result.verdict).toBe("passed");
      expect(attempt.result.evaluationKind).toBe("points");
      expect(attempt.result.scoreEntries).toContainEqual(
        expect.objectContaining({ label: "deterministic manual points", points: 4 }),
      );
    },
    evalArtifactStaging("score"),
  );
});
