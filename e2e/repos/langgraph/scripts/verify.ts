#!/usr/bin/env -S npx tsx
// CLI 黑盒验收(docs/engineering/e2e-ci/verification.md):只起 niceeval 子进程、断言退出码
// 与输出,不 import niceeval 库代码,不递归扫 .niceeval/。
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const EXPECTED_EVALS = ["weather-tool", "hitl", "subagent-research", "session-continuity"];

function sh(cmd: string, expect: number | "nonzero" = 0): string {
  const res = spawnSync(cmd, { shell: true, encoding: "utf8" });
  const exit = res.status ?? -1;
  const ok = expect === "nonzero" ? exit !== 0 : exit === expect;
  // niceeval 的 errored/failed 详情打在 stdout(如 `niceeval: errored ... reason=...`),
  // 不是 stderr——两个尾部都截出来,不然真实原因(比如连不上被测服务)会被藏起来。
  assert.ok(
    ok,
    `${cmd}\n退出 ${exit},预期 ${expect}。stdout 尾部:\n${(res.stdout ?? "").slice(-2000)}\nstderr 尾部:\n${(res.stderr ?? "").slice(-2000)}`,
  );
  return res.stdout ?? "";
}

function latestAttemptLine(evalId: string): string {
  const lines = sh(`pnpm exec niceeval show ${evalId} --history`)
    .split("\n")
    .filter((l) => l.includes("@"));
  assert.ok(lines.length > 0, `show --history 里 ${evalId} 没有任何 attempt 行——实验没跑到这条 Eval`);
  return lines.at(-1)!;
}

function extractLocator(line: string, evalId: string): string {
  const m = line.match(/@\S+/);
  assert.ok(m, `${evalId} 的 history 行没有 locator:${line}`);
  return m![0];
}

export async function runVerify(): Promise<void> {
  mkdirSync("logs", { recursive: true });

  // 用例一:跑实验,断言退出码;--output ci 落一份稳定日志供 e2e.ts 的故障分类读,--junit 落 CI 出口。
  const runOutput = sh("pnpm exec niceeval exp langgraph --force --output ci --junit junit.xml");
  writeFileSync("logs/exp-ci.log", runOutput);

  // 用例二:show 榜单——应发现的 4 条 Eval 都实际运行了,少排用例不能全绿。
  const board = sh("pnpm exec niceeval show");
  for (const id of EXPECTED_EVALS) {
    assert.ok(
      board.includes(id),
      `show 榜单缺少 ${id}——发现或选择器行为变了,先跑 pnpm exec niceeval exp langgraph --dry 看计划`,
    );
  }

  // 用例三:show --history——逐 attempt 断言 verdict 为 passed,并拿到 locator。
  const locators: Record<string, string> = {};
  for (const id of EXPECTED_EVALS) {
    const line = latestAttemptLine(id);
    assert.ok(
      line.includes("passed"),
      `${id} 最新 attempt 不是 passed:${line}\n用行尾 locator 执行 pnpm exec niceeval show @<locator> 看主失败断言`,
    );
    locators[id] = extractLocator(line, id);
  }

  // 用例四:show --execution——工具调用节点、subagent 层级都出现,入参穿透到展示面;
  // 本适配器不声明 tracing 面(docs/engineering/e2e-ci/adapters/langgraph.md),时间注释
  // 应显示 timing unavailable。
  const weatherExec = sh(`pnpm exec niceeval show ${locators["weather-tool"]} --execution`);
  assert.ok(
    weatherExec.includes("get_weather"),
    "执行树缺少 get_weather 调用节点——调用没被归一进事件流,或 show 执行树读不回",
  );
  assert.ok(
    weatherExec.includes("北京"),
    "TOOL 卡片的 input 里没有出现入参 北京——入参在归一或展示链路上被丢弃/改写",
  );
  assert.ok(
    weatherExec.includes("timing unavailable"),
    "本适配器不声明 tracing 面,执行树节点不该带 span 时间注释——出现说明 OTel 意外接上了",
  );

  const subagentExec = sh(`pnpm exec niceeval show ${locators["subagent-research"]} --execution`);
  assert.ok(subagentExec.includes("delegate_research"), "执行树缺少 delegate_research 调用节点");
  assert.ok(
    subagentExec.toLowerCase().includes("research"),
    "执行树缺少 research 子agent 层级节点——namespace 没有归一成 subagent.called/subagent.completed",
  );

  // 用例五:show --timing——未声明 tracing 面的仓库,--timing 不挂 OTel 子树。
  const timing = sh(`pnpm exec niceeval show ${locators["weather-tool"]} --timing`);
  assert.ok(!timing.includes("get_weather"), "--timing 意外出现了 OTel 工具 span——本适配器不该有 tracing 子树");

  console.log("[verify] all checks passed");
}

const isMain = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  runVerify()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
