#!/usr/bin/env -S npx tsx
// scripts/verify.ts — cli 的 CLI 黑盒验收(docs/engineering/testing/e2e/cli.md)。
// 只跑 `pnpm exec niceeval ...` shell 原文命令、断言退出码与文本输出;不 import niceeval
// 库代码,不递归扫 `.niceeval/`(见 docs/engineering/testing/e2e/README.md §4.2、verification.md)。
//
// 验收顺序对齐 cli.md 的三段验收计划:
//   1-3. 选择——未命中选择器的用法错误(Experiment 零命中、Eval 前缀零命中两条路径都
//        给下一步命令);eval id 前缀收窄实际计划(--dry,零网络成本)。
//   4-7. 退出码折叠——deliberate-fail(<failure>)、deliberate-error(<error>)、
//        normal(真实 DeepSeek 调用,按 Eval 级折叠后退出 0)+ 一次 CLI 读回。
//   8.   缓存三步——同一个 normal 实验先 --force 建基线,不带 --force 复用,再 --force 真新跑。

import "dotenv/config";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";

const CI_LOG = "logs/exp-ci.log";

function ensureDirs(): void {
  mkdirSync("logs", { recursive: true });
  mkdirSync("junit", { recursive: true });
  writeFileSync(CI_LOG, ""); // 每次运行清空,只保留本次证据供 e2e.ts 做 infra/regression 分类。
}

/**
 * 跑一条 shell 原文命令,断言退出码,把 stdout+stderr 一起写进 logs/exp-ci.log 并返回合并
 * 文本。用法错误与 "No experiment matched" 这类反馈写在 stderr(见
 * docs/feature/experiments/cli.md「用法错误」),合并后才能统一用 .includes() 断言,同时
 * e2e.ts 的失败分类也需要读到同一份完整证据。
 */
function sh(cmd: string, expect: number | "nonzero" = 0): string {
  console.log(`\n$ ${cmd}`);
  const res = spawnSync(cmd, { shell: true, encoding: "utf8" });
  const exit = res.status ?? -1;
  const combined = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  appendFileSync(CI_LOG, `$ ${cmd}\n${combined}\n(exit ${exit})\n\n`);
  const ok = expect === "nonzero" ? exit !== 0 : exit === expect;
  assert.ok(ok, `${cmd}\n退出 ${exit},期望 ${expect}。输出尾部:\n${combined.slice(-2000)}`);
  return combined;
}

function attemptLines(evalId: string): string[] {
  return sh(`pnpm exec niceeval show ${evalId} --history`)
    .split("\n")
    .filter((l) => l.includes("@"));
}

function attemptCount(evalId: string): number {
  return attemptLines(evalId).length;
}

function latestAttemptLine(evalId: string): string {
  const lines = attemptLines(evalId);
  assert.ok(lines.length > 0, `show --history 里 ${evalId} 没有任何 attempt 行——实验没跑到这条 Eval`);
  return lines.at(-1)!;
}

function selectionExperimentUnmatched(): void {
  console.log("\n=== 1. selection: unmatched experiment selector exits as a usage error ===");
  // 用法错误始终写 stderr、恒非零退出,错误形态不随输出形态改变(cli.md「用法错误」)——
  // 不需要也不接受 --output(该 flag 已从 CLI 整个删除)。
  const out = sh("pnpm exec niceeval exp totally-bogus-selector-zzz", "nonzero");
  assert.ok(
    out.includes("No experiment matched"),
    `未命中选择器没有给出 "No experiment matched" 的可行动反馈——用法错误的输出契约变了:\n${out.slice(-1000)}`,
  );
  assert.ok(
    out.includes("Run `niceeval exp"),
    `"No experiment matched" 没有给出下一步命令——cli.md 要求"错误信息给出下一步":\n${out.slice(-1000)}`,
  );
}

