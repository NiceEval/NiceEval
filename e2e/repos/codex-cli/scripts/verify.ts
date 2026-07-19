// CLI 黑盒验收(docs/engineering/e2e-ci/verification.md):只跑 `pnpm exec niceeval ...`
// 子进程、断言退出码与输出,不 import niceeval 库代码,不递归扫 `.niceeval/`。
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";

const EXPECTED_EVALS = ["coding-task", "session", "usage", "mcp", "skill", "plugin-hook", "configfile"];

function sh(cmd: string, expect: number | "nonzero" = 0): string {
  const res = spawnSync(cmd, { shell: true, encoding: "utf8" });
  const exit = res.status ?? -1;
  const ok = expect === "nonzero" ? exit !== 0 : exit === expect;
  assert.ok(
    ok,
    `${cmd}\n退出 ${exit},预期 ${expect}。stdout 尾部:\n${(res.stdout ?? "").slice(-4000)}\nstderr 尾部:\n${(res.stderr ?? "").slice(-4000)}`,
  );
  return res.stdout ?? "";
}

/**
 * 专给主实验跑跑这一步用:无论成败都先把 stdout 落盘到 logs/exp-ci.log,再断言退出码——
 * niceeval 把失败 Eval 的详情打在 stdout(不是 stderr),`sh()` 的断言消息只截 stderr 会看不到
 * 真实原因;e2e.ts 的 infra/regression 分类也要读这份日志,断言失败但日志没写会让分类永远失灵。
 */
function shWithLog(cmd: string, logPath: string): string {
  const res = spawnSync(cmd, { shell: true, encoding: "utf8" });
  const exit = res.status ?? -1;
  writeFileSync(logPath, res.stdout ?? "", "utf8");
  assert.ok(
    exit === 0,
    `${cmd}\n退出 ${exit},预期 0。stdout 尾部(完整版见 ${logPath}):\n${(res.stdout ?? "").slice(-4000)}\nstderr 尾部:\n${(res.stderr ?? "").slice(-4000)}`,
  );
  return res.stdout ?? "";
}

function latestAttemptLine(evalId: string): string {
  const lines = sh(`pnpm exec niceeval show ${evalId} --history`)
    .split("\n")
    .filter((l) => l.includes("@"));
  assert.ok(
    lines.length > 0,
    `show --history 里 ${evalId} 没有任何 attempt 行——实验没跑到这条 Eval,先跑 pnpm exec niceeval exp --dry 看计划`,
  );
  return lines.at(-1)!;
}

