// owner: docs/engineering/testing/e2e/adapter/openclaw.md#adapter-openclaw-live-compatibility
//
// 单文件 Journey：真实 OpenClaw CLI + Docker Sandbox + live provider，
// 再从公开 CLI 读回 Eval、attempt、execution 与 timing。
// 只从 @niceeval/testkit 根导入；不读 .niceeval 私有布局、不 import 候选源码/类型。

import { command, type ExpResultEvent } from "@niceeval/testkit";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const EXPECTED_EVALS = [
  "coding-task/write-and-verify",
  "skills/status-report",
  "session/recall",
  "usage/tokens",
] as const;

const REQUIRED_LIVE_SECRETS = ["BUB_API_KEY", "BUB_API_BASE"] as const;

const niceeval = command([join(process.cwd(), "node_modules", ".bin", "niceeval")]);

function requireLiveSecrets(): void {
  const missing = REQUIRED_LIVE_SECRETS.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `[configuration] live openclaw E2E requires ${missing.join(", ")}; ` +
        "the live test is not skipped when secrets are absent",
    );
  }
}

async function requireDocker(): Promise<void> {
  const docker = await command(["docker"]).run(["info"]);
  if (docker.exitCode !== 0) {
    throw new Error(
      `[configuration] docker info failed (exit ${docker.exitCode}) — ` +
        "Docker daemon is required for the openclaw sandbox",
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

it("真实 OpenClaw CLI adapter 在 Docker sandbox 中的运行结果经过公开 CLI 读回", async () => {
  requireLiveSecrets();
  await requireDocker();

  rmSync(".niceeval", { recursive: true, force: true });

  const run = await niceeval.run(["exp", "--rerun", "all", "--json"], {
    timeoutMs: 46 * 60_000,
  });
  expect(run.exitCode, run.diagnostic()).toBe(0);
  const result: ExpResultEvent = run.expResult();
  expect(result).toMatchObject({
    event: "result",
    status: "passed",
    passed: EXPECTED_EVALS.length,
    failed: 0,
    errored: 0,
    completion: "complete",
  });

  const codingTaskLocator = await latestAttemptLocator("coding-task/write-and-verify");
  for (const evalId of EXPECTED_EVALS) {
    if (evalId === "coding-task/write-and-verify") continue;
    await latestAttemptLocator(evalId);
  }

  const execution = await niceeval.run(["show", codingTaskLocator, "--execution"]);
  expect(execution.exitCode, execution.diagnostic()).toBe(0);
  expect(execution.stdout, "execution tree missing file_write input path").toContain("notes.txt");
  expect(execution.stdout, "execution tree missing file_write input content").toContain("niceeval e2e ok");
  expect(execution.stdout, "execution tree missing shell input command").toMatch(/cat\s+notes\.txt/);

  const skillLocator = await latestAttemptLocator("skills/status-report");
  const skillExecution = await niceeval.run(["show", skillLocator, "--execution"]);
  expect(skillExecution.exitCode, skillExecution.diagnostic()).toBe(0);
  expect(skillExecution.stdout, "execution tree missing selected Skill read input").toContain(
    ".agents/skills/niceeval-status-report/SKILL.md",
  );
  // decoy 的否定在 Eval 的标准事件流上判定。这里不能对整段 CLI 文本作反包含：用户题干
  // 本身点名了 decoy 路径，命中它只说明 CLI 如实显示了 USER 卡片，不能说明 Agent 读取过它。

  const timing = await niceeval.run(["show", codingTaskLocator, "--timing"]);
  expect(timing.exitCode, timing.diagnostic()).toBe(0);
  expect(timing.stdout).toContain("eval.run");
  expect(timing.stdout).toContain("agent.setup");
  expect(timing.stdout).toMatch(/turn\s+turn1\b/);
}, 48 * 60_000);
