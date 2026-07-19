// CLI 黑盒验收(docs/engineering/e2e-ci/verification.md):只跑 `pnpm exec niceeval ...`
// 子进程、断言退出码与输出,不 import niceeval 库代码,不递归扫 `.niceeval/`。
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";

const EXPECTED_EVALS = ["coding-tool", "hitl-negative", "mcp-tool", "session", "usage"];

function sh(cmd: string, expect: number | "nonzero" = 0): string {
  const res = spawnSync(cmd, { shell: true, encoding: "utf8" });
  const exit = res.status ?? -1;
  const ok = expect === "nonzero" ? exit !== 0 : exit === expect;
  assert.ok(ok, `${cmd}\n退出 ${exit},预期 ${expect}。stderr 尾部:\n${(res.stderr ?? "").slice(-4000)}`);
  return res.stdout ?? "";
}

function latestAttemptLine(evalId: string): string {
  const lines = sh(`pnpm exec niceeval show ${evalId} --history`)
    .split("\n")
    .filter((l) => l.includes("@"));
  assert.ok(lines.length > 0, `show --history 里 ${evalId} 没有任何 attempt 行——实验没跑到这条 Eval,先跑 pnpm exec niceeval exp --dry 看计划`);
  return lines.at(-1)!;
}

export default async function runVerify(): Promise<void> {
  // 诊断:打印本次实际解析到的 niceeval 版本(注入核验的义务在根编排器,这里只是留痕)。
  console.log(`[verify] niceeval resolved to: ${sh("pnpm exec niceeval --version").trim()}`);

  rmSync("junit.xml", { force: true });
  rmSync("logs", { recursive: true, force: true });
  mkdirSync("logs", { recursive: true });

  // 用例一:跑实验,断言退出码。--force 保证真实新跑,--output ci 保证只追加的稳定日志,
  // --junit 落 CI 出口。
  const runLog = sh("pnpm exec niceeval exp --force --output ci --junit junit.xml");
  writeFileSync("logs/exp-ci.log", runLog, "utf8");

  // 用例二:show 榜单——应发现的 Eval 都实际运行了(少排用例不能全绿)。
  const board = sh("pnpm exec niceeval show");
  for (const id of EXPECTED_EVALS) {
    assert.ok(board.includes(id), `show 榜单缺少 ${id}——发现或选择器行为变了,先跑 pnpm exec niceeval exp --dry 看计划`);
  }

  // 用例三:show --history——逐 attempt 断言 verdict,并从 coding-tool 的最新 attempt 拿 locator
  // (下面证据切面命令的入口——它同时打了 shell 与 file_edit 两种工具调用,覆盖面最大)。
  let codingToolLocator: string | undefined;
  for (const id of EXPECTED_EVALS) {
    const line = latestAttemptLine(id);
    assert.ok(line.includes("passed"), `${id} 最新 attempt 不是 passed:${line}\n用行尾 locator 执行 pnpm exec niceeval show @<locator> 看主失败断言`);
    if (id === "coding-tool") codingToolLocator = line.match(/@\S+/)?.[0];
  }
  assert.ok(codingToolLocator, "没能从 coding-tool 的 --history 行里提取 locator");

  // 用例四:show --execution——调用与入参都存在,且本适配器不声明 tracing 面。
  const execution = sh(`pnpm exec niceeval show ${codingToolLocator} --execution`);
  assert.ok(
    execution.includes("shell") || execution.includes("command_execution"),
    "执行树缺少 shell/command_execution 调用节点——调用没被归一进事件流,或 show 执行树读不回",
  );
  assert.ok(
    execution.includes("niceeval-e2e-run-926"),
    "TOOL 卡片的 input 里没有出现 shell 命令入参——入参在归一或展示链路上被丢弃/改写",
  );
  assert.ok(
    execution.includes("file_edit") || execution.includes("niceeval-e2e-coding-tool.txt"),
    "执行树缺少 file_edit 调用节点——文件变更事件没有归一进事件流,或 show 执行树读不回",
  );
  assert.ok(
    execution.includes("timing unavailable"),
    "本仓库的适配器不声明 tracing 面,执行树节点却带了时间注释——OTel 接入意外生效了?",
  );

  // 用例五:show --timing——本适配器不声明 tracing 面,不挂 OTel 子树(只有 runner 时间树)。
  const timing = sh(`pnpm exec niceeval show ${codingToolLocator} --timing`);
  assert.ok(
    !/otel/i.test(timing) || timing.includes("timing unavailable"),
    "--timing 意外挂出了 OTel 子树——本仓库不该声明 tracing 面",
  );

  // HITL 反证:codex-sdk 没有审批回调,事件流从不应出现 input.requested——用 show --execution
  // 的展示面核验这条机制事实同样穿透到了 CLI 读回,而不仅仅是 Eval 内部断言。
  const hitlLine = latestAttemptLine("hitl-negative");
  const hitlLocator = hitlLine.match(/@\S+/)?.[0];
  assert.ok(hitlLocator, "没能从 hitl-negative 的 --history 行里提取 locator");
  const hitlExecution = sh(`pnpm exec niceeval show ${hitlLocator} --execution`);
  assert.ok(
    !hitlExecution.includes("input.requested") && !hitlExecution.toLowerCase().includes("waiting for input"),
    "执行树里出现了审批/等待输入的痕迹——codex-sdk 不该有 HITL 信号",
  );

  console.log("[verify] all assertions passed.");
}
