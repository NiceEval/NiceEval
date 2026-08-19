// owner: docs/engineering/testing/e2e/eval.md#eval-assertion-sandbox
// regression: memory/workspace-diff-path-cap-skips-partial-capture.md
// rerun: pnpm e2e --repo eval -- --run test/assertion-sandbox.test.ts

import { only } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { evalE2E } from "./context.ts";

interface ExpEvent {
  event: string;
  evalId?: string;
  locator?: string;
  verdict?: string;
}

interface ShowDocument {
  readonly data: {
    readonly kind: string;
    readonly fileChanges?: unknown;
  };
}

test("Sandbox Assertion Eval 以 passed 终态完成", async () => {
  await evalE2E.case(
    "sandbox",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ commands: { niceeval } }) => {
      const run = await niceeval.run(["exp", "assertion-sandbox", "--rerun", "all", "--json"]);
      expect(run.exitCode, run.diagnostic()).toBe(0);
      expect(run.expReceipt(), run.diagnostic()).toMatchObject({ completion: "completed" });
      const evaluation = only(
        run.ndjson<ExpEvent>(),
        (event) => event.event === "eval" && event.evalId === "assertion-sandbox" && event.locator !== undefined,
        run.diagnostic(),
      );
      expect(evaluation).toMatchObject({
        event: "eval",
        evalId: "assertion-sandbox",
        verdict: "passed",
      });
      expect(`${run.stdout}\n${run.stderr}`).not.toContain("workspace-diff-unavailable");
      const bulkEvaluation = only(
        run.ndjson<ExpEvent>(),
        (event) => event.event === "eval" && event.evalId === "workspace-diff-cap" && event.locator !== undefined,
        run.diagnostic(),
      );
      expect(bulkEvaluation).toMatchObject({ verdict: "passed" });
      const shown = await niceeval.run(["show", bulkEvaluation.locator!, "--json"]);
      expect(shown.exitCode, shown.diagnostic()).toBe(0);
      const document = shown.json<ShowDocument>();
      expect(document.data.kind).toBe("attempt");
      expect(JSON.stringify(document.data.fileChanges)).toContain("collection-cap-reached");
    },
  );
});