export default async function runVerify(): Promise<void> {
  // 诊断:打印本次实际解析到的 niceeval 版本(注入核验的义务在根编排器,这里只是留痕)。
  console.log(`[verify] niceeval resolved to: ${sh("pnpm exec niceeval --version").trim()}`);

  rmSync("junit.xml", { force: true });
  rmSync("logs", { recursive: true, force: true });
  mkdirSync("logs", { recursive: true });

  // 用例一:跑本仓库全部 5 个实验(覆盖 7 条 Eval),断言退出码。--force 保证真实新跑,
  // --output ci 保证只追加的稳定日志,--junit 落 CI 出口。日志无论成败都先落盘(shWithLog)。
  shWithLog("pnpm exec niceeval exp --force --output ci --junit junit.xml", "logs/exp-ci.log");

  // 用例二:show 榜单——应发现的 Eval 都实际运行了(少排用例不能全绿)。本仓库有 5 个
  // experiment(baseline/mcp/plugin/skill/configfile),裸 `show` 不带位置参数时按「实验组」
  // 分区展示比较报告——5 个组时折叠成组级汇总表(每组一行「N passed」,不逐条列 Eval id),
  // 只有单一实验组时才会退化展开成本仓库这种逐 Eval 视图(真机核对过:只跑 baseline 一个
  // experiment 时裸 `show` 确实逐条列出 coding-task/session/usage)。`--page attempts` 是
  // 不随实验组数收缩的逐 attempt 视图,才是"少排用例不能全绿"这条检查该用的页
  // (docs-site/zh/reference/cli.mdx 的 `show` 页说明:「不带位置参数时显示按实验组分区的
  // 默认比较报告」)。
  const board = sh("pnpm exec niceeval show --page attempts");
  for (const id of EXPECTED_EVALS) {
    assert.ok(
      board.includes(id),
      `show --page attempts 缺少 ${id}——发现或选择器行为变了,先跑 pnpm exec niceeval exp --dry 看计划`,
    );
  }

  // 用例三:show --history——逐 attempt 断言 verdict,并从 coding-task 的最新 attempt 拿
  // locator(它同时打了 file_edit 与 shell 两种工具调用,覆盖面最大,用于下面的证据切面)。
  let codingTaskLocator: string | undefined;
  for (const id of EXPECTED_EVALS) {
    const line = latestAttemptLine(id);
    assert.ok(
      line.includes("passed"),
      `${id} 最新 attempt 不是 passed:${line}\n用行尾 locator 执行 pnpm exec niceeval show @<locator> 看主失败断言`,
    );
    if (id === "coding-task") codingTaskLocator = line.match(/@\S+/)?.[0];
  }
  assert.ok(codingTaskLocator, "没能从 coding-task 的 --history 行里提取 locator");

  // 用例四:show --execution——调用与入参都存在,且本适配器声明 tracing 面(节点带时间注释)。
  // TOOL 卡片头的名字是 ExecutionActionNode.name(原始未归一化名,对齐 codex `--json` 的
  // item.type),不是 t.calledTool() 断言用的 canonical 工具名——codex 的 command_execution /
  // file_change 分别归一成 shell / file_edit(见 src/o11y/parsers/codex.ts),但 --execution
  // 展示的是前者。真机核对过:这条 attempt 的 --execution 输出里只有 "TOOL · command_execution"
  // 和 "TOOL · file_change",没有字面的 "shell"/"file_edit"。同一坑 e2e/repos/codex-sdk 的
  // verify.ts 已经用 OR 写法绕过,这里镜像同一处理。
  const execution = sh(`pnpm exec niceeval show ${codingTaskLocator} --execution`);
  assert.ok(
    execution.includes("file_edit") || execution.includes("file_change"),
    "执行树缺少 file_edit/file_change 调用节点——文件变更事件没有归一进事件流,或 show 执行树读不回",
  );
  assert.ok(
    execution.includes("shell") || execution.includes("command_execution"),
    "执行树缺少 shell/command_execution 调用节点——命令执行事件没有归一进事件流,或 show 执行树读不回",
  );
  assert.ok(
    execution.includes("niceeval-e2e-run-914"),
    "TOOL 卡片的 input 里没有出现 shell 命令入参——入参在归一或展示链路上被丢弃/改写",
  );
  assert.ok(
    !execution.includes("timing unavailable"),
    "执行树节点缺 span 时间注释——本仓库的 codexAgent 声明了 tracing,OTel 应该接上;用 show --timing 看 OTel 子树挂上没有",
  );

  // 用例五:show --timing——OTel 子树以 tool/model 角色挂出 span。
  const timing = sh(`pnpm exec niceeval show ${codingTaskLocator} --timing`);
  assert.ok(
    /shell|file_edit/i.test(timing),
    "--timing 的 OTel 子树没有工具 span——mapper 没归一出 tool 角色,或 span 没关联到本轮",
  );

  // 用例六:MCP 反例的展示面核验——notCalledTool 的证据同样要穿透到 CLI 读回:执行树不应
  // 出现从未挂载的 weather.get_weather。
  const mcpLine = latestAttemptLine("mcp");
  const mcpLocator = mcpLine.match(/@\S+/)?.[0];
  assert.ok(mcpLocator, "没能从 mcp 的 --history 行里提取 locator");
  const mcpExecution = sh(`pnpm exec niceeval show ${mcpLocator} --execution`);
  assert.ok(
    mcpExecution.includes("e2e.get-sum") || mcpExecution.includes("get-sum"),
    "执行树缺少 stdio MCP 调用节点(e2e.get-sum)——调用没被归一进事件流,或 show 执行树读不回",
  );
  assert.ok(
    mcpExecution.includes("deepwiki.read_wiki_structure") || mcpExecution.includes("read_wiki_structure"),
    "执行树缺少远程 HTTP MCP 调用节点(deepwiki.read_wiki_structure)——调用没被归一进事件流,或 show 执行树读不回",
  );
  assert.ok(
    !mcpExecution.includes("weather.get_weather"),
    "执行树里出现了从未挂载的 weather.get_weather——转换器为不存在的挂载编造了归一结果",
  );

  console.log("[verify] all assertions passed.");
}
