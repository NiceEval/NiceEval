// owner: docs/engineering/testing/e2e/adapter/claude-code.md#adapter-claude-code-live-compatibility
//
// 单文件 Journey：真实 Claude Code + Docker Sandbox + live provider。
// 具体 Skill、MCP、Plugin 与配置行为由各自 Eval 断言；owner 只守住发现完整性与全绿结果。
// 只从 @niceeval/testkit 根导入；不读 .niceeval 私有布局、不 import 候选源码/类型。

import { command, type ExpEvalEvent, type ProcessReceipt } from "@niceeval/testkit";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, expect, it } from "vitest";

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
const EXPECTED_PASSED_ATTEMPTS = 18;
const RETRY_CONCURRENCY = 4;

const REQUIRED_LIVE_SECRETS = ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL"] as const;

const niceeval = command([join(process.cwd(), "node_modules", ".bin", "niceeval")]);
let run!: ProcessReceipt;
let evalEvents!: ExpEvalEvent[];

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

function evalKey(event: Pick<ExpEvalEvent, "experimentId" | "evalId">): string {
  return `${event.experimentId}\u0000${event.evalId}`;
}

function assertExactRetrySelector(events: readonly ExpEvalEvent[], failed: ExpEvalEvent): void {
  const experiments = new Set(
    events
      .filter((event) => event.experimentId.startsWith(failed.experimentId))
      .map((event) => event.experimentId),
  );
  expect(experiments, `ambiguous Experiment retry selector ${failed.experimentId}`).toEqual(
    new Set([failed.experimentId]),
  );
  const evals = events
    .filter(
      (event) =>
        event.experimentId === failed.experimentId && event.evalId.startsWith(failed.evalId),
    )
    .map((event) => event.evalId);
  expect(evals, `ambiguous Eval retry selector ${failed.experimentId}/${failed.evalId}`).toEqual([
    failed.evalId,
  ]);
}

function representativeAttempt(): ExpEvalEvent {
  const attempt = evalEvents.find((event) => event.evalId === "coding-task");
  expect(attempt, run.diagnostic()).toBeDefined();
  expect(attempt?.locator, run.diagnostic()).toBeTruthy();
  return attempt!;
}

beforeAll(async () => {
  requireLiveSecrets();
  await requireDocker();

  rmSync(".niceeval", { recursive: true, force: true });

  run = await niceeval.run(
    ["exp", "--rerun", "all", "--json"],
    { timeoutMs: 50 * 60_000 },
  );
  const inv = run.expReceipt();
  const firstEvents = run.expEvalEvents();
  // plugin-reuse 是八条 Attempt 的 Sandbox 复用 owner，不是模型断言重试消费者。
  const failed = firstEvents.filter(
    (event) => event.verdict === "failed" && event.experimentId !== "plugin-reuse",
  );
  expect(
    firstEvents.filter((event) => event.verdict === "errored" || event.verdict === "skipped"),
    run.diagnostic(),
  ).toHaveLength(0);
  expect(run.exitCode, run.diagnostic()).toBe(failed.length > 0 ? 1 : 0);
  expect(inv.completion, run.diagnostic()).toBe("completed");
  for (const event of failed) assertExactRetrySelector(firstEvents, event);

  const retryRuns: ProcessReceipt[] = [];
  for (let offset = 0; offset < failed.length; offset += RETRY_CONCURRENCY) {
    const batch = failed.slice(offset, offset + RETRY_CONCURRENCY);
    retryRuns.push(
      ...(await Promise.all(
        batch.map((event) =>
          niceeval.run(
            ["exp", event.experimentId, event.evalId, "--rerun", "all", "--json"],
            { timeoutMs: 50 * 60_000 },
          ),
        ),
      )),
    );
  }
  const retriedByEval = new Map<string, ExpEvalEvent>();
  for (let index = 0; index < retryRuns.length; index += 1) {
    const retry = retryRuns[index]!;
    const target = failed[index]!;
    expect(retry.expReceipt(), retry.diagnostic()).toMatchObject({ completion: "completed" });
    const events = retry.expEvalEvents();
    expect(events, retry.diagnostic()).toHaveLength(1);
    expect(events[0], retry.diagnostic()).toMatchObject({
      experimentId: target.experimentId,
      evalId: target.evalId,
    });
    expect(events[0]?.verdict, retry.diagnostic()).toBe("passed");
    expect(retry.exitCode, retry.diagnostic()).toBe(0);
    retriedByEval.set(evalKey(target), events[0]!);
  }
  if (failed.length > 0) {
    process.stderr.write(
      `[niceeval e2e] retried ${failed.length} assertion-failed Eval(s) once; first Invocation ${inv.invocationId} remains recorded\n`,
    );
  }
  evalEvents = firstEvents.map((event) => retriedByEval.get(evalKey(event)) ?? event);
}, 104 * 60_000);

it("真实 Claude Code adapter 的全部专用 Eval 通过", () => {
  // receipt 只承载 Invocation 级完成事实（docs/feature/experiments/cli.md「结束反馈与
  // receipt」）：completion 与 runIds（每个 Experiment 一个 Run）；成败由下面带身份的
  // eval 事件精确断言，不从 receipt 猜计数。
  const inv = run.expReceipt();
  expect(inv.completion, run.diagnostic()).toBe("completed");
  expect(inv.runIds, run.diagnostic()).toHaveLength(EXPECTED_EXPERIMENTS.length);

  expect(new Set(evalEvents.map((event) => event.evalId))).toEqual(new Set(EXPECTED_EVALS));
  expect(new Set(evalEvents.map((event) => event.experimentId))).toEqual(new Set(EXPECTED_EXPERIMENTS));
  for (const event of evalEvents) {
    expect(event.verdict, `${event.experimentId}/${event.evalId} did not pass`).toBe("passed");
    expect(event.passed, `${event.experimentId}/${event.evalId} lost an attempt`).toBe(event.attempts);
  }
  const totalPassed = evalEvents.reduce((sum, event) => sum + (event.passed ?? 0), 0);
  expect(totalPassed, run.diagnostic()).toBe(EXPECTED_PASSED_ATTEMPTS);
});

it("show --execution 读回 Claude Code 的代表性工具证据", async () => {
  const attempt = representativeAttempt();
  const execution = await niceeval.run(["show", attempt.locator!, "--execution"]);
  expect(execution.exitCode, execution.diagnostic()).toBe(0);
  expect(execution.stdout).toContain("notes.txt");
  expect(execution.stdout).toContain("niceeval-e2e-marker-alpha-926");
});

it("show --timing 读回 Claude Code 的 runner 阶段", async () => {
  const attempt = representativeAttempt();
  const timing = await niceeval.run(["show", attempt.locator!, "--timing"]);
  expect(timing.exitCode, timing.diagnostic()).toBe(0);
  expect(timing.stdout, timing.diagnostic()).toContain("eval.run");
  expect(timing.stdout, timing.diagnostic()).toContain("agent.setup");
  expect(timing.stdout, timing.diagnostic()).toMatch(/turn\s+turn1\b/);
});
