// owner: docs/engineering/testing/e2e/cli.md#cli-positive-selection
// rerun: pnpm e2e --repo cli -- --run test/selection.test.ts

import { join, resolve } from "node:path";
import { command, withProjectCopy } from "@niceeval/testkit";
import { expect, test } from "vitest";

interface ExpPlanDocument {
  matrix: Array<{ evalId: string }>;
}

const niceeval = command([join(process.cwd(), "node_modules", ".bin", "niceeval")]);
const projectCopy = {
  from: process.cwd(),
  prefix: "niceeval-e2e-cli-selection-",
  omitTopLevel: [".niceeval", "junit", "node_modules", "test"],
  links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
} as const;

test("Eval 前缀只选择命中的 Eval", async () => {
  await withProjectCopy(projectCopy, async ({ root }) => {
    const receipt = await niceeval.run(["exp", "normal", "greet", "--dry", "--json"], { cwd: root });

    expect(receipt.exitCode, receipt.diagnostic()).toBe(0);
    const plan = receipt.json<ExpPlanDocument>();
    expect(plan.matrix.map((row) => row.evalId)).toEqual(["greet/hello"]);
  });
});
