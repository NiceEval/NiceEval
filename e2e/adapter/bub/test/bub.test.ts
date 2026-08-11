// owner: docs/engineering/testing/e2e/adapter/bub.md#adapter-bub-live-compatibility
//
// 单文件 Journey：真实 bubAgent + Docker Sandbox + live provider，
// 再从公开 CLI 读回 Eval、attempt、execution 与 timing。
// 只从 @niceeval/testkit 根导入；不读 .niceeval 私有布局、不 import 候选源码/类型。

import { command, type ExpResultEvent } from "@niceeval/testkit";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const EXPECTED_EVALS = [
  "coding-task/write-and-verify",
  "skills/discovery",
  "extensions/plugin-postsetup",
  "session/recall",
] as const;

const REQUIRED_LIVE_SECRETS = ["BUB_API_KEY", "BUB_API_BASE"] as const;

const niceeval = command([join(process.cwd(), "node_modules", ".bin", "niceeval")]);

function requireLiveSecrets(): void {
  const missing = REQUIRED_LIVE_SECRETS.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `[configuration] live bub E2E requires ${missing.join(", ")}; ` +
        "the live test is not skipped when secrets are absent",
    );
  }
}

async function requireDocker(): Promise<void> {
  const docker = await command(["docker"]).run(["info"]);
  if (docker.exitCode !== 0) {
    throw new Error(
      `[configuration] docker info failed (exit ${docker.exitCode}) — ` +
        "Docker daemon is required for the bub sandbox",
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

it("真实 bub adapter 在 Docker sandbox 中的运行结果经过公开 CLI 读回", async () => {
  requireLiveSecrets();
  await requireDocker();

  rmSync(".niceeval", { recursive: true, force: true });

  // invoke：先只跑 ci——结果目录一旦有两个实验，show 默认报告会折叠成实验汇总表。
  const run = await niceeval.run(
    ["exp", "ci", "--rerun", "all", "--json"],
    { timeoutMs: 32 * 60_000 },
  );
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

  // 每个 Eval 用公开的 `show <eval-id> --history` 逐一取回 locator。默认 report 表会按
  // 终端宽度折行，不拿它的视觉布局重复证明 Report 域已经拥有的渲染契约。
  const locators: Record<string, string> = {};
  for (const evalId of EXPECTED_EVALS) {
    locators[evalId] = await latestAttemptLocator(evalId);
  }

  // outcome：execution 是适配器收到的公开投影——工具入参、Skill、pythonPlugins 与 tracing 时间注释。
  const coding = await niceeval.run([
    "show",
    locators["coding-task/write-and-verify"]!,
    "--execution",
  ]);
  expect(coding.exitCode, coding.diagnostic()).toBe(0);
  expect(coding.stdout).toContain("notes.txt");
  expect(coding.stdout).not.toContain("timing unavailable");

  const skills = await niceeval.run(["show", locators["skills/discovery"]!, "--execution"]);
  expect(skills.exitCode, skills.diagnostic()).toBe(0);
  expect(skills.stdout.toLowerCase()).toContain("skill");
  expect(skills.stdout).toContain("pineapple-37");

  const ext = await niceeval.run([
    "show",
    locators["extensions/plugin-postsetup"]!,
    "--execution",
  ]);
  expect(ext.exitCode, ext.diagnostic()).toBe(0);
  expect(ext.stdout).toContain("PLUGIN_OK");

  // timing：runner 分阶段耗时树；bub 不要求字面 OTel 子树（per-turn traceId 归属未落地）。
  const timing = await niceeval.run([
    "show",
    locators["coding-task/write-and-verify"]!,
    "--timing",
  ]);
  expect(timing.exitCode, timing.diagnostic()).toBe(0);
  expect(timing.stdout).toContain("eval.run");
  expect(timing.stdout).toContain("agent.setup");
  expect(timing.stdout).toMatch(/turn\s+turn1\b/);

  // legacy 版本线放最后：version/otelPlugin pin 到 0.3.9 仍产出时间注释。
  const legacy = await niceeval.run(
    [
      "exp",
      "legacy",
      "coding-task",
      "--rerun",
      "all",
      "--json",
    ],
    { timeoutMs: 20 * 60_000 },
  );
  expect(legacy.exitCode, legacy.diagnostic()).toBe(0);
  const legacyResult: ExpResultEvent = legacy.expResult();
  expect(legacyResult).toMatchObject({
    event: "result",
    status: "passed",
    passed: 1,
    failed: 0,
    errored: 0,
    completion: "complete",
  });

  const legacyLocator = await latestAttemptLocator("coding-task/write-and-verify");
  const legacyExecution = await niceeval.run(["show", legacyLocator, "--execution"]);
  expect(legacyExecution.exitCode, legacyExecution.diagnostic()).toBe(0);
  expect(legacyExecution.stdout).not.toContain("timing unavailable");
}, 36 * 60_000);
