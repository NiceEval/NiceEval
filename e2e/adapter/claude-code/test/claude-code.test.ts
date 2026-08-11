// owner: docs/engineering/testing/e2e/adapter/claude-code.md#adapter-claude-code-live-compatibility
//
// 单文件 Journey：真实 Claude Code + Docker Sandbox + live provider。
// 具体 Skill、MCP、Plugin 与配置行为由各自 Eval 断言；owner 只守住发现完整性与全绿结果。
// 只从 @niceeval/testkit 根导入；不读 .niceeval 私有布局、不 import 候选源码/类型。

import { command, type ExpEvent, type ExpResultEvent, type ProcessReceipt } from "@niceeval/testkit";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const EXPECTED_EVALS = [
  "coding-task",
  "session-resume",
  "skill-used",
  "skill-checklist",
  "skill-unused",
  "repo-skill",
  "mcp-tools",
  "plugin-mcp",
  "remote-plugin",
  "websearch-denied",
] as const;

const EXPECTED_EXPERIMENTS = [
  "coding",
  "skill",
  "repo-skill",
  "mcp",
  "plugin",
  "plugin-reuse",
  "remote-plugin",
  "locked-down",
] as const;
const EXPECTED_PASSED_ATTEMPTS = 12;

const REQUIRED_LIVE_SECRETS = ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL"] as const;

const niceeval = command([join(process.cwd(), "node_modules", ".bin", "niceeval")]);

function requireLiveSecrets(): void {
  const missing = REQUIRED_LIVE_SECRETS.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `[configuration] live claude-code E2E requires ${missing.join(", ")}; ` +
        "the live test is not skipped when secrets are absent",
    );
  }
}

async function requireDocker(): Promise<void> {
  const docker = await command(["docker"]).run(["info"]);
  if (docker.exitCode !== 0) {
    throw new Error(
      `[configuration] docker info failed (exit ${docker.exitCode}) — ` +
        "Docker daemon is required for the claude-code sandbox",
    );
  }
}

function expectSuccessfulCli(receipt: ProcessReceipt): void {
  expect(receipt.exitCode, receipt.diagnostic()).toBe(0);
}

it("真实 Claude Code adapter 的全部专用 Eval 通过", async () => {
  requireLiveSecrets();
  await requireDocker();

  rmSync(".niceeval", { recursive: true, force: true });

  const run = await niceeval.run(
    ["exp", "--rerun", "all", "--json"],
    { timeoutMs: 50 * 60_000 },
  );
  expectSuccessfulCli(run);
  const events = run.ndjson<ExpEvent>();
  const result: ExpResultEvent = run.expResult();
  expect(result).toMatchObject({
    event: "result",
    status: "passed",
    passed: EXPECTED_PASSED_ATTEMPTS,
    failed: 0,
    errored: 0,
    completion: "complete",
  });
  const evalEvents = events.filter((event) => event.event === "eval");

  expect(new Set(evalEvents.map((event) => event.evalId))).toEqual(new Set(EXPECTED_EVALS));
  expect(new Set(evalEvents.map((event) => event.experimentId))).toEqual(new Set(EXPECTED_EXPERIMENTS));
  for (const event of evalEvents) {
    expect(event.verdict, `${event.experimentId}/${event.evalId} did not pass`).toBe("passed");
    expect(event.passed, `${event.experimentId}/${event.evalId} lost an attempt`).toBe(event.attempts);
  }

}, 52 * 60_000);