// experiment 选择器本身命中(normal 存在),但尾随 eval id 前缀在该实验的 evals 里零命中——
// 与上面「experiment 选择器零命中」是判然有别的另一条用法错误路径(No evals selected,见
// docs/feature/experiments/cli.md「实验选择器怎样解析」与 use-case/selector-narrowing.md
// 「边界」)。--dry 零网络成本。
function selectionEvalUnmatched(): void {
  console.log("\n=== 2. selection: matched experiment but unmatched eval id prefix exits as a usage error ===");
  // 用法错误的输出契约不随形态改变,同一条理由不需要 --output;--dry 只是保留零网络成本。
  const out = sh("pnpm exec niceeval exp normal totally-bogus-eval-prefix-zzz --dry", "nonzero");
  assert.ok(
    out.includes("No evals selected"),
    `experiment 命中但 eval 前缀零命中时没有给出 "No evals selected"——用法错误的输出契约变了:\n${out.slice(-1000)}`,
  );
  assert.ok(
    out.includes("Run `niceeval exp"),
    `"No evals selected" 没有给出下一步命令——cli.md 要求"错误信息给出下一步":\n${out.slice(-1000)}`,
  );
}

interface ExpPlanRow {
  experimentId: string;
  evalId: string;
  reused: boolean;
}

interface ExpPlanDocument {
  format: "niceeval.exp-plan";
  schemaVersion: number;
  total: number;
  evals: number;
  configs: number;
  runs: number;
  reused: number;
  matrix: ExpPlanRow[];
}

/**
 * `--dry --json` 输出单个 `ExpPlanDocument`(docs/feature/experiments/cli.md「机器怎么读:
 * --json」),不是事件流——结构化断言直接读 `matrix` 里的 evalId,不再正则抠 `--output agent`
 * 那种人读 plan-row 文本(`--output` 已经从 CLI 整个删除)。`pnpm --silent exec` 防止 pnpm 自己
 * 的 preamble 行混进 stdout 污染 JSON。
 */
function dryPlan(cmd: string): ExpPlanDocument {
  const raw = sh(`pnpm --silent exec niceeval ${cmd} --dry --json`);
  return JSON.parse(raw) as ExpPlanDocument;
}

function selectionNarrowing(): void {
  console.log("\n=== 3. selection: eval id prefix narrows the plan (--dry --json, no network) ===");
  const planGreet = dryPlan("exp normal greet");
  assert.ok(
    planGreet.matrix.some((row) => row.evalId === "greet/hello"),
    `--dry --json 计划缺少 greet/hello:\n${JSON.stringify(planGreet)}`,
  );
  assert.ok(
    !planGreet.matrix.some((row) => row.evalId === "tool/weather"),
    `eval id 前缀 "greet" 没有收窄——tool/weather 混进了计划:\n${JSON.stringify(planGreet)}`,
  );

  const planTool = dryPlan("exp normal tool");
  assert.ok(
    planTool.matrix.some((row) => row.evalId === "tool/weather"),
    `--dry --json 计划缺少 tool/weather:\n${JSON.stringify(planTool)}`,
  );
  assert.ok(
    !planTool.matrix.some((row) => row.evalId === "greet/hello"),
    `eval id 前缀 "tool" 没有收窄——greet/hello 混进了计划:\n${JSON.stringify(planTool)}`,
  );

  const planAll = dryPlan("exp normal");
  assert.ok(
    planAll.matrix.some((row) => row.evalId === "greet/hello") && planAll.matrix.some((row) => row.evalId === "tool/weather"),
    `不带 eval 前缀时应选中 normal 实验下的全部 eval:\n${JSON.stringify(planAll)}`,
  );
}

function exitCodeFoldingDeliberateFail(): void {
  console.log("\n=== 4. exit-code folding: deliberate-fail → failed, <failure> ===");
  sh("pnpm exec niceeval exp deliberate-fail --force --junit junit/fail.xml", "nonzero");
  const failXml = readFileSync("junit/fail.xml", "utf8");
  assert.ok(
    failXml.includes("<failure"),
    `deliberate-fail 的 JUnit 里没有 <failure>——断言不通过没折叠成 failed:\n${failXml}`,
  );
  assert.ok(
    !failXml.includes("<error"),
    `deliberate-fail 混进了 <error>——failed 与 errored 的互斥判定破了:\n${failXml}`,
  );
  const line = latestAttemptLine("deliberate-fail/broken");
  assert.ok(line.includes("failed"), `deliberate-fail/broken 最新 attempt 不是 failed:${line}`);
}

