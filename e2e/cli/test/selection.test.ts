// owner: docs/engineering/testing/e2e/cli.md#cli-positive-selection
// rerun: pnpm e2e --repo cli -- --run test/selection.test.ts

import { join, resolve } from "node:path";
import { command, withProjectCopy } from "@niceeval/testkit";
import { expect, test } from "vitest";

interface ExpPlanDocument {
  format: string;
  schemaVersion: number;
  matrix: Array<{ experimentId: string; evalId: string; reused: boolean }>;
}

const niceeval = command([join(process.cwd(), "node_modules", ".bin", "niceeval")]);
const projectCopy = {
  from: process.cwd(),
  prefix: "niceeval-e2e-cli-selection-",
  omitTopLevel: [".niceeval", "junit", "node_modules", "test"],
  links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
} as const;

test.each([
  {
    name: "greet 前缀只选择 greet/hello",
    argv: ["exp", "normal", "greet", "--dry", "--json"],
    expectedEvalIds: ["greet/hello"],
  },
  {
    name: "tool 前缀只选择 tool/weather",
    argv: ["exp", "normal", "tool", "--dry", "--json"],
    expectedEvalIds: ["tool/weather"],
  },
  {
    name: "省略 Eval 前缀选择 normal 的全部 Eval",
    argv: ["exp", "normal", "--dry", "--json"],
    expectedEvalIds: ["greet/hello", "tool/weather"],
  },
])("$name", async ({ argv, expectedEvalIds }) => {
  await withProjectCopy(projectCopy, async ({ root }) => {
    const receipt = await niceeval.run(argv, { cwd: root });

    expect(receipt.exitCode, receipt.diagnostic()).toBe(0);
    const plan = receipt.json<ExpPlanDocument>();
    expect(plan).toMatchObject({ format: "niceeval.exp-plan", schemaVersion: 3 });
    expect(plan.matrix.map((row) => row.evalId).sort()).toEqual([...expectedEvalIds].sort());
  });
});
