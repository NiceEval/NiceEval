// owner: docs/engineering/testing/e2e/eval.md#eval-assertion-scopes
// rerun: pnpm e2e --repo eval -- --run test/assertion-scopes.test.ts

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

test("turn、session 与 attempt scope Eval 以 passed 终态完成", async () => {
  await withProjectCopy(
    evalProjectCopy,
    async ({ root }) => {
      const run = await niceeval.run(["exp", "assertion-scopes", "--rerun", "all", "--json"], { cwd: root });
      expect(run.exitCode, run.diagnostic()).toBe(0);
      expect(run.expReceipt(), run.diagnostic()).toMatchObject({ completion: "completed" });
      const evaluation = only(
        run.ndjson<ExpEvent>(),
        (event) => event.event === "eval" && event.evalId === "assertion-scopes" && event.locator !== undefined,
        run.diagnostic(),
      );
      expect(evaluation).toMatchObject({
        event: "eval",
        evalId: "assertion-scopes",
        verdict: "passed",
      });
    },
    evalArtifactStaging("scopes"),
  );
});
