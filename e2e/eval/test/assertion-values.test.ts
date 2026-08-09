// owner: docs/engineering/testing/e2e/eval.md#eval-assertion-values
// rerun: pnpm e2e --repo eval -- --run test/assertion-values.test.ts

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

test("值 Match 通过原生 Fact 消费折叠为 passed", async () => {
  await withProjectCopy(
    evalProjectCopy,
    async ({ root }) => {
      const run = await niceeval.run(["exp", "assertion-values", "--rerun", "all", "--json"], { cwd: root });
      expect(run.exitCode, run.diagnostic()).toBe(0);
      const result = only(run.ndjson<ExpEvent>(), (event) => event.event === "result", run.diagnostic());
      expect(result).toMatchObject({ event: "result", status: "passed", passed: 1, failed: 0 });
      const locator = only(
        run.ndjson<ExpEvent>(),
        (event) => event.event === "eval" && event.evalId === "assertion-values" && event.locator !== undefined,
        run.diagnostic(),
      ).locator!;

      const shown = await niceeval.run(["show", locator, "--record", ".niceeval", "--json"], { cwd: root });
      expect(shown.exitCode, shown.diagnostic()).toBe(0);
      expect(shown.stdout).toContain("assertion-values-marker");

      const record = await openRecord(join(root, ".niceeval"));
      const attempt = resolveLocator(record, locator);
      expect(attempt.result.verdict).toBe("passed");
      expect(attempt.result.evaluationAlgorithm).toBe("fact-use/v2");
      expect(attempt.result.factResults).toContainEqual(
        expect.objectContaining({ name: "satisfies(two values)", outcome: "passed" }),
      );
    },
    evalArtifactStaging("values"),
  );
});
