// niceeval/results 的单测:临时目录里构造最小 snapshot.json / result.json / artifact fixture,
// 覆盖定稿契约(docs/feature/results/library.md、docs/feature/results/architecture.md):分层读取(含快照级字段注入)、
// 懒加载与 artifactBase 回退、skipped 三种原因、unfinished-snapshot、latest() 三种警告、
// Selection.filter 修剪、dedupeAttempts 身份键、writer(独占目录、并发快照互不干扰、
// snapshot.json 键形状、writeAttempt/writeAttemptFor、finish 幂等)、copySnapshots(布局、
// knownEvalIds 补记、has* 重算)。
// 读取面 fixture 的目录名/artifact 路径手写(不 import 库的路径函数),让测试独立于实现充当格式基准。

import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  RESULTS_FORMAT,
  RESULTS_SCHEMA_VERSION,
  copySnapshots,
  createResultsWriter,
  dedupeAttempts,
  openResults,
  resolveLocator,
  loadAnnotatedEvalSource,
  LocatorNotFoundError,
  MalformedLocatorError,
  LocatorCollisionError,
  encodeAttemptLocator,
  type AttemptHandle,
  type EvalResult,
  type Results,
  type Snapshot,
  type SnapshotMeta,
} from "./index.ts";

// ───────────────────────── fixture 工具 ─────────────────────────

const roots: string[] = [];
async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "niceeval-results-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

function meta(over: { experimentId: string; agent: string; startedAt: string } & Partial<SnapshotMeta>): SnapshotMeta {
  return {
    format: RESULTS_FORMAT,
    schemaVersion: RESULTS_SCHEMA_VERSION,
    producer: { name: "niceeval", version: "0.3.0" },
    ...over,
  };
}

function record(over: { id: string; attempt: number } & Record<string, unknown>): EvalResult {
  return { verdict: "passed", durationMs: 1000, assertions: [], ...over } as unknown as EvalResult;
}

async function writeSnapshot(root: string, expDir: string, snapDirName: string, m: SnapshotMeta): Promise<string> {
  const dir = join(root, expDir, snapDirName);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "snapshot.json"), JSON.stringify(m, null, 2), "utf-8");
  return dir;
}

async function writeResultFile(snapDir: string, relAttemptDir: string, r: unknown): Promise<string> {
  const dir = join(snapDir, relAttemptDir);
  await mkdir(dir, { recursive: true });
  const path = join(dir, "result.json");
  await writeFile(path, JSON.stringify(r, null, 2), "utf-8");
  return path;
}