function exitCodeFoldingDeliberateError(): void {
  console.log("\n=== 5. exit-code folding: deliberate-error → errored, <error> ===");
  sh("pnpm exec niceeval exp deliberate-error --force --junit junit/error.xml", "nonzero");
  const errorXml = readFileSync("junit/error.xml", "utf8");
  assert.ok(
    errorXml.includes("<error"),
    `deliberate-error 的 JUnit 里没有 <error>——执行错误被误折叠成断言失败:\n${errorXml}`,
  );
  assert.ok(
    !errorXml.includes("<failure"),
    `deliberate-error 混进了 <failure>——errored 与 failed 的互斥判定破了:\n${errorXml}`,
  );
  const line = latestAttemptLine("deliberate-error/crash");
  assert.ok(line.includes("errored"), `deliberate-error/crash 最新 attempt 不是 errored:${line}`);
}

interface NormalBaseline {
  greet: number;
  tool: number;
  greetLine: string;
}

/** 正常路径全部通过(真实 DeepSeek 调用),同时建立缓存三步的基线计数。 */
function exitCodeFoldingNormal(): NormalBaseline {
  console.log("\n=== 6. exit-code folding: normal (real DeepSeek calls) → passed, exit 0 ===");
  sh("pnpm exec niceeval exp normal --force --junit junit/normal.xml");
  const normalXml = readFileSync("junit/normal.xml", "utf8");
  assert.ok(
    !normalXml.includes("<failure") && !normalXml.includes("<error"),
    `normal 实验本应全部通过,JUnit 里却出现了 failure/error:\n${normalXml}`,
  );

  const greetLine = latestAttemptLine("greet/hello");
  assert.ok(greetLine.includes("passed"), `greet/hello 最新 attempt 不是 passed:${greetLine}`);
  const toolLine = latestAttemptLine("tool/weather");
  assert.ok(toolLine.includes("passed"), `tool/weather 最新 attempt 不是 passed:${toolLine}`);

  return { greet: attemptCount("greet/hello"), tool: attemptCount("tool/weather"), greetLine };
}

function cliReadBack(greetLine: string): void {
  console.log("\n=== 7. CLI read-back: niceeval show @<locator> ===");
  const locator = greetLine.match(/@\S+/)?.[0];
  assert.ok(locator, `history 行里没有 @locator,读回没有入口:${greetLine}`);
  const shown = sh(`pnpm exec niceeval show ${locator}`);
  assert.ok(shown.includes("greet/hello"), `niceeval show ${locator} 没有显示 eval id greet/hello:\n${shown}`);
  assert.ok(shown.includes("passed"), `niceeval show ${locator} 没有显示 verdict passed:\n${shown}`);
}

function cacheThreeStep(baseline: NormalBaseline): void {
  console.log("\n=== 8. cache three-step dance ===");
  const second = sh("pnpm exec niceeval exp normal"); // 不带 --force:复用
  assert.ok(second.includes("reused"), `第二次运行的摘要没有报告复用——缓存没生效:\n${second}`);
  assert.equal(
    attemptCount("greet/hello"),
    baseline.greet,
    "不带 --force 对 greet/hello 产生了新 attempt——缓存复用没有生效",
  );
  assert.equal(
    attemptCount("tool/weather"),
    baseline.tool,
    "不带 --force 对 tool/weather 产生了新 attempt——缓存复用没有生效",
  );

  sh("pnpm exec niceeval exp normal --force"); // 再带 --force:真实新 attempt
  assert.equal(
    attemptCount("greet/hello"),
    baseline.greet + 1,
    "--force 没有对 greet/hello 产生新 attempt——强制重跑失效",
  );
  assert.equal(
    attemptCount("tool/weather"),
    baseline.tool + 1,
    "--force 没有对 tool/weather 产生新 attempt——强制重跑失效",
  );
}

export async function runVerify(): Promise<void> {
  ensureDirs();

  selectionExperimentUnmatched();
  selectionEvalUnmatched();
  selectionNarrowing();

  exitCodeFoldingDeliberateFail();
  exitCodeFoldingDeliberateError();

  const baseline = exitCodeFoldingNormal();
  cliReadBack(baseline.greetLine);
  cacheThreeStep(baseline);

  console.log("\ncli: all assertions passed.");
}

// 允许独立跑(`tsx scripts/verify.ts`),不必经过 e2e.ts。
if (import.meta.url === `file://${process.argv[1]}`) {
  runVerify().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
