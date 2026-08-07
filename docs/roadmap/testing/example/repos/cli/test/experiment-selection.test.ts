import { rmSync } from "node:fs";
import { beforeEach, expect, test } from "vitest";
import { parseJson, runProcess } from "./support/process.ts";

// NiceEval 根目录：pnpm e2e --repo cli -- --run test/experiment-selection.test.ts
// 已安装候选包的隔离 Repo 根：pnpm test --run test/experiment-selection.test.ts

interface PlanDocument {
  format: "niceeval.exp-plan";
  schemaVersion: number;
  matrix: Array<{ experimentId: string; evalId: string }>;
}

beforeEach(() => rmSync(".niceeval", { recursive: true, force: true }));

test("exp --dry --json distinguishes an exact experiment from its sibling prefix", async () => {
  const result = await runProcess([
    "pnpm", "--silent", "exec", "niceeval",
    "exp", "compare/base", "--dry", "--json",
  ]);
  expect(result.exitCode, result.diagnostic()).toBe(0);
  expect(result.stderr).toBe("");

  const plan = parseJson<PlanDocument>(result.stdout, result.diagnostic());
  expect(plan).toMatchObject({ format: "niceeval.exp-plan", schemaVersion: 3 });
  expect(plan.matrix.map((row) => row.experimentId)).toEqual(["compare/base"]);
  expect(plan.matrix.map((row) => row.evalId)).toEqual(["smoke/passes"]);
});
