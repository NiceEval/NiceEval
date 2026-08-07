// feature: docs/feature/experiments/cache.md
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { command, defined, only, withProjectCopy } from "@niceeval/testkit";
import { expect, test } from "vitest";

// 场景 Repo：e2e/runner（本设计稿位于 example/repos/runner）。
// 从 NiceEval 根目录运行：pnpm e2e --repo runner -- --run test/carry-reuse.test.ts
// 从已安装候选包的隔离 Repo 根运行：pnpm test --run test/carry-reuse.test.ts
// 固定 launcher 在文件头可见；FULL / PARTIAL 常量保留完整子命令与 flags，不隐藏 argv。

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
const RUN_FULL_ALL = ["exp", "carry", "--rerun", "all", "--json"] as const;
const RUN_FULL = ["exp", "carry", "--json"] as const;
const DRY_FULL = ["exp", "carry", "--dry", "--json"] as const;
const RUN_PARTIAL_ALPHA = ["exp", "carry", "simple/alpha", "--json"] as const;
const DRY_PARTIAL_ALPHA = ["exp", "carry", "simple/alpha", "--dry", "--json"] as const;
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
    expect(await runAndReadReused(RUN_FULL_ALL, copy.root)).toBe(0);

    const planned = await readPlan(DRY_FULL, copy.root);
    expect(planned.reused).toBe(planned.total);
    expect(planned.matrix.every((row) => row.reused)).toBe(true);

    expect(await runAndReadReused(RUN_FULL, copy.root)).toBe(planned.reused);
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
    expect(await runAndReadReused(RUN_FULL_ALL, copy.root)).toBe(0);

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

    const planned = await readPlan(DRY_FULL, copy.root);
    expect(planned.matrix.every((row) => !row.reused)).toBe(true);
    expect(planned.reused).toBe(0);

    expect(await runAndReadReused(RUN_FULL, copy.root)).toBe(0);
  });
});

// 部分补跑不得抹掉更早 run 的携入结果：完整 run 后只改一条 eval，用公开 eval selector
// 只补跑 simple/alpha（dry 与 run 都是同一个 selector），下一次整组 dry 时 alpha 从部分
// run 携入、beta 从更早的完整 run 携入（跨历史每 eval 取最新基线）。全部在隔离副本里
// 完成 full → partial → full，不碰共享现场。
// regression: memory/rerun-with-eval-filter-partial-snapshot.md
test("full → partial → full：部分补跑后未变化 eval 仍从更早 run 携入", async () => {
  await withProjectCopy({
    ...PROJECT_COPY,
    prefix: "niceeval-e2e-carry-partial-",
  }, async (copy) => {
    expect(await runAndReadReused(RUN_FULL_ALL, copy.root)).toBe(0);

    const alphaPath = join(copy.root, "evals", "simple", "alpha.eval.ts");
    const alphaV2 = readFileSync(alphaPath, "utf8").replace('includes("fixture")', 'includes("固定回复")');
    writeFileSync(alphaPath, alphaV2, "utf8");

    // eval selector 的 dry plan 只含 simple/alpha：这次计划里没有 beta，不整组断言。
    const partialPlan = await readPlan(DRY_PARTIAL_ALPHA, copy.root);
    expect(partialPlan.matrix.map((row) => row.evalId)).toEqual(["simple/alpha"]);
    const alpha = only(partialPlan.matrix, (row) => row.evalId === "simple/alpha", "partial plan");
    expect(alpha.reused).toBe(false);
    expect(partialPlan.reused).toBe(0);

    // 同样的 eval selector 实跑：只补跑 alpha，不是把完整 Experiment 再跑一遍。
    expect(await runAndReadReused(RUN_PARTIAL_ALPHA, copy.root)).toBe(0);

    // 完整 dry：alpha 从部分 run 携入、beta 从更早的完整 run 携入，两者都 reused。
    const fullPlan = await readPlan(DRY_FULL, copy.root);
    expect(fullPlan.reused).toBe(fullPlan.total);
    expect(fullPlan.matrix.every((row) => row.reused)).toBe(true);

    expect(await runAndReadReused(RUN_FULL, copy.root)).toBe(fullPlan.reused);
  });
});
