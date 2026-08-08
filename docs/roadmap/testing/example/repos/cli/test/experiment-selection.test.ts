// feature: docs/feature/experiments/cli.md
import { resolve } from "node:path";
import { command, withProjectCopy } from "@niceeval/testkit";
import { expect, test } from "vitest";

// NiceEval 根目录：pnpm e2e --repo cli -- --run test/experiment-selection.test.ts
// 已安装候选包的隔离 Repo 根：pnpm test --run test/experiment-selection.test.ts

interface PlanDocument {
  format: "niceeval.exp-plan";
  schemaVersion: number;
  matrix: Array<{ experimentId: string; evalId: string }>;
}

const niceeval = command(["pnpm", "--silent", "exec", "niceeval"]);
const PROJECT_COPY = {
  from: process.cwd(),
  prefix: "niceeval-e2e-cli-selection-",
  omitTopLevel: [".niceeval", "node_modules", "test"],
  links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
} as const;

test("exp --dry --json 只选择精确 experiment，不误选同前缀兄弟", async () => {
  await withProjectCopy(PROJECT_COPY, async ({ root }) => {
    const result = await niceeval.run(["exp", "compare/base", "--dry", "--json"], { cwd: root });
    expect(result.exitCode, result.diagnostic()).toBe(0);
    expect(result.stderr).toBe("");

    const plan = result.json<PlanDocument>();
    expect(plan).toMatchObject({ format: "niceeval.exp-plan", schemaVersion: 3 });
    expect(plan.matrix.map((row) => row.experimentId)).toEqual(["compare/base"]);
    expect(plan.matrix.map((row) => row.evalId)).toEqual(["outcomes/passes"]);
  });
});
