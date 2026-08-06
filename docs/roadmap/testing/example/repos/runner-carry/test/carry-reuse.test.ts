import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { parseJson, parseNdjson, runProcess } from "./support/process.ts";
import { copyProject } from "./support/project.ts";

// 场景 Repo：e2e/runner-carry（本设计稿位于 example/repos/runner-carry）。
// 从 NiceEval 根目录运行：pnpm e2e --repo runner-carry -- --run test/carry-reuse.test.ts
// 从已安装候选包的隔离 Repo 根运行：pnpm test --run test/carry-reuse.test.ts
// 被测用户命令都在下面的 RUN / RUN_ALL / DRY 中完整列出。

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

const RUN = ["pnpm", "--silent", "exec", "niceeval", "exp", "smoke", "--json"] as const;
const RUN_ALL = ["pnpm", "--silent", "exec", "niceeval", "exp", "smoke", "--rerun", "all", "--json"] as const;
const DRY = ["pnpm", "--silent", "exec", "niceeval", "exp", "smoke", "--dry", "--json"] as const;

async function readPlan(argv: readonly [string, ...string[]], cwd?: string): Promise<ExpPlanDocument> {
  const result = await runProcess(argv, cwd ? { cwd } : undefined);
  expect(result.exitCode, result.diagnostic()).toBe(0);
  const document = parseJson<ExpPlanDocument>(result.stdout, result.diagnostic());
  expect(document.format).toBe("niceeval.exp-plan");
  expect(document.schemaVersion).toBe(3);
  return document;
}

async function runAndReadReused(argv: readonly [string, ...string[]], cwd?: string): Promise<number> {
  const result = await runProcess(argv, cwd ? { cwd } : undefined);
  expect(result.exitCode, result.diagnostic()).toBe(0);
  const events = parseNdjson<ExpEvent>(result.stdout, result.diagnostic());
  const start = events.find((item) => item.event === "start");
  expect(start, result.diagnostic()).toBeDefined();
  return start?.reused ?? 0;
}

// 指纹命中时默认 rerun 全携入：dry plan 预测的携入数与真实 run 的携入数不得分叉
// （planCarry 与调度共用同一次判断，docs/feature/experiments/cli.md「AI 常见循环」）。
test("dry plan 预测的携入数与真实 run 一致且全部命中", async () => {
  expect(await runAndReadReused(RUN_ALL)).toBe(0);

  const planned = await readPlan(DRY);
  expect(planned.reused).toBe(planned.total);
  expect(planned.matrix.every((row) => row.reused)).toBe(true);

  expect(await runAndReadReused(RUN)).toBe(planned.reused);
});

// config 内容变化触发指纹门：configHash 变了，dry plan 如实标 reused: false
// （cache.md「指纹门」）。本测试只改隔离副本里的 config，不改共享现场、不写回；
// judge.model 进 configHash，labels 不进（docs/feature/experiments/library.md「labels」）。
test("修改 config 后 dry plan 不再预测任何携入", async () => {
  const copy = copyProject("niceeval-e2e-carry-config-");
  try {
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
  } finally {
    copy.cleanup();
  }
});

// 部分补跑不得抹掉更早 run 的携入结果：完整 run 后只改一条 eval，下一次整组运行
// 时未变化的 eval 仍从第一次 run 携入（regression: 85cafd7d）。全部在隔离副本里
// 完成 full → partial → full，不碰共享现场。
test("full → partial → full：部分补跑后未变化 eval 仍从更早 run 携入", async () => {
  const copy = copyProject("niceeval-e2e-carry-partial-");
  try {
    expect(await runAndReadReused(RUN_ALL, copy.root)).toBe(0);

    const alphaPath = join(copy.root, "evals", "simple", "alpha.eval.ts");
    const alphaV2 = readFileSync(alphaPath, "utf8").replace('includes("fixture")', 'includes("固定回复")');
    writeFileSync(alphaPath, alphaV2, "utf8");

    const partialPlan = await readPlan(DRY, copy.root);
    const alpha = partialPlan.matrix.find((row) => row.evalId === "simple/alpha");
    const beta = partialPlan.matrix.find((row) => row.evalId === "simple/beta");
    expect(alpha?.reused).toBe(false);
    expect(beta?.reused).toBe(true);
    expect(partialPlan.reused).toBe(1);

    expect(await runAndReadReused(RUN, copy.root)).toBe(1);

    const fullPlan = await readPlan(DRY, copy.root);
    expect(fullPlan.reused).toBe(fullPlan.total);
    expect(fullPlan.matrix.every((row) => row.reused)).toBe(true);

    expect(await runAndReadReused(RUN, copy.root)).toBe(fullPlan.reused);
  } finally {
    copy.cleanup();
  }
});
