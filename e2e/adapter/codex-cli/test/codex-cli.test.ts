// owner: docs/engineering/testing/e2e/adapter/codex-cli.md#adapter-codex-cli-live-compatibility
//
// 单文件 Journey：真实 Codex CLI + Docker Sandbox + live provider，
// 再从公开 CLI 读回 Eval、attempt、execution 与 timing。
// 只从 @niceeval/testkit 根导入；不读 .niceeval 私有布局、不 import 候选源码/类型。

import { command, type ExpEvalEvent, type ProcessReceipt } from "@niceeval/testkit";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

// 每条 Eval 的首轮只有一个 Attempt；只有结构化 verdict=failed 才由本测试另起一次 Invocation。
const EXPECTED_PASSED_ATTEMPTS = 18;
// 每个 Experiment 产生一个 Run（docs/feature/experiments/cli.md「结束反馈与 receipt」）；
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

function evalKey(event: Pick<ExpEvalEvent, "experimentId" | "evalId">): string {
  return `${event.experimentId}\u0000${event.evalId}`;
}

function assertExactRetryEvalSelector(events: readonly ExpEvalEvent[], failed: ExpEvalEvent): void {
  // Experiment selectors prefer an exact ID before considering path-prefix
  // families. Eval selectors intentionally use bare prefixes, so only the
  // Eval selector needs a preflight ambiguity check before spending a retry.
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

it("真实 Codex CLI adapter 在 Docker sandbox 中的运行结果经过公开 CLI 读回", async () => {
  requireLiveSecrets();
  await requireDocker();

  rmSync(".niceeval", { recursive: true, force: true });

  // invoke：完整 argv 走安装后的 candidate binary；真实 Codex CLI、Docker sandbox
  // 与 live provider 仍由 experiments/* + evals/ 驱动。
  const run = await niceeval.run(["exp", "--rerun", "all", "--json"], {
    timeoutMs: 44 * 60_000,
  });
  // receipt 只承载 Invocation 级完成事实（docs/feature/experiments/cli.md「结束反馈与
  // receipt」）：completion 与 runIds（每个 Experiment 一个 Run）。成败由下面带身份的
  // eval 事件精确断言，不从 receipt 猜计数。
  const inv = run.expReceipt();
  expect(inv.completion, run.diagnostic()).toBe("completed");
  expect(inv.runIds, run.diagnostic()).toHaveLength(EXPECTED_EXPERIMENTS);
  // eval 事件是中间的身份事件：identity / verdict / attempts 在此精确断言。
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
  for (const event of failed) assertExactRetryEvalSelector(firstEvents, event);

  // 这些 Invocation 继续写同一个保留证据的 Record；Record 是单写者，多个 CLI 进程
  // 重叠会确定性触发 RecordWriterBusy。主 Invocation 内的 Attempt 并发不受影响。
  const retryRuns: ProcessReceipt[] = [];
  for (const event of failed) {
    retryRuns.push(
      await niceeval.run(
        ["exp", event.experimentId, event.evalId, "--rerun", "all", "--json"],
        { timeoutMs: 44 * 60_000 },
      ),
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
  const evalEvents = firstEvents.map((event) => retriedByEval.get(evalKey(event)) ?? event);
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

  // MCP 正调也要穿透到 CLI 读回：stdio 与远程 HTTP 调用都存在。
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
}, 92 * 60_000);
