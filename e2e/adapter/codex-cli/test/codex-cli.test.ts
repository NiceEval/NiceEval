// owner: docs/engineering/testing/e2e/adapter/codex-cli.md#adapter-codex-cli-live-compatibility
//
// 单文件 Journey：真实 Codex CLI + Docker Sandbox + live provider，
// 再从公开 CLI 读回 Eval、attempt、execution 与 timing。
// 只从 @niceeval/testkit 根导入；不读 .niceeval 私有布局、不 import 候选源码/类型。

import { command, type ExpEvalEvent, type ExpEvent } from "@niceeval/testkit";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

// baseline/configfile/mcp/skill 都在首个通过 attempt 后 early-exit；其余实验才跑完整计划。
const EXPECTED_PASSED_ATTEMPTS = 17;
// 每个 Experiment 产生一个 Run（docs/feature/experiments/cli.md「结束反馈与 receipt」）；
// 除 plugin-reuse 外每条 Eval 在首个通过 attempt 后由 earlyExit 省略剩余 attempt。
const EXPECTED_EXPERIMENTS = 7;

const REQUIRED_LIVE_SECRETS = [
  "CODEX_API_KEY",
  "CODEX_BASE_URL",
] as const;

const niceeval = command([join(process.cwd(), "node_modules", ".bin", "niceeval")]);

function requireLiveSecrets(): void {
  const missing = REQUIRED_LIVE_SECRETS.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `[configuration] live codex-cli E2E requires ${missing.join(", ")}; ` +
        "the live test is not skipped when secrets are absent",
    );
  }
}

async function requireDocker(): Promise<void> {
  const docker = await command(["docker"]).run(["info"]);
  if (docker.exitCode !== 0) {
    throw new Error(
      `[configuration] docker info failed (exit ${docker.exitCode}) — ` +
        "Docker daemon is required for the codex-cli sandbox",
    );
  }
}

it("真实 Codex CLI adapter 在 Docker sandbox 中的运行结果经过公开 CLI 读回", async () => {
  requireLiveSecrets();
  await requireDocker();

  rmSync(".niceeval", { recursive: true, force: true });

  // invoke：完整 argv 走安装后的 candidate binary；真实 Codex CLI、Docker sandbox
  // 与 live provider 仍由 experiments/* + evals/ 驱动。
  const run = await niceeval.run(["exp", "--rerun", "all", "--json"], {
    timeoutMs: 44 * 60_000,
  });
  expect(run.exitCode, run.diagnostic()).toBe(0);
  // receipt 只承载 Invocation 级完成事实（docs/feature/experiments/cli.md「结束反馈与
  // receipt」）：completion 与 runIds（每个 Experiment 一个 Run）。成败由下面带身份的
  // eval 事件精确断言，不从 receipt 猜计数。
  const inv = run.expReceipt();
  expect(inv.completion, run.diagnostic()).toBe("completed");
  expect(inv.runIds, run.diagnostic()).toHaveLength(EXPECTED_EXPERIMENTS);
  // eval 事件是中间的身份事件：identity / verdict / attempts 在此精确断言。early-exit
  // 触发的 eval 只带 planned/unstarted/reason，不带 passed；跑满的 eval 则 passed ===
  // attempts。early-exit 的代表 attempt 是首条通过的那一次，每次贡献一个 passed attempt。
  const evalEvents = run
    .ndjson<ExpEvent>()
    .filter(
      (event): event is ExpEvalEvent => "event" in event && event.event === "eval",
    );
  const totalPassed = evalEvents.reduce(
    (sum, event) => sum + (event.reason === "early_exit" ? 1 : (event.passed ?? 0)),
    0,
  );
  expect(totalPassed, run.diagnostic()).toBe(EXPECTED_PASSED_ATTEMPTS);
  expect(evalEvents.filter((event) => event.verdict !== "passed"), run.diagnostic()).toHaveLength(0);

  const locatorFor = (evalId: string): string => {
    const event = evalEvents.find((candidate) => candidate.evalId === evalId);
    expect(event, run.diagnostic()).toMatchObject({ verdict: "passed" });
    expect(event?.locator, run.diagnostic()).toMatch(/^@/);
    return event!.locator!;
  };
  const codingTaskLocator = locatorFor("coding-task");

  // outcome：execution 是适配器收到的公开投影。TOOL 卡片头是原始未归一化名
  //（command_execution / file_change），canonical 名 shell / file_edit 也可能出现；
  // 工具身份与入参必须穿过归一化、持久化与 CLI 展示。
  const execution = await niceeval.run(["show", codingTaskLocator, "--execution"]);
  expect(execution.exitCode, execution.diagnostic()).toBe(0);
  expect(
    execution.stdout.includes("file_edit") || execution.stdout.includes("file_change"),
    "execution tree missing file_edit/file_change",
  ).toBe(true);
  expect(
    execution.stdout.includes("shell") || execution.stdout.includes("command_execution"),
    "execution tree missing shell/command_execution",
  ).toBe(true);
  expect(execution.stdout).toContain("niceeval-e2e-run-914");
  const timing = await niceeval.run(["show", codingTaskLocator, "--timing"]);
  expect(timing.exitCode, timing.diagnostic()).toBe(0);
  expect(timing.stdout).toContain("eval.run");
  expect(timing.stdout).toMatch(/turn\s+turn1\b/);

  // MCP 反例也要穿透到 CLI 读回：stdio 与远程 HTTP 调用存在，未挂载的 weather 不出现。
  const mcpLocator = locatorFor("mcp");
  const mcpExecution = await niceeval.run(["show", mcpLocator, "--execution"]);
  expect(mcpExecution.exitCode, mcpExecution.diagnostic()).toBe(0);
  expect(
    mcpExecution.stdout.includes("e2e.get-sum") || mcpExecution.stdout.includes("get-sum"),
    "execution tree missing stdio MCP call (e2e.get-sum)",
  ).toBe(true);
  expect(
    mcpExecution.stdout.includes("deepwiki.read_wiki_structure") ||
      mcpExecution.stdout.includes("read_wiki_structure"),
    "execution tree missing remote HTTP MCP call (deepwiki.read_wiki_structure)",
  ).toBe(true);
  expect(mcpExecution.stdout).not.toContain("weather.get_weather");
}, 46 * 60_000);
