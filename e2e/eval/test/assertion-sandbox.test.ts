// owner: docs/engineering/testing/e2e/eval.md#eval-assertion-sandbox
// rerun: pnpm e2e --repo eval -- --run test/assertion-sandbox.test.ts

import { join } from "node:path";
import { command, only, withProjectCopy } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { evalArtifactStaging, evalProjectCopy } from "./support.ts";

interface ExpEvent {
  event: string;
  evalId?: string;
  locator?: string;
  verdict?: string;
}

const niceeval = command([join(process.cwd(), "node_modules", ".bin", "niceeval")]);

test("Sandbox Assertion Eval 以 passed 终态完成", async () => {
  await withProjectCopy(
    evalProjectCopy,
    async ({ root }) => {
      const run = await niceeval.run(["exp", "assertion-sandbox", "--rerun", "all", "--json"], { cwd: root });
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
    },
    evalArtifactStaging("sandbox"),
  );
});
