// e2e 回归:SandboxSpec.setup()/.teardown() 生命周期钩子 + ctx.experimentId(见
// docs/sandbox.md「沙箱钩子」)。跑一遍真实 CLI(`niceeval exp`)对着一个内存假
// Sandbox(defineSandbox() 自定义 provider,不起真容器/microVM),用一份追加日志断言:
//   1. 全序:sandbox.setup(a,b) → agent.setup → send → agent.teardown →
//      sandbox.setup 返回的 cleanup(LIFO)→ sandbox.teardown(逆序)。
//   2. ctx.experimentId 在同一 attempt 内处处一致、非空,且等于路径推导出的实验 id。
//   3. sandbox.setup 抛错 → verdict errored,但已进入的收尾(cleanup / teardown)仍执行,
//      agent.setup 从未被调用(它排在 sandbox.setup 之后)。
//
// 全程不联网:两个实验都用 `defineSandboxAgent` 的确定性 mock send,sandbox 是内存假实现。

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFile, readdir, rm } from "node:fs/promises";
import { afterAll, beforeAll, expect, test } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const fixtureDir = join(here, "fixtures", "sandbox-hooks");
const logPath = join(fixtureDir, ".hook-log.jsonl");

beforeAll(async () => {
  await rm(join(fixtureDir, ".niceeval"), { recursive: true, force: true });
  await rm(logPath, { force: true });
});

afterAll(async () => {
  await rm(join(fixtureDir, ".niceeval"), { recursive: true, force: true });
  await rm(logPath, { force: true });
});

async function runFixtureCli(): Promise<void> {
  const child = spawn(process.execPath, [join(repoRoot, "bin", "niceeval.js"), "exp", "--force", "--quiet"], {
    cwd: fixtureDir,
    stdio: "pipe",
  });
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += String(d)));
  const code = await new Promise<number>((resolve) => child.on("exit", (c) => resolve(c ?? 1)));
  // error/hooks 这条夹具就是设计成 errored 的:退出码非 0 是预期的,这里只兜底真正的崩溃
  // (比如 eval 发现失败、fixture 本身语法错误)。
  if (code !== 0 && code !== 1) {
    throw new Error(`niceeval exp exited ${code}\n${stderr}`);
  }
}

interface LogLine {
  event: string;
  experimentId?: string;
}

async function readLog(): Promise<LogLine[]> {
  const raw = await readFile(logPath, "utf-8").catch(() => "");
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LogLine);
}

async function readLatestSummary(): Promise<{
  results: Array<{ id: string; verdict: string; experimentId?: string; error?: string }>;
}> {
  const runDirRoot = join(fixtureDir, ".niceeval");
  const runs = (await readdir(runDirRoot)).sort();
  const latest = runs.at(-1);
  if (!latest) throw new Error(`no .niceeval run under ${runDirRoot}`);
  const raw = await readFile(join(runDirRoot, latest, "summary.json"), "utf-8");
  return JSON.parse(raw);
}

test("sandbox 钩子:全序 + ctx.experimentId + 失败语义", async () => {
  await runFixtureCli();
  const summary = await readLatestSummary();
  const log = await readLog();

  const orderResult = summary.results.find((r) => r.id === "order/hooks");
  const errorResult = summary.results.find((r) => r.id === "error/hooks");
  expect(orderResult, "order/hooks result missing from summary.json").toBeTruthy();
  expect(errorResult, "error/hooks result missing from summary.json").toBeTruthy();

  // ── 1. 全序(order 实验)──────────────────────────────────────────────
  expect(orderResult!.verdict).toBe("passed");
  const orderExperimentId = orderResult!.experimentId;
  expect(orderExperimentId).toBe("order/mock");

  const orderEvents = log.filter((l) => l.experimentId === orderExperimentId).map((l) => l.event);
  expect(orderEvents).toEqual([
    "sandbox:setup:a",
    "sandbox:setup:b",
    "agent:setup",
    "agent:send",
    "agent:teardown",
    "sandbox:cleanup:a",
    "sandbox:teardown:y",
    "sandbox:teardown:x",
  ]);

  // ── 2. ctx.experimentId 处处一致、等于路径推导出的实验 id ──────────────
  for (const line of log.filter((l) => orderEvents.length > 0 && l.experimentId === orderExperimentId)) {
    expect(line.experimentId).toBe("order/mock");
  }

  // ── 3. 失败语义(error 实验):sandbox.setup 抛错 → errored,已进入的收尾仍执行 ──
  expect(errorResult!.verdict).toBe("errored");
  expect(errorResult!.error ?? "").toContain("boom");
  const errorExperimentId = errorResult!.experimentId;
  expect(errorExperimentId).toBe("error/mock");

  const errorEvents = log.filter((l) => l.experimentId === errorExperimentId).map((l) => l.event);
  expect(errorEvents).toEqual(["sandbox:setup:ok", "sandbox:cleanup:ok", "sandbox:teardown:always"]);
  // agent.setup 排在 sandbox.setup 之后:sandbox.setup 抛错时 agent.setup/teardown 都不该跑。
  expect(errorEvents).not.toContain("agent:setup");
  expect(errorEvents).not.toContain("agent:teardown");
});