async function writeArtifactFile(snapDir: string, relAttemptDir: string, file: string, data: unknown): Promise<string> {
  const dir = join(snapDir, relAttemptDir);
  await mkdir(dir, { recursive: true });
  const path = join(dir, file);
  await writeFile(path, JSON.stringify(data), "utf-8");
  return path;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

// ───────────────────────── 分层读取 ─────────────────────────

describe("openResults · 实验 → 快照 → eval → attempt 分层", () => {
  it("字典序实验、最新快照在前;eval 分组、attempt 平铺;快照级字段注入进 attempt.result(缺才补)", async () => {
    const root = await makeRoot();
    const bubDir = await writeSnapshot(
      root,
      "compare_bub",
      "2026-07-01T08-00-00-000Z-a1b2",
      meta({
        experimentId: "compare/bub",
        agent: "bub",
        model: "gpt-5",
        startedAt: "2026-07-01T08:00:00.000Z",
        completedAt: "2026-07-01T08:10:00.000Z",
      }),
    );
    await writeResultFile(bubDir, "algebra/q1/a1", record({ id: "algebra/q1", attempt: 1, startedAt: "2026-07-01T08:01:00.000Z" }));
    await writeResultFile(bubDir, "algebra/q1/a2", record({ id: "algebra/q1", attempt: 2, verdict: "failed" }));
    await writeResultFile(bubDir, "algebra/q2/a1", record({ id: "algebra/q2", attempt: 1 }));

    await writeSnapshot(
      root,
      "compare_codex",
      "2026-07-01T08-05-00-000Z-c3d4",
      meta({ experimentId: "compare/codex", agent: "codex", model: "o3", startedAt: "2026-07-01T08:05:00.000Z" }),
    );

    const results = await openResults(root);
    expect(results.skipped).toHaveLength(0);
    expect(results.experiments.map((e) => e.id)).toEqual(["compare/bub", "compare/codex"]); // 字典序

    const bub = results.experiments[0];
    expect(bub.snapshots).toHaveLength(1);
    expect(bub.latest).toBe(bub.snapshots[0]);
    expect(bub.evalIds).toEqual(["algebra/q1", "algebra/q2"]);

    const snap = bub.latest;
    expect(snap.agent).toBe("bub");
    expect(snap.model).toBe("gpt-5");
    expect(snap.producer).toEqual({ name: "niceeval", version: "0.3.0" });
    expect(snap.schemaVersion).toBe(RESULTS_SCHEMA_VERSION);
    expect(snap.dir).toBe(bubDir);
    expect(snap.completedAt).toBe("2026-07-01T08:10:00.000Z");
    expect(snap.evals.map((e) => e.id)).toEqual(["algebra/q1", "algebra/q2"]);
    expect(snap.evals[0].attempts).toHaveLength(2);
    expect(snap.attempts).toHaveLength(3);

    const attempt = snap.evals[0].attempts[0];
    expect(attempt.evalId).toBe("algebra/q1");
    expect(attempt.experimentId).toBe("compare/bub");
    expect(attempt.ref).toEqual({ snapshot: "compare_bub/2026-07-01T08-00-00-000Z-a1b2", attempt: "algebra/q1/a1" });
    // 快照级字段注入(record 没写 agent/model/experimentId)。
    expect(attempt.result.agent).toBe("bub");
    expect(attempt.result.model).toBe("gpt-5");
    expect(attempt.result.experimentId).toBe("compare/bub");
    // 缺才补:条目自带的 startedAt 优先。
    expect(attempt.result.startedAt).toBe("2026-07-01T08:01:00.000Z");
    // 第二个 attempt 没写 startedAt,补快照的。
    expect(snap.evals[0].attempts[1].result.startedAt).toBe("2026-07-01T08:00:00.000Z");
  });
});

// ───────────────────────── 懒加载与回退 ─────────────────────────

describe("AttemptHandle · 懒加载", () => {
  it("缺文件返回 null;读一次记忆化;attempt 目录优先、artifactBase 回退;原快照清理后如实 null", async () => {
    const root = await makeRoot();
    const oldSnap = await writeSnapshot(
      root,
      "e",
      "2026-06-30T08-00-00-000Z-xxxx",
      meta({ experimentId: "e", agent: "bub", startedAt: "2026-06-30T08:00:00.000Z", completedAt: "2026-06-30T08:10:00.000Z" }),
    );
    await writeResultFile(oldSnap, "q3/a1", record({ id: "q3", attempt: 1, hasEvents: true }));
    await writeArtifactFile(oldSnap, "q3/a1", "events.json", [{ type: "message", text: "old" }]);

    const newSnap = await writeSnapshot(
      root,
      "e",
      "2026-07-01T08-00-00-000Z-yyyy",
      meta({ experimentId: "e", agent: "bub", startedAt: "2026-07-01T08:00:00.000Z", completedAt: "2026-07-01T08:10:00.000Z" }),
    );
    await writeResultFile(newSnap, "q1/a1", record({ id: "q1", attempt: 1, hasEvents: true }));
    const eventsPath = await writeArtifactFile(newSnap, "q1/a1", "events.json", [{ type: "message", text: "hi" }]);
    await writeResultFile(newSnap, "q2/a1", record({ id: "q2", attempt: 1 }));
    await writeResultFile(
      newSnap,
      "q3/a1",
      record({
        id: "q3",
        attempt: 1,
        startedAt: "2026-06-30T08:01:00.000Z",
        artifactBase: "e/2026-06-30T08-00-00-000Z-xxxx/q3/a1",
        hasEvents: true,
      }),
    );

    const results = await openResults(root);
    const snap = results.experiments[0].latest;
    const q1 = snap.evals.find((e) => e.id === "q1")!.attempts[0];
    const q2 = snap.evals.find((e) => e.id === "q2")!.attempts[0];
    const q3 = snap.evals.find((e) => e.id === "q3")!.attempts[0];

    const events = await q1.events();
    expect(events).toEqual([{ type: "message", text: "hi" }]);
    // result.json 只有 hasEvents/hasTrace/hasSources 三个标记,o11y/diff 没有标记 —— 全靠方法语义吸收。
    expect(await q1.trace()).toBeNull();
    expect(await q1.o11y()).toBeNull();
    expect(await q1.diff()).toBeNull();
    expect(await q1.sources()).toBeNull();

    await rm(eventsPath);
    expect(await q1.events()).toBe(events); // 记忆化:同一 handle 不重新读盘

    expect(await q2.events()).toBeNull(); // 无 artifactBase,不猜路径

    expect(await q3.events()).toEqual([{ type: "message", text: "old" }]); // artifactBase 回退到原快照
    expect(q3.ref.snapshot).toBe("e/2026-07-01T08-00-00-000Z-yyyy"); // ref 指条目所在的落盘(新快照)

    await rm(oldSnap, { recursive: true });
    const reopened = await openResults(root);
    const q3Again = reopened.experiments[0].latest.evals.find((e) => e.id === "q3")!.attempts[0];
    expect(await q3Again.events()).toBeNull(); // 原快照清理后如实返回 null(新句柄,不吃上面的记忆化)
  });
});

// ───────────────────────── skipped 三种原因 ─────────────────────────

describe("openResults · skipped", () => {
  it("incompatible(v3 summary.json / 无信封 legacy)、malformed(坏 JSON)、incomplete(有 attempt 无 snapshot.json);无关 JSON 静默", async () => {
    const root = await makeRoot();

    // v2/v3 的 summary.json 带 format + schemaVersion(≠ 4),自然落进 incompatible 档。
    const v3Dir = join(root, "old-exp", "2026-06-01T08-00-00-000Z");
    await mkdir(v3Dir, { recursive: true });
    await writeFile(
      join(v3Dir, "summary.json"),
      JSON.stringify({
        format: RESULTS_FORMAT,
        schemaVersion: 3,
        producer: { name: "niceeval", version: "0.4.6" },
        agent: "bub",
        startedAt: "2026-06-01T08:00:00.000Z",
        completedAt: "2026-06-01T08:10:00.000Z",
        passed: 1,
        failed: 0,
        skipped: 0,
        errored: 0,
        durationMs: 1000,
        results: [],
      }),
      "utf-8",
    );

    // legacy:引入版本信封之前的存量报告,无 format,按 schemaVersion 1 读。
    const legacyDir = join(root, "legacy-exp", "2026-05-01T08-00-00-000Z");
    await mkdir(legacyDir, { recursive: true });
    await writeFile(
      join(legacyDir, "summary.json"),
      JSON.stringify({ agent: "bub", startedAt: "2026-05-01T08:00:00.000Z", completedAt: "2026-05-01T08:10:00.000Z", results: [] }),
      "utf-8",
    );

    // malformed:坏 JSON。
    const badDir = join(root, "bad-exp", "2026-07-02T08-00-00-000Z-zzzz");
    await mkdir(badDir, { recursive: true });
    await writeFile(join(badDir, "snapshot.json"), "not json {", "utf-8");

    // incomplete:有 result.json,没有 snapshot.json —— crash 没收尾。
    const crashDir = join(root, "crash-exp", "2026-07-03T08-00-00-000Z-wwww");
    await writeResultFile(crashDir, "q1/a1", record({ id: "q1", attempt: 1 }));

    // 直接存在 summary.json 但内容与 niceeval 无关(不满足 legacy 启发式)→ not-a-report,静默忽略,
    // 且不连累父目录被判 incomplete。
    const alienDir = join(root, "alien-exp", "2026-07-06T08-00-00-000Z-alien");
    await mkdir(alienDir, { recursive: true });
    await writeFile(join(alienDir, "summary.json"), JSON.stringify({ hello: 1 }), "utf-8");

    // 完全无关的空目录:静默忽略。
    await mkdir(join(root, "unrelated"), { recursive: true });
    await writeFile(join(root, "unrelated", "hello.json"), JSON.stringify({ hello: 1 }), "utf-8");

    // 一份正常快照,确认不受干扰。
    const okDir = await writeSnapshot(root, "ok-exp", "2026-07-04T08-00-00-000Z-oooo", meta({ experimentId: "ok", agent: "bub", startedAt: "2026-07-04T08:00:00.000Z" }));
    await writeResultFile(okDir, "q1/a1", record({ id: "q1", attempt: 1 }));

    const results = await openResults(root);
    expect(results.experiments.map((e) => e.id)).toEqual(["ok"]);
    expect(results.skipped).toHaveLength(4);

    const v3Skip = results.skipped.find((s) => s.dir === v3Dir)!;
    expect(v3Skip.reason).toBe("incompatible-version");
    expect(v3Skip.schemaVersion).toBe(3);
    expect(v3Skip.producer).toEqual({ name: "niceeval", version: "0.4.6" });

    const legacySkip = results.skipped.find((s) => s.dir === legacyDir)!;
    expect(legacySkip.reason).toBe("incompatible-version");
    expect(legacySkip.schemaVersion).toBe(1);

    expect(results.skipped.find((s) => s.dir === badDir)!.reason).toBe("malformed");
    expect(results.skipped.find((s) => s.dir === crashDir)!.reason).toBe("incomplete");
    expect(results.skipped.find((s) => s.dir === alienDir)).toBeUndefined();
  });
});

// ───────────────────────── latest() Selection 与警告 ─────────────────────────

describe("results.latest() · Selection", () => {
  it("每个实验取最新快照;experiments 前缀过滤同 CLI 语义(尾斜杠等价)", async () => {
    const root = await makeRoot();
    await writeSnapshot(root, "mid_a", "s1", meta({ experimentId: "mid/a", agent: "bub", startedAt: "2026-07-01T08:00:00.000Z", completedAt: "2026-07-01T08:10:00.000Z" }));
    await writeSnapshot(root, "mid_b", "s1", meta({ experimentId: "mid/b", agent: "codex", startedAt: "2026-07-01T08:00:00.000Z", completedAt: "2026-07-01T08:10:00.000Z" }));
    const tuesday = await writeSnapshot(root, "mid_b", "s2", meta({ experimentId: "mid/b", agent: "codex", startedAt: "2026-07-02T08:00:00.000Z", completedAt: "2026-07-02T08:10:00.000Z" }));

    const results = await openResults(root);
    const latest = results.latest();
    expect(latest.snapshots.map((s) => s.experimentId)).toEqual(["mid/a", "mid/b"]);
    expect(latest.snapshots[1].dir).toBe(tuesday);

    expect(results.latest({ experiments: "mid/a" }).snapshots).toHaveLength(1);
    expect(results.latest({ experiments: "mid/" }).snapshots).toHaveLength(2);
    expect(results.latest({ experiments: ["mid/a", "mid/b"] }).snapshots).toHaveLength(2);
    expect(results.latest({ experiments: "other" }).snapshots).toHaveLength(0);
    expect(results.latest({ experiments: "mid/a" }).snapshots[0].experimentId).toBe("mid/a"); // 不误配 "mid/ab"
  });

  it("partial-coverage:最新快照覆盖 < 已知并集;结构化字段 + 渲染好的英文 message", async () => {
    const root = await makeRoot();
    const mondayDir = await writeSnapshot(root, "midterm", "2026-07-01T08-00-00-000Z", meta({ experimentId: "midterm/bub-gpt-5.4", agent: "bub", startedAt: "2026-07-01T08:00:00.000Z", completedAt: "2026-07-01T08:10:00.000Z" }));
    await writeResultFile(mondayDir, "algebra/q1/a1", record({ id: "algebra/q1", attempt: 1 }));
    await writeResultFile(mondayDir, "algebra/q2/a1", record({ id: "algebra/q2", attempt: 1 }));
    await writeResultFile(mondayDir, "algebra/q3/a1", record({ id: "algebra/q3", attempt: 1 }));

    const fridayDir = await writeSnapshot(root, "midterm", "2026-07-05T08-00-00-000Z", meta({ experimentId: "midterm/bub-gpt-5.4", agent: "bub", startedAt: "2026-07-05T08:00:00.000Z", completedAt: "2026-07-05T08:10:00.000Z" }));
    await writeResultFile(fridayDir, "algebra/q1/a1", record({ id: "algebra/q1", attempt: 1 }));

    const latest = (await openResults(root)).latest();
    expect(latest.snapshots).toHaveLength(1);
    const partial = latest.warnings.find((w) => w.kind === "partial-coverage")!;
    expect(partial).toMatchObject({ experimentId: "midterm/bub-gpt-5.4", covered: 1, total: 3 });
    expect(partial.message).toBe(
      "snapshot covers 1 of 3 evals seen in history; re-run `niceeval exp midterm/bub-gpt-5.4` for a full snapshot",
    );
  });

  it("stale-snapshot:早于 Selection 中最新落盘即触发(无阈值),message 带人话时距", async () => {
    const root = await makeRoot();
    await writeSnapshot(root, "mid_a", "s1", meta({ experimentId: "mid/a", agent: "bub", startedAt: "2026-07-01T08:00:00.000Z", completedAt: "2026-07-01T08:10:00.000Z" }));
    await writeSnapshot(root, "mid_b", "s1", meta({ experimentId: "mid/b", agent: "codex", startedAt: "2026-07-05T08:00:00.000Z", completedAt: "2026-07-05T08:10:00.000Z" }));

    const latest = (await openResults(root)).latest();
    const stale = latest.warnings.filter((w) => w.kind === "stale-snapshot");
    expect(stale).toHaveLength(1);
    expect(stale[0]).toMatchObject({ experimentId: "mid/a", startedAt: "2026-07-01T08:00:00.000Z", latestStartedAt: "2026-07-05T08:00:00.000Z" });
    expect(stale[0].message).toContain("predates the latest run in this selection by 4 days");
  });

  it("unfinished-snapshot:选中快照缺 completedAt", async () => {
    const root = await makeRoot();
    const dir = await writeSnapshot(root, "e", "2026-07-01T08-00-00-000Z", meta({ experimentId: "e", agent: "bub", startedAt: "2026-07-01T08:00:00.000Z" }));

    const latest = (await openResults(root)).latest();
    const warn = latest.warnings.find((w) => w.kind === "unfinished-snapshot")!;
    expect(warn).toMatchObject({ experimentId: "e", startedAt: "2026-07-01T08:00:00.000Z", dir });
    expect(warn.message).toContain("has no completedAt");
  });

  it("Selection.filter 只删不换:快照删减,幸存实验的警告保留、其余丢弃", async () => {
    const root = await makeRoot();
    const aDir = await writeSnapshot(root, "mid_a", "s1", meta({ experimentId: "mid/a", agent: "bub", startedAt: "2026-07-01T08:00:00.000Z", completedAt: "2026-07-01T08:10:00.000Z" }));
    await writeResultFile(aDir, "q1/a1", record({ id: "q1", attempt: 1 }));
    await writeResultFile(aDir, "q2/a1", record({ id: "q2", attempt: 1 }));
    const bDir = await writeSnapshot(root, "mid_b", "s1", meta({ experimentId: "mid/b", agent: "codex", startedAt: "2026-07-01T08:00:00.000Z", completedAt: "2026-07-01T08:10:00.000Z" }));
    await writeResultFile(bDir, "q1/a1", record({ id: "q1", attempt: 1 }));
    await writeResultFile(bDir, "q2/a1", record({ id: "q2", attempt: 1 }));

    const aDir2 = await writeSnapshot(root, "mid_a", "s2", meta({ experimentId: "mid/a", agent: "bub", startedAt: "2026-07-02T08:00:00.000Z", completedAt: "2026-07-02T08:10:00.000Z" }));
    await writeResultFile(aDir2, "q1/a1", record({ id: "q1", attempt: 1 }));
    const bDir2 = await writeSnapshot(root, "mid_b", "s2", meta({ experimentId: "mid/b", agent: "codex", startedAt: "2026-07-02T08:00:00.000Z", completedAt: "2026-07-02T08:10:00.000Z" }));
    await writeResultFile(bDir2, "q1/a1", record({ id: "q1", attempt: 1 }));

    const latest = (await openResults(root)).latest();
    expect(latest.warnings.filter((w) => w.kind === "partial-coverage")).toHaveLength(2);

    const filtered = latest.filter((s) => s.experimentId !== "mid/b");
    expect(filtered.snapshots.map((s) => s.experimentId)).toEqual(["mid/a"]);
    expect(filtered.warnings.map((w) => w.experimentId)).toEqual(["mid/a"]);
    // 原 Selection 不被改动。
    expect(latest.snapshots).toHaveLength(2);
    expect(latest.warnings).toHaveLength(2);
  });
});

// ───────────────────────── 身份键去重 ─────────────────────────

function fakeSnapshot(over: { experimentId: string; startedAt: string; dir: string }): Snapshot {
  return {
    agent: "bub",
    producer: { name: "niceeval" },
    schemaVersion: RESULTS_SCHEMA_VERSION,
    evals: [],
    attempts: [],
    ...over,
  };
}

function fakeAttempt(snapshot: Snapshot, result: EvalResult): AttemptHandle {
  return {
    evalId: result.id,
    experimentId: snapshot.experimentId,
    result,
    ref: { snapshot: "x/y", attempt: `${result.id}/a${result.attempt}` },
    snapshot,
    events: async () => null,
    trace: async () => null,
    o11y: async () => null,
    agentSetup: async () => null,
    diff: async () => null,
    sources: async () => null,
  };
}

describe("dedupeAttempts", () => {
  it("按 (experimentId, evalId, attempt, startedAt) 去重,保留最新快照里的那份;缺 startedAt 不去重并出 missing-startedAt", () => {
    const monday = fakeSnapshot({ experimentId: "e", startedAt: "2026-07-01T08:00:00.000Z", dir: "/tmp/e/monday" });
    const tuesday = fakeSnapshot({ experimentId: "e", startedAt: "2026-07-02T08:00:00.000Z", dir: "/tmp/e/tuesday" });

    const a1 = fakeAttempt(monday, record({ id: "q1", attempt: 1, startedAt: "2026-07-01T08:01:00.000Z" }));
    const a1Resumed = fakeAttempt(tuesday, record({ id: "q1", attempt: 1, startedAt: "2026-07-01T08:01:00.000Z" })); // resume 原样合入
    const a2Mon = fakeAttempt(monday, record({ id: "q2", attempt: 1, startedAt: "2026-07-01T08:02:00.000Z" }));
    const a2Tue = fakeAttempt(tuesday, record({ id: "q2", attempt: 1, startedAt: "2026-07-02T08:02:00.000Z" })); // 重跑,新 startedAt
    const a3Mon = fakeAttempt(monday, record({ id: "q3", attempt: 1 })); // 缺 startedAt(携带条目缺锚的极端情况)
    const a3Tue = fakeAttempt(tuesday, record({ id: "q3", attempt: 1 }));

    const { attempts, warnings } = dedupeAttempts([a1, a2Mon, a3Mon, a1Resumed, a2Tue, a3Tue]);
    expect(attempts).toHaveLength(5);
    const q1 = attempts.filter((a) => a.evalId === "q1");
    expect(q1).toHaveLength(1);
    expect(q1[0].snapshot).toBe(tuesday); // 保留最新快照
    expect(attempts.filter((a) => a.evalId === "q2")).toHaveLength(2);
    expect(attempts.filter((a) => a.evalId === "q3")).toHaveLength(2);

    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatchObject({ kind: "missing-startedAt", experimentId: "e", evalId: "q3" });
    expect(warnings[0].message).toContain("has no startedAt");
  });
});

// ───────────────────────── writer ─────────────────────────

describe("createResultsWriter", () => {
  it("snapshot() 建目录(独占)+ 写 snapshot.json(无 completedAt);writeAttempt 拆 artifact + 回填 has*;finish 补 completedAt 并幂等", async () => {
    const root = await makeRoot();
    const writer = createResultsWriter(root, { producer: { name: "my-harness", version: "1.0.0" } });

    const snapA = await writer.snapshot({
      experimentId: "compare/a",
      agent: "bub",
      model: "gpt-5",
      startedAt: "2026-07-01T08:00:00.000Z",
      knownEvalIds: ["q1", "q2", "q3"],
    });
    expect(snapA.dir.startsWith(root)).toBe(true);
    const before = JSON.parse(await readFile(join(snapA.dir, "snapshot.json"), "utf-8"));
    expect(before.completedAt).toBeUndefined();
    expect(Object.keys(before)).toEqual(["format", "schemaVersion", "producer", "experimentId", "agent", "model", "startedAt", "knownEvalIds"]);

    const events = [{ type: "message", text: "hi" }] as never[];
    const o11yData = { toolCalls: 2 } as never;
    await snapA.writeAttempt(
      { id: "q1", verdict: "passed", attempt: 1, durationMs: 100, assertions: [], usage: { inputTokens: 10, outputTokens: 5 }, estimatedCostUSD: 0.25 },
      { events, o11y: o11yData },
    );
    await snapA.writeAttempt({ id: "q2", verdict: "failed", attempt: 1, durationMs: 50, assertions: [] });

    const snapB = await writer.snapshot({ experimentId: "compare/b", agent: "codex", startedAt: "2026-07-02T09:00:00.000Z" });
    await snapB.writeAttempt({ id: "q1", verdict: "passed", attempt: 1, durationMs: 80, assertions: [] }, { diff: { generatedFiles: { "a.txt": "1" }, deletedFiles: [] } });

    await writer.finish();
    expect(writer.snapshotDirs().map((s) => s.experimentId).sort()).toEqual(["compare/a", "compare/b"]);

    const after = JSON.parse(await readFile(join(snapA.dir, "snapshot.json"), "utf-8"));
    expect(typeof after.completedAt).toBe("string");
    expect(Object.keys(after)).toEqual(["format", "schemaVersion", "producer", "experimentId", "agent", "model", "startedAt", "completedAt", "knownEvalIds"]);

    await expect(writer.finish()).rejects.toThrow(/already called/);

    const results = await openResults(root);
    expect(results.skipped).toHaveLength(0);
    expect(results.experiments.map((e) => e.id)).toEqual(["compare/a", "compare/b"]);

    const a = results.experiments[0].latest;
    expect(a.agent).toBe("bub");
    expect(a.model).toBe("gpt-5");
    expect(a.knownEvalIds).toEqual(["q1", "q2", "q3"]);
    expect(results.experiments[0].evalIds).toEqual(["q1", "q2", "q3"]);

    const q1 = a.evals.find((e) => e.id === "q1")!.attempts[0];
    expect(q1.result).toMatchObject({
      id: "q1",
      agent: "bub",
      model: "gpt-5",
      experimentId: "compare/a",
      startedAt: "2026-07-01T08:00:00.000Z",
      verdict: "passed",
      durationMs: 100,
      usage: { inputTokens: 10, outputTokens: 5 },
      estimatedCostUSD: 0.25,
      hasEvents: true,
      hasTrace: false,
      hasSources: false,
    });
    expect(await q1.events()).toEqual(events);
    expect(await q1.o11y()).toEqual(o11yData);
    expect(await q1.trace()).toBeNull();

    const b = results.experiments[1].latest;
    expect(b.model).toBeUndefined();
    expect(await b.attempts[0].diff()).toEqual({ generatedFiles: { "a.txt": "1" }, deletedFiles: [] });

    const partial = results.latest().warnings.find((w) => w.kind === "partial-coverage")!;
    expect(partial).toMatchObject({ experimentId: "compare/a", covered: 2, total: 3 });
  });

  it("agentSetup:落成 agent-setup.json(不内联进 result.json),懒加载读回;没装扩展的 attempt 恒 null;copySnapshots 能带上", async () => {
    const root = await makeRoot();
    const writer = createResultsWriter(root, { producer: { name: "niceeval", version: "0.12.0" } });
    const manifest = {
      skills: [{ kind: "repo" as const, source: "Effect-TS/skills", ref: "8f3c1a2", skills: ["effect"] }],
      nativePlugins: [
        {
          agent: "claude-code" as const,
          marketplace: { name: "acme", source: "acme/claude-code-plugins", ref: "v1.3.0" },
          name: "safe-shell",
          resolvedVersion: "1.3.0",
        },
      ],
      mcpServers: [{ name: "browser", command: "npx", args: ["-y", "@modelcontextprotocol/server-browser"] }],
    };

    const snap = await writer.snapshot({
      experimentId: "skill-ab/claude-effect",
      agent: "claude-code",
      startedAt: "2026-07-11T08:00:00.000Z",
    });
    await snap.writeAttempt({ id: "q1", verdict: "passed", attempt: 1, durationMs: 10, assertions: [] }, { agentSetup: manifest });
    await snap.writeAttempt({ id: "q2", verdict: "passed", attempt: 1, durationMs: 10, assertions: [] });
    await writer.finish();

    // 文件名是磁盘侧的 kebab;判决记录里不内联 manifest(它是 artifact,不是判决的一部分)
    const attemptDir = join(snap.dir, "q1", "a1");
    expect(await exists(join(attemptDir, "agent-setup.json"))).toBe(true);
    expect(JSON.parse(await readFile(join(attemptDir, "result.json"), "utf-8")).agentSetup).toBeUndefined();
    expect(await exists(join(snap.dir, "q2", "a1", "agent-setup.json"))).toBe(false);

    const results = await openResults(root);
    const [q1, q2] = results.experiments[0].latest.attempts;
    expect(await q1.agentSetup()).toEqual(manifest);
    expect(await q2.agentSetup()).toBeNull();

    const dest = join(await makeRoot(), "published");
    await copySnapshots(results.latest(), dest, { artifacts: ["agentSetup"] });
    const copied = join(dest, "skill-ab_claude-effect", basename(snap.dir), "q1", "a1", "agent-setup.json");
    expect(JSON.parse(await readFile(copied, "utf-8"))).toEqual(manifest);
  });

  it("snapshot() 缺 experimentId/agent/startedAt 抛可执行错误", async () => {
    const root = await makeRoot();
    const writer = createResultsWriter(root, { producer: { name: "x" } });
    await expect(writer.snapshot({ experimentId: "", agent: "a", startedAt: "t" })).rejects.toThrow(/experimentId/);
    await expect(writer.snapshot({ experimentId: "e", agent: "", startedAt: "t" })).rejects.toThrow(/agent/);
    await expect(writer.snapshot({ experimentId: "e", agent: "a", startedAt: "" })).rejects.toThrow(/startedAt/);
  });

  it("同一 writer 内同 experimentId 重复声明:复用同一个 SnapshotWriter,knownEvalIds 取并集", async () => {
    const root = await makeRoot();
    const writer = createResultsWriter(root, { producer: { name: "x" } });
    const s1 = await writer.snapshot({ experimentId: "e", agent: "bub", startedAt: "2026-07-01T08:00:00.000Z", knownEvalIds: ["q1", "q2"] });
    const s2 = await writer.snapshot({ experimentId: "e", agent: "bub", startedAt: "2026-07-01T08:00:00.000Z", knownEvalIds: ["q2", "q3"] });
    expect(s2).toBe(s1);
    await writer.finish();
    const written = JSON.parse(await readFile(join(s1.dir, "snapshot.json"), "utf-8"));
    expect(written.knownEvalIds).toEqual(["q1", "q2", "q3"]);
  });

  it("同一毫秒并发声明不同 experimentId 的快照:互不干扰,各自独立目录", async () => {
    const root = await makeRoot();
    const writer = createResultsWriter(root, { producer: { name: "x" } });
    const now = "2026-07-01T08:00:00.000Z";
    const [a, b, c] = await Promise.all([
      writer.snapshot({ experimentId: "e/a", agent: "bub", startedAt: now }),
      writer.snapshot({ experimentId: "e/b", agent: "bub", startedAt: now }),
      writer.snapshot({ experimentId: "e/c", agent: "bub", startedAt: now }),
    ]);
    expect(new Set([a.dir, b.dir, c.dir]).size).toBe(3);
    await writer.finish();
    const results = await openResults(root);
    expect(results.experiments.map((e) => e.id).sort()).toEqual(["e/a", "e/b", "e/c"]);
  });

  it("快照目录独占创建:撞名换随机后缀重试直到成功(EEXIST 不会覆盖已有目录)", async () => {
    const root = await makeRoot();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T08:00:00.000Z"));
    let call = 0;
    const randomSpy = vi.spyOn(Math, "random").mockImplementation(() => {
      call += 1;
      return call <= 4 ? 0 : 0.03; // 第一次 randomSuffix() 产出 "aaaa",第二次产出 "bbbb"
    });
    try {
      const collidingDir = join(root, "e", "2026-07-01T08-00-00-000Z-aaaa");
      await mkdir(collidingDir, { recursive: true });

      const writer = createResultsWriter(root, { producer: { name: "x" } });
      const snap = await writer.snapshot({ experimentId: "e", agent: "bub", startedAt: "2026-07-01T08:00:00.000Z" });
      expect(snap.dir).not.toBe(collidingDir);
      expect(snap.dir.endsWith("-bbbb")).toBe(true);
      expect(await exists(join(snap.dir, "snapshot.json"))).toBe(true);
      // 被占用的目录没有被写入 snapshot.json —— 独占创建不会覆盖已有内容。
      expect(await exists(join(collidingDir, "snapshot.json"))).toBe(false);
    } finally {
      randomSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("writeAttemptFor:按 EvalResult.experimentId 懒建快照;正常条目拆 artifact,携带条目原样保留 startedAt/artifactBase/has*", async () => {
    const root = await makeRoot();
    const writer = createResultsWriter(root, { producer: { name: "niceeval", version: "0.12.0" } });

    const fresh: EvalResult = {
      id: "algebra/q1",
      experimentId: "compare/bub",
      experiment: { id: "compare/bub", flags: { style: "concise" } },
      agent: "bub",
      model: "gpt-5.4",
      verdict: "passed",
      fingerprint: "abc",
      attempt: 1,
      startedAt: "2026-07-01T08:01:00.000Z",
      durationMs: 1234,
      assertions: [],
      usage: { inputTokens: 10, outputTokens: 5 },
      estimatedCostUSD: 0.5,
      events: [{ type: "message", role: "assistant", text: "hi" } as never],
      sources: [{ path: "evals/a.ts", content: "x" }],
      trace: [{ name: "turn", kind: "turn" } as never],
      o11y: { toolCalls: 2 } as never,
      diff: { generatedFiles: { "a.txt": "1" }, deletedFiles: [] },
      rawTranscript: "raw",
    };
    const carried: EvalResult = {
      id: "algebra/q3",
      experimentId: "compare/bub",
      agent: "bub",
      model: "gpt-5.4",
      verdict: "passed",
      attempt: 1,
      startedAt: "2026-06-30T08:01:00.000Z",
      durationMs: 99,
      assertions: [],
      artifactBase: "compare_bub/2026-06-30T08-00-00-000Z-xxxx/algebra/q3/a1",
      hasEvents: true,
      hasTrace: false,
      hasSources: true,
    };

    await writer.writeAttemptFor(fresh);
    await writer.writeAttemptFor(carried);
    await writer.finish();

    const dirs = writer.snapshotDirs();
    expect(dirs).toHaveLength(1);
    const snapDir = dirs[0].dir;

    const freshRecord = JSON.parse(await readFile(join(snapDir, "algebra/q1/a1/result.json"), "utf-8"));
    for (const key of ["agent", "model", "experimentId", "experiment", "events", "sources", "o11y", "trace", "diff", "rawTranscript"]) {
      expect(freshRecord).not.toHaveProperty(key);
    }
    // startedAt 是 attempt 级事实(每条各异,view 靠它显示「何时跑的」),正常条目也原样落盘。
    expect(freshRecord.startedAt).toBe("2026-07-01T08:01:00.000Z");
    expect(freshRecord.hasEvents).toBe(true);
    expect(freshRecord.hasTrace).toBe(true);
    expect(freshRecord.hasSources).toBe(true);
    expect(await readFile(join(snapDir, "algebra/q1/a1/events.json"), "utf-8")).toBe('[{"type":"message","role":"assistant","text":"hi"}]');
    expect(await readFile(join(snapDir, "algebra/q1/a1/o11y.json"), "utf-8")).toBe('{"toolCalls":2}');

    const carriedRecord = JSON.parse(await readFile(join(snapDir, "algebra/q3/a1/result.json"), "utf-8"));
    expect(carriedRecord.startedAt).toBe("2026-06-30T08:01:00.000Z");
    expect(carriedRecord.artifactBase).toBe("compare_bub/2026-06-30T08-00-00-000Z-xxxx/algebra/q3/a1");
    expect(carriedRecord.hasEvents).toBe(true);
    expect(carriedRecord.hasTrace).toBe(false);
    expect(carriedRecord.hasSources).toBe(true);
    expect(carriedRecord).not.toHaveProperty("agent");
    expect(carriedRecord).not.toHaveProperty("experimentId");
    expect(await exists(join(snapDir, "algebra/q3/a1/events.json"))).toBe(false); // 携带条目不写 artifact 文件

    const meta = JSON.parse(await readFile(join(snapDir, "snapshot.json"), "utf-8"));
    expect(meta.experimentId).toBe("compare/bub");
    expect(meta.agent).toBe("bub");
    expect(meta.model).toBe("gpt-5.4");
  });

  it("writeAttemptFor:result.experimentId 缺失时抛可执行错误(v4 布局按实验分目录)", async () => {
    const root = await makeRoot();
    const writer = createResultsWriter(root, { producer: { name: "x" } });
    await expect(
      writer.writeAttemptFor({ id: "q1", agent: "bub", verdict: "passed", attempt: 1, durationMs: 1, assertions: [] }),
    ).rejects.toThrow(/experimentId/);
  });
});

// ───────────────────────── copySnapshots ─────────────────────────

describe("copySnapshots", () => {
  it("产物是标准结果根目录(快照目录名原样保留);按指定 artifact 复制;补记 knownEvalIds;has* 按目标目录重算", async () => {
    const root = await makeRoot();
    const monday = await writeSnapshot(
      root,
      "compare_bub",
      "2026-07-01T08-00-00-000Z-mon1",
      meta({ experimentId: "compare/bub", agent: "bub", model: "gpt-5", startedAt: "2026-07-01T08:00:00.000Z", completedAt: "2026-07-01T08:10:00.000Z" }),
    );
    await writeResultFile(monday, "q1/a1", record({ id: "q1", attempt: 1, hasEvents: true, hasTrace: true }));
    await writeArtifactFile(monday, "q1/a1", "events.json", [{ n: 1 }]);
    await writeArtifactFile(monday, "q1/a1", "trace.json", [{ name: "turn" }]);
    await writeArtifactFile(monday, "q1/a1", "diff.json", { generatedFiles: {}, deletedFiles: [] });
    await writeResultFile(monday, "q2/a1", record({ id: "q2", attempt: 1 }));

    // 周五只重跑了 q1:最新快照残缺。
    const friday = await writeSnapshot(
      root,
      "compare_bub",
      "2026-07-05T08-00-00-000Z-fri1",
      meta({ experimentId: "compare/bub", agent: "bub", model: "gpt-5", startedAt: "2026-07-05T08:00:00.000Z", completedAt: "2026-07-05T08:10:00.000Z" }),
    );
    await writeResultFile(friday, "q1/a1", record({ id: "q1", attempt: 1, hasEvents: true }));
    await writeArtifactFile(friday, "q1/a1", "events.json", [{ n: 1 }, { n: 2 }]);

    const results = await openResults(root);
    const dest = join(await makeRoot(), "site/data/run");
    const copied = await copySnapshots(results.latest(), dest, { artifacts: ["events"] });

    expect(copied.warnings).toHaveLength(0);
    expect(copied.dir).toBe(dest);

    const destSnapDir = join(dest, "compare_bub", "2026-07-05T08-00-00-000Z-fri1"); // 快照目录名原样保留
    expect(await exists(join(destSnapDir, "snapshot.json"))).toBe(true);
    expect(await exists(join(destSnapDir, "q1/a1/events.json"))).toBe(true);
    expect(await exists(join(destSnapDir, "q1/a1/trace.json"))).toBe(false); // 未选中的 artifact 种类不复制

    const destMeta = JSON.parse(await readFile(join(destSnapDir, "snapshot.json"), "utf-8"));
    expect(destMeta.knownEvalIds).toEqual(["q1", "q2"]); // 补记:复制时刻该实验已知的 eval 并集
    expect(destMeta.completedAt).toBe("2026-07-05T08:10:00.000Z");
    expect(destMeta.producer).toEqual({ name: "niceeval", version: "0.3.0" });

    const destRecord = JSON.parse(await readFile(join(destSnapDir, "q1/a1/result.json"), "utf-8"));
    expect(destRecord.hasEvents).toBe(true);
    expect(destRecord.hasTrace).toBe(false); // 没选中 trace,目标按实际复制重算(不沿用源的 true)
    expect(destRecord).not.toHaveProperty("artifactBase");
    expect(destRecord).not.toHaveProperty("agent"); // 快照级字段不重复

    // 发布目录上重新 openResults().latest():残缺警告被同一套机制重新算出来,不靠发布者转述。
    const republished = await openResults(dest);
    expect(republished.experiments[0].evalIds).toEqual(["q1", "q2"]);
    const partial = republished.latest().warnings.find((w) => w.kind === "partial-coverage")!;
    expect(partial).toMatchObject({ experimentId: "compare/bub", covered: 1, total: 2 });
  });

  it("目标目录非空即报错;artifacts 非法值报错;无快照报错;同实验多快照选中 → 取最新 + warning", async () => {
    const root = await makeRoot();
    await writeSnapshot(root, "e", "2026-07-01T08-00-00-000Z-a", meta({ experimentId: "e", agent: "bub", startedAt: "2026-07-01T08:00:00.000Z", completedAt: "2026-07-01T08:10:00.000Z" }));
    const tuesday = await writeSnapshot(root, "e", "2026-07-02T08-00-00-000Z-b", meta({ experimentId: "e", agent: "bub", startedAt: "2026-07-02T08:00:00.000Z", completedAt: "2026-07-02T08:10:00.000Z" }));
    await writeResultFile(tuesday, "q1/a1", record({ id: "q1", attempt: 1 }));

    const results = await openResults(root);

    const occupied = await makeRoot();
    await writeFile(join(occupied, "existing.txt"), "x", "utf-8");
    await expect(copySnapshots(results.latest(), occupied)).rejects.toThrow(/not empty/);

    await expect(copySnapshots(results.latest(), join(await makeRoot(), "out"), { artifacts: ["evnets" as never] })).rejects.toThrow(/Unknown artifact kind/);

    await expect(copySnapshots([], join(await makeRoot(), "out"))).rejects.toThrow(/no snapshots/);

    // 手工传入同一 experiment 的两个快照(未走 latest 去重):只带最新,记 warning。
    const dest2 = join(await makeRoot(), "run2");
    const collided = await copySnapshots(results.experiments[0].snapshots, dest2);
    expect(collided.warnings).toHaveLength(1);
    expect(collided.warnings[0]).toMatch(/multiple snapshots selected/);
    const destDirs = await readdir(join(dest2, "e"));
    expect(destDirs).toEqual([basename(tuesday)]);
  });
});

// ───────────────────────── AttemptLocator 集成 ─────────────────────────

describe("AttemptLocator · 落盘 / 读取 / 携带 / 撞车", () => {
  it("非携带条目由 writer 按身份算出 locator 并落盘;确定性(同身份重开两次相同);resolveLocator 能找到", async () => {
    const root = await makeRoot();
    const writer = createResultsWriter(root, { producer: { name: "niceeval", version: "1.0.0" } });
    const snap = await writer.snapshot({ experimentId: "e", agent: "bub", startedAt: "2026-07-01T08:00:00.000Z" });
    await snap.writeAttempt({ id: "q1", verdict: "passed", attempt: 0, durationMs: 1, assertions: [] });
    await snap.writeAttempt({ id: "q2", verdict: "passed", attempt: 0, durationMs: 1, assertions: [] });
    await writer.finish();

    const record1 = JSON.parse(await readFile(join(snap.dir, "q1/a0/result.json"), "utf-8"));
    expect(record1.locator).toMatch(/^@1[0-9a-z]{7}$/);
    expect(record1.locator).toBe(
      encodeAttemptLocator({ experimentId: "e", snapshotStartedAt: "2026-07-01T08:00:00.000Z", evalId: "q1", attempt: 0 }),
    );

    const record2 = JSON.parse(await readFile(join(snap.dir, "q2/a0/result.json"), "utf-8"));
    expect(record2.locator).not.toBe(record1.locator); // 不同 evalId → 不同 locator

    const resultsA = await openResults(root);
    const resultsB = await openResults(root); // 独立重开一次:身份不变,locator 必须一致
    const q1a = resultsA.experiments[0].latest.evals.find((e) => e.id === "q1")!.attempts[0];
    const q1b = resultsB.experiments[0].latest.evals.find((e) => e.id === "q1")!.attempts[0];
    expect(q1a.locator).toBe(record1.locator);
    expect(q1b.locator).toBe(record1.locator);

    expect(resolveLocator(resultsA, record1.locator).evalId).toBe("q1");
  });

  it("携带条目(--resume 合入)原样复制原 locator,不按新快照的 startedAt 重算", async () => {
    const root = await makeRoot();
    const writer1 = createResultsWriter(root, { producer: { name: "niceeval", version: "1.0.0" } });
    await writer1.writeAttemptFor({
      id: "q1",
      experimentId: "e",
      agent: "bub",
      verdict: "passed",
      attempt: 0,
      startedAt: "2026-07-01T08:00:00.000Z",
      durationMs: 1,
      assertions: [],
    });
    await writer1.finish();

    const opened1 = await openResults(root);
    const original = opened1.experiments[0].latest.evals.find((e) => e.id === "q1")!.attempts[0];
    const originalLocator = original.locator!;

    // 第二轮:carry 合入 q1(artifactBase 指回第一轮的快照),locator 从上一轮读回的记录里原样带过来。
    // q2(真正新跑的)先写:snapshot() 的 startedAt 由「该实验首条落盘结果的 attempt 时刻」锚定
    // (writer.ts 的注释),让第二轮快照的真实 startedAt("07-02")明确不同于原快照("07-01")——
    // 这样如果 locator 被错误地按「当前快照」重算,会得到一个可判别的不同字符串。
    const writer2 = createResultsWriter(root, { producer: { name: "niceeval", version: "1.0.0" } });
    await writer2.writeAttemptFor({
      id: "q2",
      experimentId: "e",
      agent: "bub",
      verdict: "passed",
      attempt: 0,
      startedAt: "2026-07-02T08:00:00.000Z",
      durationMs: 1,
      assertions: [],
    });
    const carried: EvalResult = {
      ...original.result,
      experimentId: "e",
      agent: "bub",
      artifactBase: `${original.ref.snapshot}/${original.ref.attempt}`,
    };
    await writer2.writeAttemptFor(carried);
    await writer2.finish();

    const opened2 = await openResults(root);
    const newest = opened2.experiments[0].latest;
    const carriedAttempt = newest.evals.find((e) => e.id === "q1")!.attempts[0];
    expect(carriedAttempt.locator).toBe(originalLocator);
    expect(resolveLocator(opened2, originalLocator).evalId).toBe("q1");

    // 反证:如果按「新快照的 startedAt」重算,会得到一个不同的字符串——证明确实是原样复制,不是重算。
    const wronglyRecomputed = encodeAttemptLocator({
      experimentId: "e",
      snapshotStartedAt: newest.startedAt,
      evalId: "q1",
      attempt: 0,
    });
    expect(originalLocator).not.toBe(wronglyRecomputed);
  });

  it("resolveLocator:malformed 与 not-found 是两种可判别的错误", async () => {
    const root = await makeRoot();
    await writeSnapshot(root, "e", "2026-07-01T08-00-00-000Z-a", meta({ experimentId: "e", agent: "bub", startedAt: "2026-07-01T08:00:00.000Z" }));
    const results = await openResults(root);

    expect(() => resolveLocator(results, "not-a-locator")).toThrow(MalformedLocatorError);
    expect(() => resolveLocator(results, "@1nosuch1")).toThrow(LocatorNotFoundError); // 语法合法(7 位 body),索引里没有
  });

  it("两个不同身份的 attempt 撞出同一个 locator 字符串:openResults() 抛 LocatorCollisionError,不静默覆盖", async () => {
    const root = await makeRoot();
    const writer = createResultsWriter(root, { producer: { name: "niceeval", version: "1.0.0" } });
    const snap = await writer.snapshot({ experimentId: "e", agent: "bub", startedAt: "2026-07-01T08:00:00.000Z" });
    await snap.writeAttempt({ id: "q1", verdict: "passed", attempt: 0, durationMs: 1, assertions: [] });
    await snap.writeAttempt({ id: "q2", verdict: "passed", attempt: 0, durationMs: 1, assertions: [] });
    await writer.finish();

    // 人为制造撞车:把 q2 的 locator 改成和 q1 一样(真实哈希撞车不可复现,这里直接模拟其效果——
    // 索引建立逻辑只关心「同一 locator 字符串映射到身份三元组不同的两个 attempt」)。
    const q1Path = join(snap.dir, "q1/a0/result.json");
    const q2Path = join(snap.dir, "q2/a0/result.json");
    const q1Record = JSON.parse(await readFile(q1Path, "utf-8"));
    const q2Record = JSON.parse(await readFile(q2Path, "utf-8"));
    q2Record.locator = q1Record.locator;
    await writeFile(q2Path, JSON.stringify(q2Record), "utf-8");

    await expect(openResults(root)).rejects.toThrow(LocatorCollisionError);
  });

  it("多 experiment:同 evalId/attempt 在不同 experiment 下产出不同 locator,resolveLocator 精确定位到各自的 experiment", async () => {
    const root = await makeRoot();
    const writer = createResultsWriter(root, { producer: { name: "niceeval", version: "1.0.0" } });
    const snapA = await writer.snapshot({ experimentId: "compare/bub", agent: "bub", startedAt: "2026-07-01T08:00:00.000Z" });
    const snapB = await writer.snapshot({ experimentId: "compare/codex", agent: "codex", startedAt: "2026-07-01T08:00:00.000Z" });
    await snapA.writeAttempt({ id: "algebra/q1", verdict: "passed", attempt: 0, durationMs: 1, assertions: [] });
    await snapB.writeAttempt({ id: "algebra/q1", verdict: "passed", attempt: 0, durationMs: 1, assertions: [] });
    await writer.finish();

    const results = await openResults(root);
    const a = results.experiments.find((e) => e.id === "compare/bub")!.latest.evals[0]!.attempts[0]!;
    const b = results.experiments.find((e) => e.id === "compare/codex")!.latest.evals[0]!.attempts[0]!;
    // 同 evalId、同 attempt 序号,只有 experimentId 不同 → locator 必须不同(身份元组含 experimentId)。
    expect(a.locator).not.toBe(b.locator);

    expect(resolveLocator(results, a.locator!).experimentId).toBe("compare/bub");
    expect(resolveLocator(results, b.locator!).experimentId).toBe("compare/codex");
  });

  it("同一 evalId 的不同 attempt 序号产出不同 locator,resolveLocator 各自精确定位到对应 attempt", async () => {
    const root = await makeRoot();
    const writer = createResultsWriter(root, { producer: { name: "niceeval", version: "1.0.0" } });
    const snap = await writer.snapshot({ experimentId: "e", agent: "bub", startedAt: "2026-07-01T08:00:00.000Z" });
    await snap.writeAttempt({ id: "q1", verdict: "failed", attempt: 0, durationMs: 1, assertions: [] });
    await snap.writeAttempt({ id: "q1", verdict: "passed", attempt: 1, durationMs: 1, assertions: [] });
    await writer.finish();

    const results = await openResults(root);
    const attempts = results.experiments[0]!.latest.evals.find((e) => e.id === "q1")!.attempts;
    expect(attempts).toHaveLength(2);
    const [a0, a1] = attempts;
    expect(a0!.locator).not.toBe(a1!.locator);
    expect(resolveLocator(results, a0!.locator!).result).toMatchObject({ attempt: 0, verdict: "failed" });
    expect(resolveLocator(results, a1!.locator!).result).toMatchObject({ attempt: 1, verdict: "passed" });
  });

  it("历史快照(非 latest)的 attempt 依然被建进索引,resolveLocator 能定位到旧快照里的那份", async () => {
    const root = await makeRoot();
    const writer1 = createResultsWriter(root, { producer: { name: "niceeval", version: "1.0.0" } });
    const monday = await writer1.snapshot({ experimentId: "e", agent: "bub", startedAt: "2026-07-01T08:00:00.000Z" });
    await monday.writeAttempt({ id: "q1", verdict: "failed", attempt: 0, durationMs: 1, assertions: [] });
    await writer1.finish();

    const writer2 = createResultsWriter(root, { producer: { name: "niceeval", version: "1.0.0" } });
    const friday = await writer2.snapshot({ experimentId: "e", agent: "bub", startedAt: "2026-07-05T08:00:00.000Z" });
    await friday.writeAttempt({ id: "q1", verdict: "passed", attempt: 0, durationMs: 1, assertions: [] });
    await writer2.finish();

    const results = await openResults(root);
    const exp = results.experiments[0]!;
    expect(exp.snapshots).toHaveLength(2); // 两次快照都在(忠实磁盘,不合并/不丢弃历史)
    const oldAttempt = exp.snapshots.find((s) => s.startedAt === "2026-07-01T08:00:00.000Z")!.attempts[0]!;
    const newAttempt = exp.snapshots.find((s) => s.startedAt === "2026-07-05T08:00:00.000Z")!.attempts[0]!;
    expect(oldAttempt.locator).not.toBe(newAttempt.locator); // 不同 startedAt → 不同身份 → 不同 locator

    expect(resolveLocator(results, oldAttempt.locator!).result.verdict).toBe("failed");
    expect(resolveLocator(results, newAttempt.locator!).result.verdict).toBe("passed");
  });

  it("手工构造的 Results(未经 openResults())上调 resolveLocator:索引查不到,统一按 not-found 处理,不抛意外错误", () => {
    const snapshot = fakeSnapshot({ experimentId: "e", startedAt: "2026-07-01T08:00:00.000Z", dir: "/tmp/e/s1" });
    const attempt = fakeAttempt(snapshot, record({ id: "q1", attempt: 0 }));
    snapshot.attempts = [attempt];
    snapshot.evals = [{ id: "q1", attempts: [attempt] }];
    const handMadeResults: Results = {
      experiments: [{ id: "e", snapshots: [snapshot], latest: snapshot, evalIds: ["q1"] }],
      skipped: [],
      // filter() 本测试不调用,用不到,给个占位实现即可满足 Selection 接口。
      latest: () => ({ snapshots: [snapshot], warnings: [], filter: () => { throw new Error("not implemented"); } }),
    };
    // 这份 locator 语法合法、甚至真的对应 handMadeResults 里那个 attempt 的身份,
    // 但 handMadeResults 没经过 openResults(),locatorIndexByResults 里查不到它 —— 空索引,not-found。
    const syntacticallyValidLocator = encodeAttemptLocator({
      experimentId: "e",
      snapshotStartedAt: "2026-07-01T08:00:00.000Z",
      evalId: "q1",
      attempt: 0,
    });
    expect(() => resolveLocator(handMadeResults, syntacticallyValidLocator)).toThrow(LocatorNotFoundError);
  });

  it("copySnapshots:普通(非 sources)attempt 的 locator 原样复制,目标结果根上 resolveLocator 依然命中", async () => {
    const root = await makeRoot();
    const writer = createResultsWriter(root, { producer: { name: "niceeval", version: "1.0.0" } });
    const snap = await writer.snapshot({ experimentId: "e", agent: "bub", startedAt: "2026-07-01T08:00:00.000Z" });
    await snap.writeAttempt({ id: "q1", verdict: "passed", attempt: 0, durationMs: 1, assertions: [] });
    await snap.writeAttempt({ id: "q1", verdict: "failed", attempt: 1, durationMs: 1, assertions: [] });
    await writer.finish();

    const results = await openResults(root);
    const [a0, a1] = results.experiments[0]!.latest.evals[0]!.attempts;
    const locator0 = a0!.locator!;
    const locator1 = a1!.locator!;

    const dest = join(await makeRoot(), "published");
    await copySnapshots(results.latest(), dest, { artifacts: [] });

    const destResults = await openResults(dest);
    expect(resolveLocator(destResults, locator0).result.attempt).toBe(0);
    expect(resolveLocator(destResults, locator1).result.attempt).toBe(1);
  });
});

// ───────────────────────── sources 去重仓库 ─────────────────────────

describe("sources · 快照级去重仓库", () => {
  it("两个 attempt 共享字节相同的 eval 源码:去重仓库只落一份 blob(文件数 = 1)", async () => {
    const root = await makeRoot();
    const writer = createResultsWriter(root, { producer: { name: "niceeval", version: "1.0.0" } });
    const snap = await writer.snapshot({ experimentId: "e", agent: "bub", startedAt: "2026-07-01T08:00:00.000Z" });
    const content = "export default { test() {} };\n";
    await snap.writeAttempt({ id: "q1", verdict: "passed", attempt: 0, durationMs: 1, assertions: [] }, { sources: [{ path: "evals/shared.eval.ts", content }] });
    await snap.writeAttempt({ id: "q2", verdict: "passed", attempt: 0, durationMs: 1, assertions: [] }, { sources: [{ path: "evals/shared.eval.ts", content }] });
    await writer.finish();

    const storeFiles = await readdir(join(snap.dir, "sources"));
    expect(storeFiles).toHaveLength(1);
  });

  it("两个 attempt 的 eval 源码内容不同:各自落一份 blob(文件数 = 2)", async () => {
    const root = await makeRoot();
    const writer = createResultsWriter(root, { producer: { name: "niceeval", version: "1.0.0" } });
    const snap = await writer.snapshot({ experimentId: "e", agent: "bub", startedAt: "2026-07-01T08:00:00.000Z" });
    await snap.writeAttempt(
      { id: "q1", verdict: "passed", attempt: 0, durationMs: 1, assertions: [] },
      { sources: [{ path: "evals/a.eval.ts", content: "export default { test() {} };\n" }] },
    );
    await snap.writeAttempt(
      { id: "q2", verdict: "passed", attempt: 0, durationMs: 1, assertions: [] },
      { sources: [{ path: "evals/b.eval.ts", content: "export default { test() { /* different */ } };\n" }] },
    );
    await writer.finish();

    const storeFiles = await readdir(join(snap.dir, "sources"));
    expect(storeFiles).toHaveLength(2);
  });

  it("经真实 --resume carry 流程(writeAttemptFor 的 artifactBase 分支)携带的 attempt,其 sources() 引用在新快照里依然能解到原快照内容", async () => {
    const root = await makeRoot();
    const content = "export default { test() {} };\n";
    const writer1 = createResultsWriter(root, { producer: { name: "niceeval", version: "1.0.0" } });
    await writer1.writeAttemptFor({
      id: "q1",
      experimentId: "e",
      agent: "bub",
      verdict: "passed",
      attempt: 0,
      startedAt: "2026-07-01T08:00:00.000Z",
      durationMs: 1,
      assertions: [],
      sources: [{ path: "evals/q1.eval.ts", content }],
    });
    await writer1.finish();

    const opened1 = await openResults(root);
    const original = opened1.experiments[0]!.latest.evals.find((e) => e.id === "q1")!.attempts[0]!;
    expect(await original.sources()).toEqual([{ path: "evals/q1.eval.ts", content }]);

    // 第二轮:q2 是真正新跑的(锚定新快照的 startedAt 明确晚于原快照),q1 是 carry 合入 ——
    // artifactBase 指回第一轮的快照,与 locator carry 测试同一套构造手法。
    const writer2 = createResultsWriter(root, { producer: { name: "niceeval", version: "1.0.0" } });
    await writer2.writeAttemptFor({
      id: "q2",
      experimentId: "e",
      agent: "bub",
      verdict: "passed",
      attempt: 0,
      startedAt: "2026-07-02T08:00:00.000Z",
      durationMs: 1,
      assertions: [],
    });
    const carried: EvalResult = {
      ...original.result,
      experimentId: "e",
      agent: "bub",
      artifactBase: `${original.ref.snapshot}/${original.ref.attempt}`,
    };
    await writer2.writeAttemptFor(carried);
    await writer2.finish();

    const opened2 = await openResults(root);
    const carriedAttempt = opened2.experiments[0]!.latest.evals.find((e) => e.id === "q1")!.attempts[0]!;
    // 新快照下没有为携带条目重新写 sources.json/blob(carry 分支不写 artifact),
    // sources() 必须靠 artifactBase 回退到原快照的去重仓库才能解出内容。
    expect(await carriedAttempt.sources()).toEqual([{ path: "evals/q1.eval.ts", content }]);
  });

  it("同一快照内相同内容只落一份 blob;不同内容各一份;attempt.sources() 各自读回正确内容", async () => {
    const root = await makeRoot();
    const writer = createResultsWriter(root, { producer: { name: "niceeval", version: "1.0.0" } });
    const snap = await writer.snapshot({ experimentId: "e", agent: "bub", startedAt: "2026-07-01T08:00:00.000Z" });
    const shared = [{ path: "evals/shared.eval.ts", content: "export default { test() {} };\n" }];
    const other = [{ path: "evals/other.eval.ts", content: "export default { test() { /* different */ } };\n" }];
    await snap.writeAttempt({ id: "q1", verdict: "passed", attempt: 0, durationMs: 1, assertions: [] }, { sources: shared });
    await snap.writeAttempt({ id: "q2", verdict: "passed", attempt: 0, durationMs: 1, assertions: [] }, { sources: shared });
    await snap.writeAttempt({ id: "q3", verdict: "passed", attempt: 0, durationMs: 1, assertions: [] }, { sources: other });
    await writer.finish();

    const storeFiles = await readdir(join(snap.dir, "sources"));
    expect(storeFiles).toHaveLength(2); // 三份引用,内容只两种 → 两个 blob

    // attempt 级 sources.json 只是引用(小,不含 content),不是全量内容。
    const q1Ref = JSON.parse(await readFile(join(snap.dir, "q1/a0/sources.json"), "utf-8"));
    expect(q1Ref).toEqual([{ path: "evals/shared.eval.ts", sha256: expect.any(String) }]);
    expect(JSON.stringify(q1Ref)).not.toContain("export default");

    const results = await openResults(root);
    const evalById = (id: string) => results.experiments[0].latest.evals.find((e) => e.id === id)!.attempts[0];
    await expect(evalById("q1").sources()).resolves.toEqual(shared);
    await expect(evalById("q2").sources()).resolves.toEqual(shared);
    await expect(evalById("q3").sources()).resolves.toEqual(other);
  });

  it("携带条目(artifactBase 回退)的 sources() 仍能解到原快照的去重仓库", async () => {
    const root = await makeRoot();
    const oldSnap = await writeSnapshot(
      root,
      "e",
      "2026-06-30T08-00-00-000Z-xxxx",
      meta({ experimentId: "e", agent: "bub", startedAt: "2026-06-30T08:00:00.000Z", completedAt: "2026-06-30T08:10:00.000Z" }),
    );
    await writeResultFile(oldSnap, "q1/a0", record({ id: "q1", attempt: 0, hasSources: true }));
    await mkdir(join(oldSnap, "sources"), { recursive: true });
    await writeFile(join(oldSnap, "sources", "abc123.json"), JSON.stringify({ content: "export default {};\n" }), "utf-8");
    await writeArtifactFile(oldSnap, "q1/a0", "sources.json", [{ path: "evals/q1.eval.ts", sha256: "abc123" }]);

    const newSnap = await writeSnapshot(
      root,
      "e",
      "2026-07-01T08-00-00-000Z-yyyy",
      meta({ experimentId: "e", agent: "bub", startedAt: "2026-07-01T08:00:00.000Z", completedAt: "2026-07-01T08:10:00.000Z" }),
    );
    await writeResultFile(
      newSnap,
      "q1/a0",
      record({ id: "q1", attempt: 0, startedAt: "2026-06-30T08:01:00.000Z", artifactBase: "e/2026-06-30T08-00-00-000Z-xxxx/q1/a0", hasSources: true }),
    );

    const results = await openResults(root);
    const carried = results.experiments[0].latest.evals.find((e) => e.id === "q1")!.attempts[0];
    expect(await carried.sources()).toEqual([{ path: "evals/q1.eval.ts", content: "export default {};\n" }]);
  });

  it("copySnapshots:sources 引用与去重仓库一起复制,内容按目的地重新去重(同一份不重复落盘)", async () => {
    const root = await makeRoot();
    const writer = createResultsWriter(root, { producer: { name: "niceeval", version: "1.0.0" } });
    const snap = await writer.snapshot({ experimentId: "e", agent: "bub", startedAt: "2026-07-01T08:00:00.000Z" });
    const shared = [{ path: "evals/shared.eval.ts", content: "export default { test() {} };\n" }];
    await snap.writeAttempt({ id: "q1", verdict: "passed", attempt: 0, durationMs: 1, assertions: [] }, { sources: shared });
    await snap.writeAttempt({ id: "q2", verdict: "passed", attempt: 0, durationMs: 1, assertions: [] }, { sources: shared });
    await writer.finish();

    const originalLocator = JSON.parse(await readFile(join(snap.dir, "q1/a0/result.json"), "utf-8")).locator;

    const results = await openResults(root);
    const dest = join(await makeRoot(), "published");
    await copySnapshots(results.latest(), dest, { artifacts: ["sources"] });

    const destSnapDir = join(dest, "e", basename(snap.dir));
    const destStoreFiles = await readdir(join(destSnapDir, "sources"));
    expect(destStoreFiles).toHaveLength(1); // 复制后在目的地重新按内容去重,仍只一份

    const destResults = await openResults(dest);
    const q1 = destResults.experiments[0].latest.evals.find((e) => e.id === "q1")!.attempts[0];
    expect(await q1.sources()).toEqual(shared);
    expect(q1.result.locator).toBe(originalLocator); // locator 随 result.json 原样复制,不重算
  });
});

// ───────────────────────── loadAnnotatedEvalSource(端到端打通) ─────────────────────────

describe("loadAnnotatedEvalSource · discovery 捕获 → 去重存储 → 检索 → 标注 打通链路", () => {
  it("给一个真实落盘的 attempt,取回 sources() 内容并按 loc 标注断言", async () => {
    const root = await makeRoot();
    const writer = createResultsWriter(root, { producer: { name: "niceeval", version: "1.0.0" } });
    const snap = await writer.snapshot({ experimentId: "e", agent: "bub", startedAt: "2026-07-01T08:00:00.000Z" });
    const content = "import { defineEval } from \"niceeval\";\nexport default defineEval({\n  test() {},\n});\n";
    const assertions = [
      { name: "check-1", passed: true, severity: "gate", score: 1, loc: { file: "evals/a.eval.ts", line: 3 } },
      { name: "no-loc", passed: false, severity: "soft", score: 0 },
    ] as unknown as EvalResult["assertions"];
    await snap.writeAttempt(
      { id: "q1", verdict: "passed", attempt: 0, durationMs: 1, assertions },
      { sources: [{ path: "evals/a.eval.ts", content }] },
    );
    await writer.finish();

    const results = await openResults(root);
    const attempt = results.experiments[0].latest.evals.find((e) => e.id === "q1")!.attempts[0];
    const annotated = await loadAnnotatedEvalSource(attempt);
    expect(annotated).not.toBeNull();
    expect(annotated!.sourcePath).toBe("evals/a.eval.ts");
    expect(annotated!.lines[2]!.assertions.map((a) => a.name)).toEqual(["check-1"]);
    expect(annotated!.unmapped.map((a) => a.name)).toEqual(["no-loc"]);
    expect(annotated!.summary).toMatchObject({ totalAssertions: 2, mappedAssertions: 1, unmappedAssertions: 1 });
  });

  it("没有 sources() 时返回 null,不伪造空文档", async () => {
    const root = await makeRoot();
    const writer = createResultsWriter(root, { producer: { name: "niceeval", version: "1.0.0" } });
    const snap = await writer.snapshot({ experimentId: "e", agent: "bub", startedAt: "2026-07-01T08:00:00.000Z" });
    await snap.writeAttempt({ id: "q1", verdict: "passed", attempt: 0, durationMs: 1, assertions: [] });
    await writer.finish();

    const results = await openResults(root);
    const attempt = results.experiments[0].latest.evals.find((e) => e.id === "q1")!.attempts[0];
    expect(await loadAnnotatedEvalSource(attempt)).toBeNull();
  });
});
