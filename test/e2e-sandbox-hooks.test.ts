// e2e 回归:SandboxSpec.setup()/.teardown() 生命周期钩子 + ctx.experimentId(见
// docs/feature/sandbox/library.md「沙箱生命周期钩子」)。跑一遍真实 CLI(`niceeval exp`)对着一个内存假
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
  const child = spawn(process.execPath, [join(repoRoot, "bin", "niceeval.js"), "exp", "--force", "--output", "agent"], {
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

// 落盘布局(Results Format schemaVersion 4,见 docs/feature/results/architecture.md)是
// .niceeval/<experiment>/<timestamp-rand>/snapshot.json + <evalId>/a<n>/result.json,
// 每个实验一个快照目录。这条 fixture 一次跑两个实验(order + error),所以要
// **每个实验取最新快照**再合并 result.json,逐条补回 experimentId(快照级字段,
// 不落在 attempt 记录里)。
async function findFiles(dir: string, filename: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await findFiles(full, filename)));
    else if (entry.name === filename) found.push(full);
  }
  return found;
}

async function readLatestSummary(): Promise<{
  results: Array<{ id: string; verdict: string; experimentId?: string; error?: string }>;
}> {
  const runDirRoot = join(fixtureDir, ".niceeval");
  const snapshotMetaPaths = await findFiles(runDirRoot, "snapshot.json");
  if (snapshotMetaPaths.length === 0) throw new Error(`no snapshot found under ${runDirRoot}`);
  const snapshots = await Promise.all(
    snapshotMetaPaths.map(async (metaPath) => {
      const meta = JSON.parse(await readFile(metaPath, "utf-8")) as { experimentId: string; startedAt: string };
      return { dir: dirname(metaPath), ...meta };
    }),
  );
  const latestByExperiment = new Map<string, (typeof snapshots)[number]>();
  for (const snap of snapshots) {
    const existing = latestByExperiment.get(snap.experimentId);
    if (!existing || snap.startedAt > existing.startedAt) latestByExperiment.set(snap.experimentId, snap);
  }
  const results: Array<{ id: string; verdict: string; experimentId?: string; error?: string }> = [];
  for (const snap of latestByExperiment.values()) {
    const resultPaths = await findFiles(snap.dir, "result.json");
    for (const p of resultPaths) {
      const record = JSON.parse(await readFile(p, "utf-8")) as { id: string; verdict: string; error?: string };
      results.push({ ...record, experimentId: snap.experimentId });
    }
  }
  return { results };
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
  expect(errorResult!.error?.message ?? "").toContain("boom");
  const errorExperimentId = errorResult!.experimentId;
  expect(errorExperimentId).toBe("error/mock");

  const errorEvents = log.filter((l) => l.experimentId === errorExperimentId).map((l) => l.event);
  expect(errorEvents).toEqual(["sandbox:setup:ok", "sandbox:cleanup:ok", "sandbox:teardown:always"]);
  // agent.setup 排在 sandbox.setup 之后:sandbox.setup 抛错时 agent.setup/teardown 都不该跑。
  expect(errorEvents).not.toContain("agent:setup");
  expect(errorEvents).not.toContain("agent:teardown");
});
