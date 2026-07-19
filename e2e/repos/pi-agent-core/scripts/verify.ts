// CLI 黑盒验收(docs/engineering/e2e-ci/verification.md 的写法):只起 niceeval 子进程、
// 断言退出码与 stdout,不 import niceeval 库代码,不递归扫 .niceeval/。假定
// scripts/e2e.ts 已经用 --force 跑过 experiments/ci.ts,这里只做「新产出的结果读回」。
import "dotenv/config";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";

function sh(cmd: string, expect: number | "nonzero" = 0): string {
  const res = spawnSync(cmd, { shell: true, encoding: "utf8" });
  const exit = res.status ?? -1;
  const ok = expect === "nonzero" ? exit !== 0 : exit === expect;
  assert.ok(ok, `${cmd}\n退出 ${exit},预期 ${expect}。stderr 尾部:\n${(res.stderr ?? "").slice(-2000)}`);
  return res.stdout ?? "";
}

const EXPECTED_EVALS = ["tool-call", "session-history", "hitl-pause-resume", "usage-and-failure"];

function latestAttemptLine(evalId: string): string {
  const lines = sh(`pnpm exec niceeval show ${evalId} --history`)
    .split("\n")
    .filter((l) => l.includes("@"));
  assert.ok(lines.length > 0, `show --history 里 ${evalId} 没有任何 attempt 行——实验没跑到这条 Eval`);
  return lines.at(-1)!;
}

function locatorOf(line: string): string {
  const match = line.match(/@\S+/);
  assert.ok(match, `attempt 行里没有 @locator:${line}`);
  return match![0];
}

// ── 用例一:榜单列出本仓库每条 Eval ──────────────────────────────────────
const board = sh("pnpm exec niceeval show");
for (const id of EXPECTED_EVALS) {
  assert.ok(
    board.includes(id),
    `show 榜单缺少 ${id}——发现或选择器行为变了,先跑 pnpm exec niceeval exp ci --dry 看计划`,
  );
}

// ── 用例二:逐 Eval 断言最新 attempt 是 passed,并拿到 locator ──────────────
const locators: Record<string, string> = {};
for (const id of EXPECTED_EVALS) {
  const line = latestAttemptLine(id);
  assert.ok(line.includes("passed"), `${id} 最新 attempt 不是 passed:${line}\n用行尾 locator 执行 pnpm exec niceeval show @<locator> 看主失败断言`);
  locators[id] = locatorOf(line);
}

// ── 用例三:show --execution——本仓库自有事实(工具节点、入参)穿透到展示面 ──
// pi-agent-core 不声明 tracing 面(见 docs/engineering/e2e-ci/adapters/pi-agent-core.md),
// 所以每条 execution 的时间注释都应显示 "timing unavailable",不应出现真实耗时。
function assertNoTracing(execution: string, evalId: string): void {
  assert.ok(
    execution.includes("timing unavailable"),
    `${evalId} 的执行树没有显示 timing unavailable——pi-agent-core 不该有 OTel 时间注释,检查 agent 是否误声明了 tracing`,
  );
}

const toolCallExecution = sh(`pnpm exec niceeval show ${locators["tool-call"]} --execution`);
assert.ok(toolCallExecution.includes("get_weather"), "tool-call 执行树缺少 get_weather 调用节点——工具调用没被归一进事件流");
assert.ok(toolCallExecution.includes("北京"), "tool-call 执行树的 TOOL 卡片 input 里没有出现入参 北京——入参在归一或展示链路上被丢弃/改写");
assertNoTracing(toolCallExecution, "tool-call");

const sessionExecution = sh(`pnpm exec niceeval show ${locators["session-history"]} --execution`);
assert.ok(sessionExecution.includes("get_weather"), "session-history 执行树缺少第一轮的 get_weather 调用节点");
assert.ok(sessionExecution.includes("深圳"), "session-history 执行树里没有出现「深圳」——要么第一轮入参没保真,要么第二轮没有引用历史事实");
assertNoTracing(sessionExecution, "session-history");

const hitlExecution = sh(`pnpm exec niceeval show ${locators["hitl-pause-resume"]} --execution`);
assert.ok(hitlExecution.includes("send_alert"), "hitl-pause-resume 执行树缺少 send_alert 调用节点");
assert.ok(hitlExecution.includes("数据库连接数过高"), "hitl-pause-resume 执行树里没有出现被拒绝那条告警的入参——审批分支没有正确落到事件流");
assert.ok(hitlExecution.includes("磁盘空间不足"), "hitl-pause-resume 执行树里没有出现被批准那条告警的入参——resume 之后的 action.result 没有正确落到事件流");
assertNoTracing(hitlExecution, "hitl-pause-resume");

const usageExecution = sh(`pnpm exec niceeval show ${locators["usage-and-failure"]} --execution`);
assert.ok(usageExecution.includes("calculate"), "usage-and-failure 执行树缺少 calculate 调用节点");
assert.ok(usageExecution.includes("7/0"), "usage-and-failure 执行树里没有出现失败那次调用的入参 7/0——失败调用的入参没有保真");
assertNoTracing(usageExecution, "usage-and-failure");

// ── 用例四:show --timing——本适配器不声明 tracing 面,不挂 OTel 子树 ──────
const timing = sh(`pnpm exec niceeval show ${locators["tool-call"]} --timing`);
assert.ok(
  !timing.includes("OTel"),
  "--timing 挂出了 OTel 子树——pi-agent-core 没有官方遥测集成,不该声明 tracing(见 docs/feature/adapters/reference/agent-loop-apis.md「pi」一节)",
);

console.log("[verify] PASS — board, per-eval history, execution read-back and timing all match expectations");
