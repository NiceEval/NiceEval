// owner: docs/engineering/testing/e2e/eval.md#eval-assertion-judge-unavailable
// rerun: pnpm e2e --repo eval -- --run test/assertion-judge-unavailable.test.ts

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

test("未配置 Judge 时硬消费的 Judge Fact 以 unavailable errored，且不发起网络请求", async () => {
  await withProjectCopy(
    evalProjectCopy,
    async ({ root }) => {
      const run = await niceeval.run(["exp", "assertion-judge", "--rerun", "all", "--json"], { cwd: root });
      expect(run.exitCode, run.diagnostic()).toBe(1);
      expect(run.expReceipt(), run.diagnostic()).toMatchObject({ completion: "completed" });
      const evaluation = only(
        run.ndjson<ExpEvent>(),
        (event) =>
          event.event === "eval" && event.evalId === "assertion-judge-unavailable" && event.locator !== undefined,
        run.diagnostic(),
      );
      expect(evaluation).toMatchObject({
        event: "eval",
        evalId: "assertion-judge-unavailable",
        verdict: "errored",
        attempts: 1,
      });
      const locator = evaluation.locator!;

      const record = await openRecord(join(root, ".niceeval"));
      const attempt = resolveLocator(record, locator);
      expect(attempt.result.verdict).toBe("errored");
      expect(attempt.result.factResults).toEqual(expect.arrayContaining([
        expect.objectContaining({ factKind: "score", outcome: "unavailable", reason: "judge-model-unresolved" }),
      ]));
      expect(attempt.result.factUses).toEqual(expect.arrayContaining([
        expect.objectContaining({ useKind: "verdict", label: "Judge marker", outcome: "unavailable", reason: "judge-model-unresolved" }),
      ]));
      // The only public model boundary is the result record. A missing model
      // yields this exact reason before precheck or evaluator transport, so no
      // network-capable Judge path was entered.
      expect(JSON.stringify(attempt.result)).not.toContain("judge-precheck-failed");
      expect(JSON.stringify(attempt.result)).not.toContain("judge-call-failed");
    },
    evalArtifactStaging("judge-unavailable"),
  );
});
