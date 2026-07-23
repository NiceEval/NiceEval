#!/usr/bin/env -S npx tsx
// scripts/verify.ts — claude-agent-sdk 的 CLI 黑盒验收
// (docs/engineering/testing/e2e/adapter/claude-agent-sdk.md「仓库验收」+
// docs/engineering/testing/e2e/verification.md 写法)。
//
// 只跑 `pnpm exec niceeval ...` shell 原文命令、断言退出码与文本输出;不 import niceeval
// 库代码,不递归扫 `.niceeval/`(README §4.2)。被测应用的启动/健康检查/关闭属于
// scripts/e2e.ts,这里只假设它已经在跑。
//
// 验收顺序:
//   1. 真实跑 ci 实验(--force),全部 Eval 通过(退出 0),同时把组合输出写进
//      logs/exp-ci.log 供 e2e.ts 做 infra/regression 分类。
//   2. show 榜单——三条 Eval 都实际运行了,少排用例不能全绿。
//   3. show --history——逐 attempt 断言 verdict 是 passed,拿到 locator。
//   4. show @<locator> --execution——MCP 工具调用节点、入参 Brooklyn 都穿到了展示面;
//      本适配器不声明 tracing,时间注释应为 timing unavailable。
//   5. show @<locator> --timing——未声明 tracing 面,不应出现 OTel 子树标注。

import "dotenv/config";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";

const CI_LOG = "logs/exp-ci.log";

const EXPECTED_EVALS = ["hitl-gate", "session-resume", "weather-tool"];

function ensureDirs(): void {
  mkdirSync("logs", { recursive: true });
  writeFileSync(CI_LOG, ""); // 每次运行清空,只保留本次证据供 e2e.ts 做分类。
}

/**
 * 跑一条 shell 原文命令,断言退出码,把 stdout+stderr 一起写进 logs/exp-ci.log 并返回合并
 * 文本(用法错误、provider 故障都可能落在 stderr,合并后统一用 .includes() 断言)。
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

function latestAttemptLine(evalId: string): string {
  const lines = attemptLines(evalId);
  assert.ok(lines.length > 0, `show --history 里 ${evalId} 没有任何 attempt 行——实验没跑到这条 Eval`);
  return lines.at(-1)!;
}

function runExperiment(): void {
  console.log("\n=== 1. run the ci experiment for real (--force) ===");
  // `--json` 把 NDJSON 事件流打到 stdout(`--output` 已经从 CLI 整个删除),落进 CI_LOG 供
  // e2e.ts 的 isInfraFailure() 解析结构化 error 事件;`pnpm --silent exec` 防止 pnpm 自己的
  // preamble 行混进 stdout 污染 NDJSON。
  sh("pnpm --silent exec niceeval exp ci --force --json --junit junit.xml");
  const junitXml = readFileSync("junit.xml", "utf8");
  assert.ok(
    !junitXml.includes("<failure") && !junitXml.includes("<error"),
    `ci 实验本应全部通过,JUnit 里却出现了 failure/error:\n${junitXml}`,
  );
}

function showBoardListsAllEvals(): string {
  console.log("\n=== 2. show board lists every discovered eval ===");
  const board = sh("pnpm exec niceeval show");
  for (const id of EXPECTED_EVALS) {
    assert.ok(board.includes(id), `show 榜单缺少 ${id}——发现或选择器行为变了,先跑 pnpm exec niceeval exp ci --dry 看计划`);
  }
  return board;
}

function historyReportsPassed(): string {
  console.log("\n=== 3. show --history reports passed for every eval ===");
  let weatherLocator: string | undefined;
  for (const id of EXPECTED_EVALS) {
    const line = latestAttemptLine(id);
    assert.ok(line.includes("passed"), `${id} 最新 attempt 不是 passed:${line}\n用行尾 locator 执行 pnpm exec niceeval show @<locator> 看主失败断言`);
    if (id === "weather-tool") weatherLocator = line.match(/@\S+/)?.[0];
  }
  assert.ok(weatherLocator, "weather-tool 的 history 行里没有 @locator,读回没有入口");
  return weatherLocator!;
}

function executionShowsMcpCallAndNoTiming(locator: string): void {
  console.log("\n=== 4. show --execution: MCP call node + input fidelity, no tracing declared ===");
  const execution = sh(`pnpm exec niceeval show ${locator} --execution`);
  assert.ok(
    execution.includes("mcp__demo-tools__get_weather"),
    "执行树缺少 MCP 调用节点——调用没被归一进事件流,或 show 执行树读不回",
  );
  assert.ok(
    execution.includes("Brooklyn"),
    "TOOL 卡片的 input 里没有出现入参 Brooklyn——入参在归一或展示链路上被丢弃/改写",
  );
  // 本适配器不声明 tracing 面(见 docs/engineering/testing/e2e/adapter/claude-agent-sdk.md「OTel」):
  // 节点应显示 timing unavailable,而不是带 span 时间。
  assert.ok(
    execution.includes("timing unavailable"),
    "执行树节点带上了时间注释——本适配器不该声明 tracing 面,出现计时说明 OTel 被意外接上了,或这条断言的前提变了",
  );
}

function timingHasNoOtelSubtree(locator: string): void {
  console.log("\n=== 5. show --timing: no OTel subtree (tracing not declared) ===");
  const timing = sh(`pnpm exec niceeval show ${locator} --timing`);
  assert.ok(
    !timing.includes("OTel"),
    "--timing 挂出了 OTel 子树——本适配器不接 OTel,timing 树不该有 OTel 标注的 model/tool span",
  );
}

export async function runVerify(): Promise<void> {
  ensureDirs();

  runExperiment();
  showBoardListsAllEvals();
  const locator = historyReportsPassed();
  executionShowsMcpCallAndNoTiming(locator);
  timingHasNoOtelSubtree(locator);

  console.log("\nclaude-agent-sdk: all assertions passed.");
}

// 允许独立跑(`tsx scripts/verify.ts`,假设应用已经在跑),不必经过 e2e.ts。
if (import.meta.url === `file://${process.argv[1]}`) {
  runVerify().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
