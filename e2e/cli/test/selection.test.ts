// rerun: pnpm e2e test --repo cli -- --run test/selection.test.ts

import { expect, test } from "vitest";
import { cliE2E } from "./context.ts";

interface ExpPlanDocument {
  matrix: Array<{ experimentId: string; evalId: string }>;
}

test("Eval 前缀只选择命中的 Eval [necase_YK8ZQ0WBWK6999X3]", async () => {
  await cliE2E.case("selection", async ({ commands: { niceeval } }) => {
    const receipt = await niceeval.run(["exp", "normal", "greet", "--dry", "--json"]);

    expect(receipt.exitCode, receipt.diagnostic()).toBe(0);
    const plan = receipt.json<ExpPlanDocument>();
    expect(plan.matrix.map((row) => row.evalId)).toEqual(["greet/hello"]);
  });
});

test("Setup cache 策略按默认与显式 flag 保持正向选择 [necase_8TBNSVGZA341X9C0]", async () => {
  await cliE2E.case("sandbox-setup-cache-selection", async ({ commands: { niceeval } }) => {
    for (const flag of [undefined, "use", "bypass"] as const) {
      const receipt = await niceeval.run([
        "exp",
        "normal",
        "greet",
        "--dry",
        "--json",
        ...(flag === undefined ? [] : [`--sandbox-setup-cache=${flag}`]),
      ]);

      expect(receipt.exitCode, receipt.diagnostic()).toBe(0);
      const plan = receipt.json<ExpPlanDocument>();
      expect(plan.matrix.map(({ experimentId, evalId }) => [experimentId, evalId])).toEqual([
        ["normal", "greet/hello"],
      ]);
    }

    const invalid = await niceeval.run([
      "exp",
      "normal",
      "greet",
      "--dry",
      "--sandbox-setup-cache=stale",
    ]);
    expect(invalid.exitCode, invalid.diagnostic()).not.toBe(0);
    expect(invalid.stderr).toContain("--sandbox-setup-cache accepts use or bypass");
  });
});
