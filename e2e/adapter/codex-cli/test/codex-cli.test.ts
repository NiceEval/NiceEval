// owner: docs/engineering/testing/e2e/adapter/codex-cli.md#adapter-codex-cli-live-compatibility
//
// 单文件 Journey：真实 Codex CLI + Docker Sandbox + live provider，
// 再从公开 CLI 读回 Eval、attempt、execution 与 timing。
// 只从 @niceeval/testkit 根导入；不读 .niceeval 私有布局、不 import 候选源码/类型。

import { command, type ExpEvalEvent, type ExpEvent } from "@niceeval/testkit";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const EXPECTED_EVALS = [
  "coding-task",
  "session",
  "usage",
  "mcp",
  "skill",
  "skill-release-note",
  "repo-skill",
  "plugin-hook",
  "configfile",
] as const;
// baseline/configfile/mcp/skill 都在首个通过 attempt 后 early-exit；其余实验才跑完整计划。
const EXPECTED_PASSED_ATTEMPTS = 11;
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

async function attemptLines(evalId: string): Promise<string[]> {
  const history = await niceeval.run(["show", evalId, "--history"]);
  expect(history.exitCode, history.diagnostic()).toBe(0);
  return history.stdout.split("\n").filter((line) => line.includes("@"));
}

async function latestAttemptLocator(evalId: string): Promise<string> {
  const lines = await attemptLines(evalId);
  expect(lines.length, `${evalId} has no public attempt in show --history`).toBeGreaterThan(0);

  const latest = lines.at(-1)!;
  expect(latest, `${evalId} latest attempt is not passed: ${latest}`).toContain("passed");
  const locator = latest.match(/@\S+/)?.[0];
  expect(locator, `${evalId} history line has no public locator: ${latest}`).toBeDefined();
  return locator!;
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
  expect(new Set(evalEvents.map((event) => event.evalId))).toEqual(new Set(EXPECTED_EVALS));
  const totalPassed = evalEvents.reduce(
    (sum, event) => sum + (event.reason === "early_exit" ? 1 : (event.passed ?? 0)),
    0,
  );
  expect(totalPassed, run.diagnostic()).toBe(EXPECTED_PASSED_ATTEMPTS);
  for (const event of evalEvents) {
    expect(event.verdict, `${event.experimentId}/${event.evalId} did not pass`).toBe("passed");
    if (event.reason === "early_exit") {
      expect(event.planned, `${event.experimentId}/${event.evalId} planned mismatch`).toBe(
        event.attempts + event.unstarted,
      );
    } else {
      expect(event.passed, `${event.experimentId}/${event.evalId} lost an attempt`).toBe(event.attempts);
    }
  }

  const codingTaskLocator = await latestAttemptLocator("coding-task");
  for (const evalId of EXPECTED_EVALS) {
    if (evalId === "coding-task") continue;
    await latestAttemptLocator(evalId);
  }

  // plugin-hook 由 plugin 与 plugin-reuse 各跑一遍；复用实验的第二条 attempt
  // 是安装收敛探针，必须逐条 passed，不能只看最新一条。
  for (const line of await attemptLines("plugin-hook")) {
    expect(line, `plugin-hook attempt is not passed: ${line}`).toContain("passed");
  }

  // outcome：execution 是适配器收到的公开投影。TOOL 卡片头是原始未归一化名
  //（command_execution / file_change），canonical 名 shell / file_edit 也可能出现；
  // 入参与 OTel 时间注释必须穿过归一化、落盘与 CLI 展示。
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
  expect(execution.stdout).not.toContain("timing unavailable");

  const timing = await niceeval.run(["show", codingTaskLocator, "--timing"]);
  expect(timing.exitCode, timing.diagnostic()).toBe(0);
  expect(timing.stdout).toMatch(/shell|file_edit/i);

  // MCP 反例也要穿透到 CLI 读回：stdio 与远程 HTTP 调用存在，未挂载的 weather 不出现。
  const mcpLocator = await latestAttemptLocator("mcp");
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

  const repoSkillLocator = await latestAttemptLocator("repo-skill");
  const repoSkillExecution = await niceeval.run(["show", repoSkillLocator, "--execution"]);
  expect(repoSkillExecution.exitCode, repoSkillExecution.diagnostic()).toBe(0);
  expect(repoSkillExecution.stdout).toContain(".agents/skills/calibre/SKILL.md");
  expect(repoSkillExecution.stdout).toContain("ebook-convert novel.epub novel.azw3");
}, 46 * 60_000);
