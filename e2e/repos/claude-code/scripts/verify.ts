#!/usr/bin/env -S npx tsx
// scripts/verify.ts — claude-code 的 CLI 黑盒验收
// (docs/engineering/e2e-ci/adapters/claude-code.md「仓库验收」+
// docs/engineering/e2e-ci/verification.md 写法)。
//
// 只跑 `pnpm exec niceeval ...` shell 原文命令、断言退出码与文本输出;不 import niceeval
// 库代码,不递归扫 `.niceeval/`(README §4.2)。本仓库自带的远程 HTTP MCP fixture 的
// 启动/健康检查/关闭属于 scripts/e2e.ts,这里只假设它已经在跑。
//
// 验收顺序:
//   1. 真实跑全部 5 个 experiments(--force),全部通过(退出 0),组合输出写进
//      logs/exp-ci.log 供 e2e.ts 做 infra/regression 分类。
//   2. show 榜单——6 条 Eval 都实际运行了,少排用例不能全绿。
//   3. show --history——逐 attempt 断言 verdict 是 passed,拿到 locator。
//   4. show @<locator> --execution——skill-used 的 attempt 显示 skill.loaded 节点,
//      mcp-tools 与 plugin-mcp 的 attempt 显示 mcp__ 调用节点、入参保真穿到展示面。
//   5. 同一份 --execution 输出核验 OTel 记录成立:claude-code 的原生 span 量级小、
//      同一个 tool_use_id 会挂出多条同名候选 span(claude_code.tool / .execution /
//      .blocked_on_user),执行树的关联规则「一个 callId 唯一命中一条候选才合并」在这种
//      形状下如实降级成 telemetry-only(见 src/o11y/execution-tree.ts 模块头注:
//      「绝不強行择一合并」)——所以断言不是"节点带时间注释"，而是 render.ts 的诚实二元
//      判据本身：declares tracing 时只有两种可能，`timing unavailable · OTel trace was
//      not collected`(真的没收到 span)或若干 `unlinked telemetry spans`(收到了，只是
//      没能唯一关联到节点）。本仓库断言不出现前者，证明 span 真的被导出、经
//      host.docker.internal 收到、解析成功——trace 只证时间与结构，这条断言只需要证明
//      "记录了没有"成立,不强求逐节点时间注释。

import "dotenv/config";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";

const CI_LOG = "logs/exp-ci.log";

const EXPECTED_EVALS = ["coding-task", "session-resume", "skill-used", "mcp-tools", "plugin-mcp", "websearch-denied"];
// 本仓库有 5 个 experiment(每个挂不同 agent 配置),bare `niceeval show` 按 experiment group
// 汇总展示(见 experiments/*.ts 的文件名),不是按 eval id 摊平列出——eval id 级别的存在性由
// 下面 3. show <eval-id> --history 逐条核验,这里只确认 5 个 experiment group 都被发现过。
const EXPECTED_EXPERIMENTS = ["coding", "skill", "mcp", "plugin", "locked-down"];

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

function runExperiments(): void {
  console.log("\n=== 1. run all 5 experiments for real (--force) ===");
  sh("pnpm exec niceeval exp --force --output ci --junit junit.xml");
  const junitXml = readFileSync("junit.xml", "utf8");
  assert.ok(
    !junitXml.includes("<failure") && !junitXml.includes("<error"),
    `全部实验本应通过,JUnit 里却出现了 failure/error:\n${junitXml}`,
  );
}

function showBoardListsAllEvals(): string {
  console.log("\n=== 2. show board lists every discovered experiment group ===");
  const board = sh("pnpm exec niceeval show");
  for (const id of EXPECTED_EXPERIMENTS) {
    assert.ok(
      board.includes(id),
      `show 榜单缺少 experiment "${id}"——发现或选择器行为变了,先跑 pnpm exec niceeval exp --dry 看计划`,
    );
  }
  return board;
}

function historyReportsPassed(): Record<string, string> {
  console.log("\n=== 3. show --history reports passed for every eval ===");
  const locators: Record<string, string> = {};
  for (const id of EXPECTED_EVALS) {
    const line = latestAttemptLine(id);
    assert.ok(
      line.includes("passed"),
      `${id} 最新 attempt 不是 passed:${line}\n用行尾 locator 执行 pnpm exec niceeval show @<locator> 看主失败断言`,
    );
    const locator = line.match(/@\S+/)?.[0];
    assert.ok(locator, `${id} 的 history 行里没有 @locator,读回没有入口`);
    locators[id] = locator!;
  }
  return locators;
}

/** 声明了 tracing 的 attempt 上,「OTel 没收到」的唯一诚实措辞(见 src/show/render.ts)。 */
const OTEL_NOT_COLLECTED = "OTel trace was not collected";

function executionShowsCallNodesAndOtelRecorded(locators: Record<string, string>): void {
  console.log("\n=== 4. show --execution: skill.loaded + mcp__ call nodes, input fidelity, OTel recorded ===");

  const skillExecution = sh(`pnpm exec niceeval show ${locators["skill-used"]} --execution`);
  assert.ok(
    skillExecution.includes("e2e-marker"),
    "skill-used 执行树缺少 skill.loaded 节点——Skill 调用没被归一进事件流,或 show 执行树读不回",
  );
  assert.ok(
    !skillExecution.includes(OTEL_NOT_COLLECTED),
    "skill-used 的 --execution 显示 OTel trace was not collected——本适配器声明了 tracing,span 应该已经经 host.docker.internal 收到",
  );

  const mcpExecution = sh(`pnpm exec niceeval show ${locators["mcp-tools"]} --execution`);
  assert.ok(mcpExecution.includes("mcp__e2e-stdio__get-sum"), "mcp-tools 执行树缺少 stdio MCP 调用节点");
  assert.ok(mcpExecution.includes("mcp__e2e-http__get-product"), "mcp-tools 执行树缺少远程 HTTP MCP 调用节点");
  assert.ok(
    mcpExecution.includes("100") && mcpExecution.includes("23"),
    "stdio MCP 调用的 input 入参(a=100, b=23)没有穿到展示面",
  );
  assert.ok(
    mcpExecution.includes("6") && mcpExecution.includes("7"),
    "http MCP 调用的 input 入参(a=6, b=7)没有穿到展示面",
  );
  assert.ok(
    !mcpExecution.includes(OTEL_NOT_COLLECTED),
    "mcp-tools 的 --execution 显示 OTel trace was not collected——本适配器声明了 tracing,span 应该已经经 host.docker.internal 收到",
  );

  const pluginExecution = sh(`pnpm exec niceeval show ${locators["plugin-mcp"]} --execution`);
  assert.ok(
    pluginExecution.includes("mcp__plugin_e2e-plugin_tools__get-sum"),
    "plugin-mcp 执行树缺少 plugin 挂载的 MCP 调用节点——native plugin 安装的 MCP server 没被归一进事件流",
  );
}

export async function runVerify(): Promise<void> {
  ensureDirs();

  runExperiments();
  showBoardListsAllEvals();
  const locators = historyReportsPassed();
  executionShowsCallNodesAndOtelRecorded(locators);

  console.log("\nclaude-code: all assertions passed.");
}

// 允许独立跑(`tsx scripts/verify.ts`,假设远程 HTTP MCP fixture 已经在跑),不必经过 e2e.ts。
if (import.meta.url === `file://${process.argv[1]}`) {
  runVerify().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
