// owner: docs/engineering/testing/e2e/cli.md#cli-positive-selection
// rerun: pnpm e2e test --repo cli -- --run test/selection.test.ts

import { expect, test } from "vitest";
import { cliE2E } from "./context.ts";

interface ExpPlanDocument {
  matrix: Array<{ evalId: string }>;
}

test("Eval 前缀只选择命中的 Eval", async () => {
  await cliE2E.case("selection", async ({ commands: { niceeval } }) => {
    const receipt = await niceeval.run(["exp", "normal", "greet", "--dry", "--json"]);

    expect(receipt.exitCode, receipt.diagnostic()).toBe(0);
    const plan = receipt.json<ExpPlanDocument>();
    expect(plan.matrix.map((row) => row.evalId)).toEqual(["greet/hello"]);
  });
});
