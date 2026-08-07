// feature: docs/engineering/testing/e2e/README.md
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { command, defined, only, withProjectCopy } from "@niceeval/testkit";
import { expect, test } from "vitest";

interface ExpPlanDocument {
  format: "niceeval.exp-plan";
  schemaVersion: number;
  total: number;
  reused: number;
  matrix: Array<{ experimentId: string; evalId: string; reused: boolean }>;
}

interface ExpEvent {
  event: string;
  reused?: number;
  total?: number;
}

const niceeval = command([join(process.cwd(), "node_modules", ".bin", "niceeval")]);
const projectCopy = {
  from: process.cwd(),
  prefix: "niceeval-e2e-runner-carry-",
  omitTopLevel: [".niceeval", "node_modules", "test"],
  links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
} as const;

async function readPlan(args: readonly string[], cwd: string): Promise<ExpPlanDocument> {
  const receipt = await niceeval.run(args, { cwd });
  expect(receipt.exitCode, receipt.diagnostic()).toBe(0);
  const plan = receipt.json<ExpPlanDocument>();
  expect(plan).toMatchObject({ format: "niceeval.exp-plan", schemaVersion: 3 });
  return plan;
}

async function runAndReadReused(args: readonly string[], cwd: string): Promise<number> {
  const receipt = await niceeval.run(args, { cwd });
  expect(receipt.exitCode, receipt.diagnostic()).toBe(0);
  const events = receipt.ndjson<ExpEvent>();
  const start = only(events, (event) => event.event === "start", receipt.diagnostic());
  const result = only(events, (event) => event.event === "result", receipt.diagnostic());
  expect(result).toMatchObject({ event: "result" });
  return defined(start.reused, receipt.diagnostic());
}

test("dry 与真实 dispatch 对同一 carry 基线给出一致结果", async () => {
  await withProjectCopy(projectCopy, async ({ root }) => {
    expect(await runAndReadReused(["exp", "carry", "--rerun", "all", "--json"], root)).toBe(0);

    const plan = await readPlan(["exp", "carry", "--dry", "--json"], root);
    expect(plan.total).toBe(2);
    expect(plan.reused).toBe(2);
    expect(plan.matrix.map((row) => row.evalId).sort()).toEqual(["simple/alpha", "simple/beta"]);
    expect(plan.matrix.every((row) => row.reused)).toBe(true);

    expect(await runAndReadReused(["exp", "carry", "--json"], root)).toBe(2);
  });
});

test("修改一条 Eval 后只补跑该 identity，未变化 Eval 仍从旧基线携入", async () => {
  await withProjectCopy(
    { ...projectCopy, prefix: "niceeval-e2e-runner-partial-" },
    async ({ root }) => {
      expect(await runAndReadReused(["exp", "carry", "--rerun", "all", "--json"], root)).toBe(0);

      const alphaPath = join(root, "evals", "simple", "alpha.eval.ts");
      writeFileSync(
        alphaPath,
        readFileSync(alphaPath, "utf8").replace('t.messageIncludes("runner-fixture-ok")', 't.messageIncludes(/runner-fixture-ok/)'),
        "utf8",
      );

      const partial = await readPlan(
        ["exp", "carry", "simple/alpha", "--dry", "--json"],
        root,
      );
      expect(partial.matrix).toMatchObject([
        { experimentId: "carry", evalId: "simple/alpha", reused: false },
      ]);
      expect(
        await runAndReadReused(["exp", "carry", "simple/alpha", "--json"], root),
      ).toBe(0);

      const full = await readPlan(["exp", "carry", "--dry", "--json"], root);
      expect(full.total).toBe(2);
      expect(full.reused).toBe(2);
      expect(full.matrix.every((row) => row.reused)).toBe(true);
      expect(await runAndReadReused(["exp", "carry", "--json"], root)).toBe(2);
    },
  );
});
