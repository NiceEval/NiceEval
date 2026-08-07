import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { command, defined, only } from "./api.ts";
import { withProjectCopy } from "../repos/runner-carry/test/support/project.ts";

// 正式迁移后改为从精确锁定的 @niceeval/testkit 导入。
// 固定 launcher 在文件头可见，每次调用仍写完整 niceeval 子命令和 flags。
const niceeval = command(["pnpm", "--silent", "exec", "niceeval"]);

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
}

async function readPlan(args: readonly string[], cwd?: string): Promise<ExpPlanDocument> {
  const receipt = await niceeval.run(args, { cwd });
  expect(receipt.exitCode, receipt.diagnostic()).toBe(0);
  const plan = receipt.json<ExpPlanDocument>();
  expect(plan).toMatchObject({ format: "niceeval.exp-plan", schemaVersion: 3 });
  return plan;
}

async function readReused(args: readonly string[], cwd?: string): Promise<number> {
  const receipt = await niceeval.run(args, { cwd });
  expect(receipt.exitCode, receipt.diagnostic()).toBe(0);
  const start = only(
    receipt.ndjson<ExpEvent>(),
    (event) => event.event === "start",
    () => receipt.diagnostic(),
  );
  return defined(start.reused, () => receipt.diagnostic());
}

test("dry plan 预测的携入数与真实 run 一致且全部命中", async () => {
  expect(await readReused(["exp", "smoke", "--rerun", "all", "--json"])).toBe(0);

  const plan = await readPlan(["exp", "smoke", "--dry", "--json"]);
  expect(plan.reused).toBe(plan.total);
  expect(plan.matrix.every((row) => row.reused)).toBe(true);

  expect(await readReused(["exp", "smoke", "--json"])).toBe(plan.reused);
});

test("修改 config 后 dry plan 不再预测任何携入", async () => {
  await withProjectCopy("niceeval-e2e-carry-config-", async ({ root }) => {
    expect(await readReused(["exp", "smoke", "--rerun", "all", "--json"], root)).toBe(0);

    writeFileSync(join(root, "niceeval.config.ts"), [
      `import { defineConfig } from "niceeval";`,
      `export default defineConfig({ judge: { model: "gpt-5.6-sol" } });`,
      ``,
    ].join("\n"));

    const plan = await readPlan(["exp", "smoke", "--dry", "--json"], root);
    expect(plan.reused).toBe(0);
    expect(plan.matrix.every((row) => !row.reused)).toBe(true);
    expect(await readReused(["exp", "smoke", "--json"], root)).toBe(0);
  });
});

// regression: 85cafd7d
test("full → partial → full 后未变化 eval 仍从更早 run 携入", async () => {
  await withProjectCopy("niceeval-e2e-carry-partial-", async ({ root }) => {
    expect(await readReused(["exp", "smoke", "--rerun", "all", "--json"], root)).toBe(0);

    const path = join(root, "evals/simple/alpha.eval.ts");
    writeFileSync(path, readFileSync(path, "utf8")
      .replace('includes("fixture")', 'includes("固定回复")'));

    const partial = await readPlan(["exp", "smoke", "--dry", "--json"], root);
    expect(only(partial.matrix, (row) => row.evalId === "simple/alpha").reused).toBe(false);
    expect(only(partial.matrix, (row) => row.evalId === "simple/beta").reused).toBe(true);
    expect(await readReused(["exp", "smoke", "--json"], root)).toBe(1);

    const full = await readPlan(["exp", "smoke", "--dry", "--json"], root);
    expect(full.reused).toBe(full.total);
    expect(await readReused(["exp", "smoke", "--json"], root)).toBe(full.reused);
  });
});
