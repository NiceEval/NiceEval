import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { command, defined, only, withProjectCopy } from "@niceeval/testkit";
import { expect, test } from "vitest";

// 场景 Repo：e2e/runner（本设计稿位于 example/repos/runner）。
// 从 NiceEval 根目录运行：pnpm e2e --repo runner -- --run test/carry-reuse.test.ts
// 从已安装候选包的隔离 Repo 根运行：pnpm test --run test/carry-reuse.test.ts
// 固定 launcher 在文件头可见；RUN / RUN_ALL / DRY 保留完整子命令与 flags。
// feature: docs/feature/experiments/cache.md

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

const niceeval = command(["pnpm", "--silent", "exec", "niceeval"]);
const RUN = ["exp", "carry", "--json"] as const;
const RUN_ALL = ["exp", "carry", "--rerun", "all", "--json"] as const;
const DRY = ["exp", "carry", "--dry", "--json"] as const;
const PROJECT_COPY = {
  from: process.cwd(),
  prefix: "niceeval-e2e-carry-",
  omitTopLevel: [".niceeval", "node_modules", "test"],
  links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
} as const;

async function readPlan(args: readonly string[], cwd?: string): Promise<ExpPlanDocument> {
  const result = await niceeval.run(args, cwd ? { cwd } : undefined);
  expect(result.exitCode, result.diagnostic()).toBe(0);
  const document = result.json<ExpPlanDocument>();
  expect(document.format).toBe("niceeval.exp-plan");
  expect(document.schemaVersion).toBe(3);
  return document;
}

async function runAndReadReused(args: readonly string[], cwd?: string): Promise<number> {
  const result = await niceeval.run(args, cwd ? { cwd } : undefined);
  expect(result.exitCode, result.diagnostic()).toBe(0);
  const events = result.ndjson<ExpEvent>();
  const start = only(events, (item) => item.event === "start", result.diagnostic());
  return defined(start.reused, result.diagnostic());
}

// 指纹命中时默认 rerun 全携入：dry plan 预测的携入数与真实 run 的携入数不得分叉
// （planCarry 与调度共用同一次判断，docs/feature/experiments/cli.md「AI 常见循环」）。
// 结果根属于本 case 的私有副本，不与其它测试共享。
test("dry plan 预测的携入数与真实 run 一致且全部命中", async () => {
  await withProjectCopy(PROJECT_COPY, async (copy) => {
    expect(await runAndReadReused(RUN_ALL, copy.root)).toBe(0);

    const planned = await readPlan(DRY, copy.root);
    expect(planned.reused).toBe(planned.total);
    expect(planned.matrix.every((row) => row.reused)).toBe(true);

    expect(await runAndReadReused(RUN, copy.root)).toBe(planned.reused);
  });
});

// config 内容变化触发指纹门：configHash 变了，dry plan 如实标 reused: false
// （cache.md「指纹门」）。本测试只改隔离副本里的 config，不改共享现场、不写回；
// judge.model 进 configHash，labels 不进（docs/feature/experiments/library.md「labels」）。
test("修改 config 后 dry plan 不再预测任何携入", async () => {
  await withProjectCopy({
    ...PROJECT_COPY,
    prefix: "niceeval-e2e-carry-config-",
  }, async (copy) => {
    expect(await runAndReadReused(RUN_ALL, copy.root)).toBe(0);

    const configPath = join(copy.root, "niceeval.config.ts");
    const configV2 = [
      `import { defineConfig } from "niceeval";`,
      ``,
      `export default defineConfig({`,
      `  judge: { model: "gpt-5.6-sol" },`,
      `});`,
      ``,
    ].join("\n");
    writeFileSync(configPath, configV2, "utf8");

    const planned = await readPlan(DRY, copy.root);
    expect(planned.matrix.every((row) => !row.reused)).toBe(true);
    expect(planned.reused).toBe(0);

    expect(await runAndReadReused(RUN, copy.root)).toBe(0);
  });
});

// 部分补跑不得抹掉更早 run 的携入结果：完整 run 后只改一条 eval，下一次整组运行
// 时未变化的 eval 仍从第一次 run 携入（regression: memory/rerun-with-eval-filter-
// partial-snapshot.md，跨历史每 eval 取最新基线）。全部在隔离副本里
// 完成 full → partial → full，不碰共享现场。
test("full → partial → full：部分补跑后未变化 eval 仍从更早 run 携入", async () => {
  await withProjectCopy({
    ...PROJECT_COPY,
    prefix: "niceeval-e2e-carry-partial-",
  }, async (copy) => {
    expect(await runAndReadReused(RUN_ALL, copy.root)).toBe(0);

    const alphaPath = join(copy.root, "evals", "simple", "alpha.eval.ts");
    const alphaV2 = readFileSync(alphaPath, "utf8").replace('includes("fixture")', 'includes("固定回复")');
    writeFileSync(alphaPath, alphaV2, "utf8");

    const partialPlan = await readPlan(DRY, copy.root);
    const alpha = only(partialPlan.matrix, (row) => row.evalId === "simple/alpha", "partial plan");
    const beta = only(partialPlan.matrix, (row) => row.evalId === "simple/beta", "partial plan");
    expect(alpha.reused).toBe(false);
    expect(beta.reused).toBe(true);
    expect(partialPlan.reused).toBe(1);

    expect(await runAndReadReused(RUN, copy.root)).toBe(1);

    const fullPlan = await readPlan(DRY, copy.root);
    expect(fullPlan.reused).toBe(fullPlan.total);
    expect(fullPlan.matrix.every((row) => row.reused)).toBe(true);

    expect(await runAndReadReused(RUN, copy.root)).toBe(fullPlan.reused);
  });
});
