// cases: docs/engineering/testing/unit/record.md
// niceeval/record 的单测:临时目录里构造最小 run.json / result.json / artifact fixture,
// 覆盖定稿契约(docs/feature/record/library.md、docs/feature/record/architecture.md):分层读取(含快照级字段注入)、
// 懒加载与 artifactBase 回退、unreadable 三种原因、writer(独占目录、并发快照互不干扰、
// run.json 键形状、writeAttempt/writeAttemptFor、finish 幂等)、publish(布局、
// knownEvalIds 补记、artifacts 词干列表重算)。
// 读取面 fixture 的目录名/artifact 路径手写(不 import 库的路径函数),让测试独立于实现充当格式基准。
import { currentSample, latestRunSample } from "../sample/index.ts";

import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { parseRunManifests } from "./manifest.ts";
import {
  RECORD_FORMAT,
  RECORD_SCHEMA_VERSION,
  publish,
  createWriter as createRecordWriter,
  dedupeAttempts,
  openRecord,
  resolveLocator,
  LocatorNotFoundError,
  MalformedLocatorError,
  AmbiguousLocatorError,
  encodeAttemptLocator,
  type AttemptHandle,
  type AttemptArtifacts,
  type AttemptEntry,
  type EvalResult,
  type RunDeclaration,
  type RunWriter,
  type Writer,
  type Record,
  type Run,
  type RunMeta,
} from "./index.ts";
import { completeEvidenceCoverage } from "../assertions/coverage.ts";

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

/** 测试便利:封口一个 writer 已声明的全部 Run(finish() 现在是 RunWriter 的方法,
 *  每个 Run 各自只能封一次;多数测试不关心逐个 Run 分别封口,只要「全部封完」)。 */
type FixtureAttemptEntry = Omit<AttemptEntry, "evidenceCoverage"> & {
  evidenceCoverage?: AttemptEntry["evidenceCoverage"];
};
type FixtureEvalResult = Omit<EvalResult, "evidenceCoverage"> & {
  evidenceCoverage?: EvalResult["evidenceCoverage"];
};
type FixtureRunWriter = Omit<RunWriter, "writeAttempt"> & {
  writeAttempt(entry: FixtureAttemptEntry, artifacts?: AttemptArtifacts): Promise<void>;
};
type FixtureWriter = Omit<Writer, "run" | "writeAttemptFor" | "snapshotWriters"> & {
  run(decl: RunDeclaration): Promise<FixtureRunWriter>;
  writeAttemptFor(result: FixtureEvalResult): Promise<void>;
  snapshotWriters(): Promise<{ experimentId: string; writer: FixtureRunWriter }[]>;
};

const fixtureRunWriterByWriter = new WeakMap<RunWriter, FixtureRunWriter>();

function fixtureRunWriter(writer: RunWriter): FixtureRunWriter {
  const existing = fixtureRunWriterByWriter.get(writer);
  if (existing !== undefined) return existing;
  const fixture: FixtureRunWriter = {
    ...writer,
    writeAttempt(entry, artifacts) {
      return writer.writeAttempt({ ...entry, evidenceCoverage: entry.evidenceCoverage ?? completeEvidenceCoverage }, artifacts);
    },
  };
  fixtureRunWriterByWriter.set(writer, fixture);
  return fixture;
}

/** 测试 fixture 也经真实 writer 走一遍，默认声明完整证据覆盖，避免旧格式对象绕过 v14 校验。 */
function createWriter(...args: Parameters<typeof createRecordWriter>): FixtureWriter {
  const writer = createRecordWriter(...args);
  return {
    ...writer,
    run: async (decl) => fixtureRunWriter(await writer.run(decl)),
    writeAttemptFor: (result) => writer.writeAttemptFor({ ...result, evidenceCoverage: result.evidenceCoverage ?? completeEvidenceCoverage }),
    snapshotWriters: async () =>
      (await writer.snapshotWriters()).map(({ experimentId, writer: run }) => ({ experimentId, writer: fixtureRunWriter(run) })),
  };
}

async function finishAll(writer: Pick<FixtureWriter, "snapshotWriters">): Promise<void> {
  const runs = await writer.snapshotWriters();
  await Promise.all(runs.map(({ writer: snap }) => snap.finish()));
}

function meta(over: { experimentId: string; agent: string; startedAt: string } & Partial<RunMeta>): RunMeta {
  return {
    format: RECORD_FORMAT,
    schemaVersion: RECORD_SCHEMA_VERSION,
    producer: { name: "niceeval", version: "0.3.0" },
    ...over,
    runId: over.runId ?? "00000000-0000-4000-8000-000000000000",
  };
}

function record(over: { id: string; attempt: number } & globalThis.Record<string, unknown>): EvalResult {
  return { verdict: "passed", durationMs: 1000, assertions: [], evidenceCoverage: completeEvidenceCoverage, ...over } as unknown as EvalResult;
}

async function writeSnapshot(root: string, expDir: string, snapDirName: string, m: RunMeta): Promise<string> {
  const dir = join(root, expDir, snapDirName);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "run.json"), JSON.stringify(m, null, 2), "utf-8");
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

describe("openRecord · 实验 → 快照 → eval → attempt 分层", () => {
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

    const results = await openRecord(root);
    expect(results.unreadable).toHaveLength(0);
    expect(results.experiments.map((e) => e.id)).toEqual(["compare/bub", "compare/codex"]); // 字典序

    const bub = results.experiments[0];
    expect(bub.runs).toHaveLength(1);
    expect(bub.latestRun).toBe(bub.runs[0]);
    expect(bub.knownEvalIds).toEqual(["algebra/q1", "algebra/q2"]);

    const snap = bub.latestRun;
    expect(snap.agent).toBe("bub");
    expect(snap.model).toBe("gpt-5");
    expect(snap.producer).toEqual({ name: "niceeval", version: "0.3.0" });
    expect(snap.schemaVersion).toBe(RECORD_SCHEMA_VERSION);
    expect(snap.dir).toBe(bubDir);
    expect(snap.completedAt).toBe("2026-07-01T08:10:00.000Z");
    expect(snap.evals.map((e) => e.id)).toEqual(["algebra/q1", "algebra/q2"]);
    expect(snap.evals[0].attempts).toHaveLength(2);
    expect(snap.attempts).toHaveLength(3);

    const attempt = snap.evals[0].attempts[0];
    expect(attempt.evalId).toBe("algebra/q1");
    expect(attempt.experimentId).toBe("compare/bub");
    expect(attempt.ref).toEqual({ run: "compare_bub/2026-07-01T08-00-00-000Z-a1b2", attempt: "algebra/q1/a1" });
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

describe("record · migratedFrom", () => {
  it("读写保留旧 opaque carryEpoch 的迁移来源", async () => {
    const root = await makeRoot();
    const writer = createWriter(root, { producer: { name: "niceeval", version: "test" } });
    const snapshot = await writer.run({
      experimentId: "exp",
      agent: "agent",
      startedAt: "2026-08-03T00:00:00.000Z",
    });
    await snapshot.writeAttempt({
      id: "e",
      verdict: "passed",
      attempt: 0,
      durationMs: 1,
      assertions: [],
      evidenceCoverage: completeEvidenceCoverage,
      fingerprint: "current-deterministic-fingerprint",
      migratedFrom: {
        kind: "opaque-carry-epoch",
        fingerprint: "legacy-opaque-fingerprint",
        algorithmVersion: 0,
        coverageVersion: 0,
      },
    });
    await snapshot.finish();

    const opened = await openRecord(root);
    expect(opened.experiments[0]!.latestRun.attempts[0]!.result.migratedFrom).toEqual({
      kind: "opaque-carry-epoch",
      fingerprint: "legacy-opaque-fingerprint",
      algorithmVersion: 0,
      coverageVersion: 0,
    });
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
    await writeResultFile(oldSnap, "q3/a1", record({ id: "q3", attempt: 1, artifacts: ["events"] }));
    await writeArtifactFile(oldSnap, "q3/a1", "events.json", [{ type: "message", text: "old" }]);

    const newSnap = await writeSnapshot(
      root,
      "e",
      "2026-07-01T08-00-00-000Z-yyyy",
      meta({ experimentId: "e", agent: "bub", startedAt: "2026-07-01T08:00:00.000Z", completedAt: "2026-07-01T08:10:00.000Z" }),
    );
    await writeResultFile(newSnap, "q1/a1", record({ id: "q1", attempt: 1, artifacts: ["events"] }));
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
        artifacts: ["events"],
      }),
    );

    const results = await openRecord(root);
    const snap = results.experiments[0].latestRun;
    const q1 = snap.evals.find((e) => e.id === "q1")!.attempts[0];
    const q2 = snap.evals.find((e) => e.id === "q2")!.attempts[0];
    const q3 = snap.evals.find((e) => e.id === "q3")!.attempts[0];

    const events = await q1.events();
    expect(events).toEqual([{ type: "message", text: "hi" }]);
    // artifacts 只是「不 stat 磁盘就知道有什么」的声明;懒加载(缺失返回 null)独立成立、不依赖它——
    // 这里没声明 commands/trace/o11y/diff/sources,对应文件也确实没写,五个方法照常读出 null。
    expect(await q1.commands()).toBeNull();
    expect(await q1.trace()).toBeNull();
    expect(await q1.o11y()).toBeNull();
    expect(await q1.diff()).toBeNull();
    expect(await q1.sources()).toBeNull();

    await rm(eventsPath);
    expect(await q1.events()).toBe(events); // 记忆化:同一 handle 不重新读盘

    expect(await q2.events()).toBeNull(); // 无 artifactBase,不猜路径

    expect(await q3.events()).toEqual([{ type: "message", text: "old" }]); // artifactBase 回退到原快照
    expect(q3.ref.run).toBe("e/2026-07-01T08-00-00-000Z-yyyy"); // ref 指条目所在的落盘(新快照)

    await rm(oldSnap, { recursive: true });
    const reopened = await openRecord(root);
    const q3Again = reopened.experiments[0].latestRun.evals.find((e) => e.id === "q3")!.attempts[0];
    expect(await q3Again.events()).toBeNull(); // 原快照清理后如实返回 null(新句柄,不吃上面的记忆化)
  });
});

// ───────────────────────── unreadable 三种原因 ─────────────────────────

describe("openRecord · unreadable", () => {
  it("incompatible(v3 summary.json / 无信封 legacy)、malformed(坏 JSON)、incomplete(有 attempt 无 run.json);无关 JSON 静默", async () => {
    const root = await makeRoot();

    // v2/v3 的 summary.json 带 format + schemaVersion(≠ 4),自然落进 incompatible 档。
    const v3Dir = join(root, "old-exp", "2026-06-01T08-00-00-000Z");
    await mkdir(v3Dir, { recursive: true });
    await writeFile(
      join(v3Dir, "summary.json"),
      JSON.stringify({
        format: RECORD_FORMAT,
        schemaVersion: 3,
        producer: { name: "niceeval", version: "0.4.6" },
        agent: "bub",
        startedAt: "2026-06-01T08:00:00.000Z",
        completedAt: "2026-06-01T08:10:00.000Z",
        passed: 1,
        failed: 0,
        unreadable: 0,
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
    await writeFile(join(badDir, "run.json"), "not json {", "utf-8");

    // incomplete:有 result.json,没有 run.json —— crash 没收尾。
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

    const results = await openRecord(root);
    expect(results.experiments.map((e) => e.id)).toEqual(["ok"]);
    expect(results.unreadable).toHaveLength(4);

    const v3Skip = results.unreadable.find((s) => s.dir === v3Dir)!;
    expect(v3Skip.reason).toBe("incompatible");
    expect(v3Skip.schemaVersion).toBe(3);
    expect(v3Skip.producer).toEqual({ name: "niceeval", version: "0.4.6" });

    const legacySkip = results.unreadable.find((s) => s.dir === legacyDir)!;
    expect(legacySkip.reason).toBe("incompatible");
    expect(legacySkip.schemaVersion).toBe(1);

    expect(results.unreadable.find((s) => s.dir === badDir)!.reason).toBe("malformed");
    expect(results.unreadable.find((s) => s.dir === crashDir)!.reason).toBe("incomplete");
    expect(results.unreadable.find((s) => s.dir === alienDir)).toBeUndefined();
  });
});

function fakeSnapshot(over: { experimentId: string; startedAt: string; dir: string }): Run {
  return {
    runId: "00000000-0000-4000-8000-000000000000",
    agent: "bub",
    producer: { name: "niceeval" },
    schemaVersion: RECORD_SCHEMA_VERSION,
    evals: [],
    attempts: [],
    ...over,
  };
}

function fakeAttempt(run: Run, result: EvalResult): AttemptHandle {
  return {
    evalId: result.id,
    experimentId: run.experimentId,
    result,
    ref: { run: "x/y", attempt: `${result.id}/a${result.attempt}` },
    run,
    carried: Boolean(result.artifactBase),
    evidenceState: "local",
    commands: async () => null,
    events: async () => null,
    trace: async () => null,
    o11y: async () => null,
    agentSetup: async () => null,
    diff: async () => null,
    sources: async () => null,
  };
}

// ───────────────────────── writer ─────────────────────────

describe("createWriter", () => {
  it("run() 建目录(独占)+ 写 run.json(无 completedAt);writeAttempt 拆 artifact + 回填 artifacts 词干列表;finish 补 completedAt 并幂等", async () => {
    const root = await makeRoot();
    const writer = createWriter(root, { producer: { name: "my-harness", version: "1.0.0" } });

    const snapA = await writer.run({
      experimentId: "compare/a",
      agent: "bub",
      model: "gpt-5",
      startedAt: "2026-07-01T08:00:00.000Z",
      knownEvalIds: ["q1", "q2", "q3"],
    });
    expect(snapA.dir.startsWith(root)).toBe(true);
    const before = JSON.parse(await readFile(join(snapA.dir, "run.json"), "utf-8"));
    expect(before.completedAt).toBeUndefined();
    expect(Object.keys(before)).toEqual(["format", "schemaVersion", "producer", "runId", "experimentId", "agent", "model", "startedAt", "knownEvalIds"]);

    const events = [{ type: "message", text: "hi" }] as never[];
    const o11yData = { toolCalls: 2 } as never;
    await snapA.writeAttempt(
      { id: "q1", verdict: "passed", attempt: 1, durationMs: 100, assertions: [], usage: { inputTokens: 10, outputTokens: 5 }, estimatedCostUSD: 0.25 },
      { events, o11y: o11yData },
    );
    await snapA.writeAttempt({ id: "q2", verdict: "failed", attempt: 1, durationMs: 50, assertions: [] });

    const snapB = await writer.run({ experimentId: "compare/b", agent: "codex", startedAt: "2026-07-02T09:00:00.000Z" });
    await snapB.writeAttempt({ id: "q1", verdict: "passed", attempt: 1, durationMs: 80, assertions: [] }, { diff: [{ window: "turn1", changes: { "a.txt": { status: "added", after: "1" } } }] });

    await snapA.finish();
    await snapB.finish();
    expect(writer.snapshotDirs().map((s) => s.experimentId).sort()).toEqual(["compare/a", "compare/b"]);

    const after = JSON.parse(await readFile(join(snapA.dir, "run.json"), "utf-8"));
    expect(typeof after.completedAt).toBe("string");
    expect(Object.keys(after)).toEqual(["format", "schemaVersion", "producer", "runId", "experimentId", "agent", "model", "startedAt", "completedAt", "knownEvalIds"]);

    await expect(snapA.finish()).rejects.toThrow(/already called/);

    const results = await openRecord(root);
    expect(results.unreadable).toHaveLength(0);
    expect(results.experiments.map((e) => e.id)).toEqual(["compare/a", "compare/b"]);

    const a = results.experiments[0].latestRun;
    expect(a.agent).toBe("bub");
    expect(a.model).toBe("gpt-5");
    expect(a.knownEvalIds).toEqual(["q1", "q2", "q3"]);
    expect(results.experiments[0].knownEvalIds).toEqual(["q1", "q2", "q3"]);

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
      artifacts: ["events", "o11y"],
    });
    expect(await q1.events()).toEqual(events);
    expect(await q1.o11y()).toEqual(o11yData);
    expect(await q1.trace()).toBeNull();

    const b = results.experiments[1].latestRun;
    expect(b.model).toBeUndefined();
    const bDiff = await b.attempts[0].diff();
    expect(bDiff?.windows).toEqual([{ window: "turn1", changes: { "a.txt": { status: "added", after: "1" } } }]);
    expect(bDiff?.get("a.txt")).toBe("1");

    const coverage = latestRunSample(results).coverage.find((c) => c.experimentId === "compare/a")!;
    expect(coverage.knownEvalIds).toHaveLength(3);
    expect(coverage.missingEvalIds).toHaveLength(1);
  });

  // cases: docs/engineering/testing/unit/record.md「manifests.json 落盘」「超时归属落盘」
  it("manifests.json 与 run.json 同层、逐 eval 一份;Run 未收尾也已经有它", async () => {
    const root = await makeRoot();
    const manifests = {
      q1: {
        algorithmVersion: 2,
        coverageVersion: 1,
        config: { agent: "codex", model: "opus", "flags.webSearch": true },
        source: { "evals/q1.eval.ts": "a".repeat(64), "evals/share/assert.ts": "b".repeat(64) },
        data: { "evals/data/cases.yaml": "c".repeat(64) },
      },
      q2: { algorithmVersion: 2, coverageVersion: 1, config: { agent: "codex" }, source: { "evals/q2.eval.ts": "d".repeat(64) }, data: {} },
    };
    const writer = createWriter(root, {
      producer: { name: "niceeval", version: "0.12.0" },
      manifests: new Map([["compare/a", manifests]]),
    });

    const snap = await writer.run({ experimentId: "compare/a", agent: "codex", startedAt: "2026-07-01T08:00:00.000Z" });
    await snap.writeAttempt({ id: "q1", verdict: "passed", attempt: 0, durationMs: 10, assertions: [] });

    // 清单在规划期一次写成,不随 attempt 完成回写:这里**没有** finish(),文件已经在。
    const raw = JSON.parse(await readFile(join(snap.dir, "manifests.json"), "utf-8"));
    expect(parseRunManifests(raw)).toEqual(manifests);
    expect(JSON.parse(await readFile(join(snap.dir, "run.json"), "utf-8")).completedAt).toBeUndefined();
  });

  it("没有清单的 Run 不生成 manifests.json(读取面如实为缺失,不合成一份空清单)", async () => {
    const root = await makeRoot();
    const writer = createWriter(root, { producer: { name: "niceeval", version: "0.12.0" } });
    const snap = await writer.run({ experimentId: "compare/a", agent: "codex", startedAt: "2026-07-01T08:00:00.000Z" });
    await expect(readFile(join(snap.dir, "manifests.json"), "utf-8")).rejects.toThrow();
  });

  it("超时归属三样原样往返;非超时的 errored 不带这个字段", async () => {
    const root = await makeRoot();
    const writer = createWriter(root, { producer: { name: "niceeval", version: "0.12.0" } });
    const snap = await writer.run({ experimentId: "compare/a", agent: "codex", startedAt: "2026-07-01T08:00:00.000Z" });
    const origin = { scope: "attempt", phase: "agent.run" } as const;
    await snap.writeAttempt({
      id: "q1",
      verdict: "errored",
      attempt: 0,
      durationMs: 10,
      assertions: [],
      error: { code: "timeout", message: "attempt timed out", origin, timeout: { trigger: "attempt-deadline", limitMs: 90_000, source: "eval" } },
    });
    await snap.writeAttempt({
      id: "q2",
      verdict: "errored",
      attempt: 0,
      durationMs: 10,
      assertions: [],
      error: { code: "timeout", message: "command timed out", origin, timeout: { trigger: "command-timeout", limitMs: 5_000, source: "command" } },
    });
    await snap.writeAttempt({
      id: "q3",
      verdict: "errored",
      attempt: 0,
      durationMs: 10,
      assertions: [],
      error: { code: "unexpected-error", message: "boom", origin },
    });
    await snap.finish();

    const run = (await openRecord(root)).experiments[0]!.latestRun;
    const errorOf = (id: string) => run.evals.find((e) => e.id === id)!.attempts[0]!.result.error;
    expect(errorOf("q1")!.timeout).toEqual({ trigger: "attempt-deadline", limitMs: 90_000, source: "eval" });
    expect(errorOf("q2")!.timeout).toEqual({ trigger: "command-timeout", limitMs: 5_000, source: "command" });
    expect(errorOf("q3")!.timeout).toBeUndefined();
  });

  it("agentSetup:落成 agent-setup.json(不内联进 result.json),懒加载读回;没装扩展的 attempt 恒 null;publish 能带上", async () => {
    const root = await makeRoot();
    const writer = createWriter(root, { producer: { name: "niceeval", version: "0.12.0" } });
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

    const snap = await writer.run({
      experimentId: "skill-ab/claude-effect",
      agent: "claude-code",
      startedAt: "2026-07-11T08:00:00.000Z",
    });
    await snap.writeAttempt({ id: "q1", verdict: "passed", attempt: 1, durationMs: 10, assertions: [] }, { agentSetup: manifest });
    await snap.writeAttempt({ id: "q2", verdict: "passed", attempt: 1, durationMs: 10, assertions: [] });
    await finishAll(writer);

    // 文件名是磁盘侧的 kebab;判决记录里不内联 manifest(它是 artifact,不是判决的一部分)
    const attemptDir = join(snap.dir, "q1", "a1");
    expect(await exists(join(attemptDir, "agent-setup.json"))).toBe(true);
    expect(JSON.parse(await readFile(join(attemptDir, "result.json"), "utf-8")).agentSetup).toBeUndefined();
    expect(await exists(join(snap.dir, "q2", "a1", "agent-setup.json"))).toBe(false);

    const results = await openRecord(root);
    const [q1, q2] = results.experiments[0].latestRun.attempts;
    expect(await q1.agentSetup()).toEqual(manifest);
    expect(await q2.agentSetup()).toBeNull();

    const dest = join(await makeRoot(), "published");
    await publish(latestRunSample(results), dest, { artifacts: ["agentSetup"] });
    const copied = join(dest, "skill-ab_claude-effect", basename(snap.dir), "q1", "a1", "agent-setup.json");
    expect(JSON.parse(await readFile(copied, "utf-8"))).toEqual(manifest);
  });

  // cases: docs/engineering/testing/unit/record.md「Usage、facts 与失败命令证据落盘」
  it("commands:落成 commands.json(不内联进 result.json),artifacts 含 commands;懒加载读回原样往返;没有非零命令的 attempt 恒 null;publish 缺省携带", async () => {
    const root = await makeRoot();
    const writer = createWriter(root, { producer: { name: "niceeval", version: "0.12.0" } });
    const evidence = [
      {
        timingNodeId: "n1",
        phase: "sandbox.prepare.eval" as const,
        display: "npm install -g pnpm",
        exitCode: 243,
        checked: true,
        stdout: "",
        stderr: "npm error code EACCES\nnpm error path /usr/lib/node_modules/pnpm",
      },
    ];

    const snap = await writer.run({
      experimentId: "install/pnpm-eacces",
      agent: "bub",
      startedAt: "2026-07-11T08:00:00.000Z",
    });
    await snap.writeAttempt({ id: "q1", verdict: "errored", attempt: 1, durationMs: 10, assertions: [] }, { commands: evidence });
    await snap.writeAttempt({ id: "q2", verdict: "passed", attempt: 1, durationMs: 10, assertions: [] });
    await finishAll(writer);

    const attemptDir = join(snap.dir, "q1", "a1");
    expect(await exists(join(attemptDir, "commands.json"))).toBe(true);
    const onDiskResult = JSON.parse(await readFile(join(attemptDir, "result.json"), "utf-8"));
    expect(onDiskResult.commands).toBeUndefined(); // 不内联进判决记录
    expect(onDiskResult.artifacts).toContain("commands");
    expect(await exists(join(snap.dir, "q2", "a1", "commands.json"))).toBe(false);

    const results = await openRecord(root);
    const [q1, q2] = results.experiments[0].latestRun.attempts;
    expect(await q1.commands()).toEqual(evidence); // timingNodeId/phase/display/exitCode/stdout/stderr 原样往返
    expect(JSON.stringify(await q1.commands())).not.toContain("classification"); // 展示语义不进入 Record
    expect(await q2.commands()).toBeNull(); // 没有非零命令的 attempt 恒 null,不是空数组

    // 缺省携带(证据 registry「publish 缺省」列):不显式声明 artifacts 时 commands 仍随行——
    // 失败命令证据是 errored attempt 的主要下钻面,不能被默认发布拷贝静默删掉。
    const dest = join(await makeRoot(), "published");
    await publish(latestRunSample(results), dest);
    const copied = join(dest, "install_pnpm-eacces", basename(snap.dir), "q1", "a1", "commands.json");
    expect(JSON.parse(await readFile(copied, "utf-8"))).toEqual(evidence);
  });

  it("commands:超 256 KiB 的失败输出不参与逐值截断,全量原样往返(起因在前段、summary 在尾部两端都要在)", async () => {
    const { ARTIFACT_VALUE_MAX_BYTES } = await import("./truncate.ts");
    const root = await makeRoot();
    const writer = createWriter(root, { producer: { name: "niceeval", version: "0.12.0" } });
    // 真实形状:头部是失败起因,中段是几百 KB 噪声,尾部是 runner 的 summary——截哪一端都毁掉另一半。
    const hugeStdout = `E   assert 429 == 200\n${"collecting …\n".repeat(Math.ceil(ARTIFACT_VALUE_MAX_BYTES / 13))}2 failed, 14 passed in 3.41s\n`;
    const hugeStderr = `Prepared 5 packages\n${"e".repeat(ARTIFACT_VALUE_MAX_BYTES + 500)}\nInstalled 5 packages`;
    expect(Buffer.byteLength(hugeStdout, "utf-8")).toBeGreaterThan(ARTIFACT_VALUE_MAX_BYTES);

    const snap = await writer.run({ experimentId: "huge/output", agent: "bub", startedAt: "2026-07-11T08:00:00.000Z" });
    const evidence = [
      { timingNodeId: "n1", phase: "eval.run" as const, display: "uv run pytest", exitCode: 1, checked: true, stdout: hugeStdout, stderr: hugeStderr },
    ];
    await snap.writeAttempt({ id: "q1", verdict: "errored", attempt: 1, durationMs: 10, assertions: [] }, { commands: evidence });
    await finishAll(writer);

    const results = await openRecord(root);
    const q1 = results.experiments[0].latestRun.attempts[0]!;
    const [readBack] = (await q1.commands())!;
    expect(readBack.stdout).toBe(hugeStdout); // 逐字节相等,没有 marker 行、没有丢尾部 summary
    expect(readBack.stderr).toBe(hugeStderr);
    expect(JSON.stringify(readBack)).not.toContain("[niceeval] truncated");
    expect((readBack as { truncated?: unknown }).truncated).toBeUndefined(); // 不再产出 truncated 字段
  });

  it("每个 Run 各自独立封口:两个 Experiment 各自不同的 completedAt 与 diagnostics 不串味,空 diagnostics 省略字段", async () => {
    // cases: docs/engineering/testing/unit/record.md「落盘格式」——snap.finish() 唯一一次补
    // completedAt 与快照级 diagnostics。
    const root = await makeRoot();
    const writer = createWriter(root, { producer: { name: "niceeval", version: "1.0.0" } });
    const snapA = await writer.run({ experimentId: "compare/a", agent: "bub", startedAt: "2026-07-01T08:00:00.000Z" });
    await snapA.writeAttempt({ id: "q1", verdict: "passed", attempt: 0, durationMs: 1, assertions: [] });
    const snapB = await writer.run({ experimentId: "compare/b", agent: "codex", startedAt: "2026-07-01T09:00:00.000Z" });
    await snapB.writeAttempt({ id: "q1", verdict: "passed", attempt: 0, durationMs: 1, assertions: [] });

    // 开始态:两份 run.json 都还没有 completedAt 或 diagnostics。
    const startedA = JSON.parse(await readFile(join(snapA.dir, "run.json"), "utf-8"));
    const startedB = JSON.parse(await readFile(join(snapB.dir, "run.json"), "utf-8"));
    expect(startedA).not.toHaveProperty("completedAt");
    expect(startedA).not.toHaveProperty("diagnostics");
    expect(startedB).not.toHaveProperty("completedAt");
    expect(startedB).not.toHaveProperty("diagnostics");

    // A 先收尾,带一条 teardown 失败诊断;B 后收尾,不带诊断(空 diagnostics 省略字段,不摆空数组)。
    await snapA.finish({
      completedAt: "2026-07-01T08:10:00.000Z",
      diagnostics: [{ code: "experiment-teardown-failed", level: "warning", detail: "m: tunnel refused to stop; a: leftover process; f: run `niceeval sandbox prune`", origin: { scope: "attempt" as const, phase: "experiment.teardown" }, context: { command: "niceeval sandbox prune" } }],
    });
    await snapB.finish({ completedAt: "2026-07-01T09:20:00.000Z" });

    const finishedA = JSON.parse(await readFile(join(snapA.dir, "run.json"), "utf-8"));
    const finishedB = JSON.parse(await readFile(join(snapB.dir, "run.json"), "utf-8"));
    expect(finishedA.completedAt).toBe("2026-07-01T08:10:00.000Z");
    expect(finishedA.diagnostics).toEqual([
      { code: "experiment-teardown-failed", level: "warning", detail: "m: tunnel refused to stop; a: leftover process; f: run `niceeval sandbox prune`", origin: { scope: "attempt" as const, phase: "experiment.teardown" }, context: { command: "niceeval sandbox prune" } },
    ]);
    expect(finishedB.completedAt).toBe("2026-07-01T09:20:00.000Z");
    expect(finishedB).not.toHaveProperty("diagnostics"); // B 没有诊断,不是 B 意外继承了 A 的

    // diagnostics 不是快照级字段拼合进 attempt 的一部分——result.json 里不出现它。
    const recordA = JSON.parse(await readFile(join(snapA.dir, "q1/a0/result.json"), "utf-8"));
    expect(recordA).not.toHaveProperty("diagnostics");

    // reader 原样读回,attempt.run.diagnostics 只读自己所属快照的那份。
    const results = await openRecord(root);
    const a = results.experiments.find((e) => e.id === "compare/a")!.latestRun;
    const b = results.experiments.find((e) => e.id === "compare/b")!.latestRun;
    expect(a.diagnostics).toEqual(finishedA.diagnostics);
    expect(b.diagnostics).toBeUndefined();
  });

  it("facts:attempt 级随 writeAttempt 落进 result.json、experiment 级随 finish() 落进 run.json,两级原样读回不合并,空 facts 省略字段", async () => {
    // cases: docs/engineering/testing/unit/record.md「Usage、facts 与失败命令证据落盘」——
    // 两级 facts 各自独立落盘与读回,读取面不把 attempt facts 与 run facts 混在一起。
    const root = await makeRoot();
    const writer = createWriter(root, { producer: { name: "niceeval", version: "1.0.0" } });

    const snapA = await writer.run({ experimentId: "compare/a", agent: "bub", startedAt: "2026-07-01T08:00:00.000Z" });
    await snapA.writeAttempt({
      id: "q1",
      verdict: "passed",
      attempt: 0,
      durationMs: 1,
      assertions: [],
      facts: { "memory.startup_notes": 12, "memory.source": "checkpoint-9" },
    });
    // 没有上报过 fact 的 attempt:字段整个不落盘,不是空对象。
    await snapA.writeAttempt({ id: "q2", verdict: "passed", attempt: 0, durationMs: 1, assertions: [] });
    await snapA.finish({ facts: { "service.version": "2026.7.1", "cache.warm": true } });

    const snapB = await writer.run({ experimentId: "compare/b", agent: "codex", startedAt: "2026-07-01T09:00:00.000Z" });
    await snapB.writeAttempt({ id: "q1", verdict: "passed", attempt: 0, durationMs: 1, assertions: [] });
    // experiment 级没有上报过 fact 的快照:同样整个省略字段,不摆空对象。
    await snapB.finish();

    const recordQ1 = JSON.parse(await readFile(join(snapA.dir, "q1/a0/result.json"), "utf-8"));
    expect(recordQ1.facts).toEqual({ "memory.startup_notes": 12, "memory.source": "checkpoint-9" });
    const recordQ2 = JSON.parse(await readFile(join(snapA.dir, "q2/a0/result.json"), "utf-8"));
    expect(recordQ2).not.toHaveProperty("facts");
    const metaA = JSON.parse(await readFile(join(snapA.dir, "run.json"), "utf-8"));
    expect(metaA.facts).toEqual({ "service.version": "2026.7.1", "cache.warm": true });
    const metaB = JSON.parse(await readFile(join(snapB.dir, "run.json"), "utf-8"));
    expect(metaB).not.toHaveProperty("facts");

    // reader:两级原样读回,不合并——q1 的 attempt facts 与它所属快照的 experiment facts 分居两处。
    const results = await openRecord(root);
    const a = results.experiments.find((e) => e.id === "compare/a")!.latestRun;
    const q1 = a.evals.find((e) => e.id === "q1")!.attempts[0];
    const q2 = a.evals.find((e) => e.id === "q2")!.attempts[0];
    expect(q1.result.facts).toEqual({ "memory.startup_notes": 12, "memory.source": "checkpoint-9" });
    expect(q1.result.facts).not.toHaveProperty("service.version"); // 不把快照级 facts 并进 attempt
    expect(q2.result.facts).toBeUndefined();
    expect(a.facts).toEqual({ "service.version": "2026.7.1", "cache.warm": true });
    expect(a.facts).not.toHaveProperty("memory.startup_notes"); // 不把 attempt 级 facts 并进快照

    const b = results.experiments.find((e) => e.id === "compare/b")!.latestRun;
    expect(b.facts).toBeUndefined();

    // publish 发布拷贝原样保留两级 facts。
    const dest = join(await makeRoot(), "published");
    await publish(latestRunSample(results), dest);
    const publishedMeta = JSON.parse(await readFile(join(dest, "compare_a", basename(snapA.dir), "run.json"), "utf-8"));
    expect(publishedMeta.facts).toEqual({ "service.version": "2026.7.1", "cache.warm": true });
    const publishedRecord = JSON.parse(await readFile(join(dest, "compare_a", basename(snapA.dir), "q1/a0/result.json"), "utf-8"));
    expect(publishedRecord.facts).toEqual({ "memory.startup_notes": 12, "memory.source": "checkpoint-9" });
  });

  it("重复 finish() 同一个 Run 抛可执行错误(每个 Run 只能封一次)", async () => {
    const root = await makeRoot();
    const writer = createWriter(root, { producer: { name: "x" } });
    const snap = await writer.run({ experimentId: "e", agent: "bub", startedAt: "2026-07-01T08:00:00.000Z" });
    await snap.finish();
    await expect(snap.finish()).rejects.toThrow(/already called/);
  });

  it("run() 缺 experimentId/agent/startedAt 抛可执行错误", async () => {
    const root = await makeRoot();
    const writer = createWriter(root, { producer: { name: "x" } });
    await expect(writer.run({ experimentId: "", agent: "a", startedAt: "t" })).rejects.toThrow(/experimentId/);
    await expect(writer.run({ experimentId: "e", agent: "", startedAt: "t" })).rejects.toThrow(/agent/);
    await expect(writer.run({ experimentId: "e", agent: "a", startedAt: "" })).rejects.toThrow(/startedAt/);
  });

  it("同一 writer 内同 experimentId 重复声明:复用同一个 RunWriter,knownEvalIds 取并集", async () => {
    const root = await makeRoot();
    const writer = createWriter(root, { producer: { name: "x" } });
    const s1 = await writer.run({ experimentId: "e", agent: "bub", startedAt: "2026-07-01T08:00:00.000Z", knownEvalIds: ["q1", "q2"] });
    const s2 = await writer.run({ experimentId: "e", agent: "bub", startedAt: "2026-07-01T08:00:00.000Z", knownEvalIds: ["q2", "q3"] });
    expect(s2).toBe(s1);
    await finishAll(writer);
    const written = JSON.parse(await readFile(join(s1.dir, "run.json"), "utf-8"));
    expect(written.knownEvalIds).toEqual(["q1", "q2", "q3"]);
  });

  it("同一毫秒并发声明不同 experimentId 的快照:互不干扰,各自独立目录", async () => {
    const root = await makeRoot();
    const writer = createWriter(root, { producer: { name: "x" } });
    const now = "2026-07-01T08:00:00.000Z";
    const [a, b, c] = await Promise.all([
      writer.run({ experimentId: "e/a", agent: "bub", startedAt: now }),
      writer.run({ experimentId: "e/b", agent: "bub", startedAt: now }),
      writer.run({ experimentId: "e/c", agent: "bub", startedAt: now }),
    ]);
    expect(new Set([a.dir, b.dir, c.dir]).size).toBe(3);
    await finishAll(writer);
    const results = await openRecord(root);
    expect(results.experiments.map((e) => e.id).sort()).toEqual(["e/a", "e/b", "e/c"]);
  });

  it("快照目录独占创建:撞名换随机后缀重试直到成功(EEXIST 不会覆盖已有目录)", async () => {
    const root = await makeRoot();
    // 受控随机序列:writer B 面对同一身份时重置序列,首次尝试重放 writer A 消耗过的
    // 随机值,必然撞上 A 的目录;重试消耗序列后续值,得到不同后缀。测试不假设一个
    // 后缀消耗几次 random,也不假设数值到后缀字符的映射。
    let call = 0;
    const randomSpy = vi.spyOn(Math, "random").mockImplementation(() => {
      call += 1;
      return ((call * 37) % 977) / 977;
    });
    try {
      const identity = { experimentId: "e", agent: "bub", startedAt: "2026-07-01T08:00:00.000Z" } as const;
      const writerA = createWriter(root, { producer: { name: "x" } });
      const snapA = await writerA.run(identity);
      const canary = join(snapA.dir, "canary.txt");
      await writeFile(canary, "occupied", "utf8");

      call = 0; // 重放同一序列,让 writer B 的首次尝试与 snapA 同名
      const writerB = createWriter(root, { producer: { name: "x" } });
      const snapB = await writerB.run(identity);

      expect(snapB.dir).not.toBe(snapA.dir);
      expect(await exists(join(snapB.dir, "run.json"))).toBe(true);
      // 被占用的目录内容原样保留 —— 独占创建不会覆盖已有内容。
      expect(await exists(canary)).toBe(true);
      expect(await exists(join(snapB.dir, "canary.txt"))).toBe(false);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it("writeAttemptFor:按 EvalResult.experimentId 懒建快照;正常条目拆 artifact,携带条目原样保留 startedAt/artifactBase/artifacts", async () => {
    const root = await makeRoot();
    const writer = createWriter(root, { producer: { name: "niceeval", version: "0.12.0" } });

    const fresh: EvalResult = {
      id: "algebra/q1",
      experimentId: "compare/bub",
      experiment: { flags: { style: "concise" }, attempts: 1, earlyExit: true, selectedEvalIds: ["algebra/q1"], sandboxLayer: {}, sandboxPlansByEval: {}, agentInstalls: [] },
      agent: "bub",
      model: "gpt-5.4",
      verdict: "passed",
      fingerprint: "abc",
      attempt: 1,
      startedAt: "2026-07-01T08:01:00.000Z",
      durationMs: 1234,
      assertions: [],
      evidenceCoverage: completeEvidenceCoverage,
      usage: { inputTokens: 10, outputTokens: 5 },
      estimatedCostUSD: 0.5,
      events: [{ type: "message", role: "assistant", text: "hi" } as never],
      sources: [{ path: "evals/a.ts", content: "x", role: "referenced" }],
      trace: [{ name: "turn", key: "agent.turn" } as never],
      o11y: { toolCalls: 2 } as never,
      diff: [{ window: "turn1", changes: { "a.txt": { status: "added", after: "1" } } }],
      commands: [{ timingNodeId: "n1", phase: "eval.run" as const, display: "npm ci", exitCode: 1, checked: true, stdout: "", stderr: "boom" }],
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
      evidenceCoverage: completeEvidenceCoverage,
      artifactBase: "compare_bub/2026-06-30T08-00-00-000Z-xxxx/algebra/q3/a1",
      artifacts: ["events", "sources"],
    };

    await writer.writeAttemptFor(fresh);
    await writer.writeAttemptFor(carried);
    await finishAll(writer);

    const dirs = writer.snapshotDirs();
    expect(dirs).toHaveLength(1);
    const snapDir = dirs[0].dir;

    const freshRecord = JSON.parse(await readFile(join(snapDir, "algebra/q1/a1/result.json"), "utf-8"));
    for (const key of ["agent", "model", "experimentId", "experiment", "events", "sources", "o11y", "trace", "diff", "commands", "rawTranscript"]) {
      expect(freshRecord).not.toHaveProperty(key);
    }
    // startedAt 是 attempt 级事实(每条各异,view 靠它显示「何时跑的」),正常条目也原样落盘。
    expect(freshRecord.startedAt).toBe("2026-07-01T08:01:00.000Z");
    // 顺序与证据 registry 一致(commands/events/trace/o11y/agentSetup/diff/sources);fresh 没写 agentSetup。
    expect(freshRecord.artifacts).toEqual(["commands", "events", "trace", "o11y", "diff", "sources"]);
    expect(await readFile(join(snapDir, "algebra/q1/a1/events.json"), "utf-8")).toBe('[{"type":"message","role":"assistant","text":"hi"}]');
    expect(await readFile(join(snapDir, "algebra/q1/a1/o11y.json"), "utf-8")).toBe('{"toolCalls":2}');
    expect(await readFile(join(snapDir, "algebra/q1/a1/commands.json"), "utf-8")).toBe(
      '[{"timingNodeId":"n1","phase":"eval.run","display":"npm ci","exitCode":1,"checked":true,"stdout":"","stderr":"boom"}]',
    );

    const carriedRecord = JSON.parse(await readFile(join(snapDir, "algebra/q3/a1/result.json"), "utf-8"));
    expect(carriedRecord.startedAt).toBe("2026-06-30T08:01:00.000Z");
    expect(carriedRecord.artifactBase).toBe("compare_bub/2026-06-30T08-00-00-000Z-xxxx/algebra/q3/a1");
    expect(carriedRecord.artifacts).toEqual(["events", "sources"]); // 携带条目:artifacts 原样携带,不重算
    expect(carriedRecord).not.toHaveProperty("agent");
    expect(carriedRecord).not.toHaveProperty("experimentId");
    expect(await exists(join(snapDir, "algebra/q3/a1/events.json"))).toBe(false); // 携带条目不写 artifact 文件

    const meta = JSON.parse(await readFile(join(snapDir, "run.json"), "utf-8"));
    expect(meta.experimentId).toBe("compare/bub");
    expect(meta.agent).toBe("bub");
    expect(meta.model).toBe("gpt-5.4");
  });

  it("writeAttemptFor:result.experimentId 缺失时抛可执行错误(v4 布局按实验分目录)", async () => {
    const root = await makeRoot();
    const writer = createWriter(root, { producer: { name: "x" } });
    await expect(
      writer.writeAttemptFor({ id: "q1", agent: "bub", verdict: "passed", attempt: 1, durationMs: 1, assertions: [] }),
    ).rejects.toThrow(/experimentId/);
  });
});

// ───────────────────────── publish ─────────────────────────

describe("publish", () => {
  it("产物是标准结果根目录(快照目录名原样保留);按指定 artifact 复制;补记 knownEvalIds;artifacts 按目标目录重算", async () => {
    const root = await makeRoot();
    const monday = await writeSnapshot(
      root,
      "compare_bub",
      "2026-07-01T08-00-00-000Z-mon1",
      meta({ experimentId: "compare/bub", agent: "bub", model: "gpt-5", startedAt: "2026-07-01T08:00:00.000Z", completedAt: "2026-07-01T08:10:00.000Z" }),
    );
    await writeResultFile(monday, "q1/a1", record({ id: "q1", attempt: 1, artifacts: ["events", "trace"] }));
    await writeArtifactFile(monday, "q1/a1", "events.json", [{ n: 1 }]);
    await writeArtifactFile(monday, "q1/a1", "trace.json", [{ name: "turn" }]);
    // 历史快照 fixture:opaque window 必须由读取/发布链路原样保留,不做迁移。
    await writeArtifactFile(monday, "q1/a1", "diff.json", [{ window: "legacy-window", changes: {} }]);
    await writeResultFile(monday, "q2/a1", record({ id: "q2", attempt: 1 }));

    // 周五只重跑了 q1:最新快照残缺。
    const friday = await writeSnapshot(
      root,
      "compare_bub",
      "2026-07-05T08-00-00-000Z-fri1",
      meta({ experimentId: "compare/bub", agent: "bub", model: "gpt-5", startedAt: "2026-07-05T08:00:00.000Z", completedAt: "2026-07-05T08:10:00.000Z" }),
    );
    await writeResultFile(friday, "q1/a1", record({ id: "q1", attempt: 1, artifacts: ["events"] }));
    await writeArtifactFile(friday, "q1/a1", "events.json", [{ n: 1 }, { n: 2 }]);

    const results = await openRecord(root);
    const dest = join(await makeRoot(), "site/data/run");
    const copied = await publish(latestRunSample(results), dest, { artifacts: ["events"] });

    expect(copied.issues).toHaveLength(0);
    expect(copied.dir).toBe(dest);

    const destSnapDir = join(dest, "compare_bub", "2026-07-05T08-00-00-000Z-fri1"); // 快照目录名原样保留
    expect(await exists(join(destSnapDir, "run.json"))).toBe(true);
    expect(await exists(join(destSnapDir, "q1/a1/events.json"))).toBe(true);
    expect(await exists(join(destSnapDir, "q1/a1/trace.json"))).toBe(false); // 未选中的 artifact 种类不复制

    const destMeta = JSON.parse(await readFile(join(destSnapDir, "run.json"), "utf-8"));
    expect(destMeta.knownEvalIds).toEqual(["q1", "q2"]); // 补记:复制时刻该实验已知的 eval 并集
    expect(destMeta.completedAt).toBe("2026-07-05T08:10:00.000Z");
    expect(destMeta.producer).toEqual({ name: "niceeval", version: "0.3.0" });

    const destRecord = JSON.parse(await readFile(join(destSnapDir, "q1/a1/result.json"), "utf-8"));
    expect(destRecord.artifacts).toEqual(["events"]); // 没选中 trace,目标按实际复制重算(不沿用源的列表)
    expect(destRecord).not.toHaveProperty("artifactBase");
    expect(destRecord).not.toHaveProperty("agent"); // 快照级字段不重复

    // 发布目录上重新 openRecord().latestRun():覆盖缺口被同一套机制重新算出来,不靠发布者转述。
    const republished = await openRecord(dest);
    expect(republished.experiments[0].knownEvalIds).toEqual(["q1", "q2"]);
    const coverage = latestRunSample(republished).coverage.find((c) => c.experimentId === "compare/bub")!;
    expect(coverage).toMatchObject({ knownEvalIds: ["q1", "q2"], missingEvalIds: ["q2"] });
  });

  it("目标目录非空即报错;artifacts 非法值报错;无快照报错;同实验多快照选中 → 取最新 + warning", async () => {
    const root = await makeRoot();
    await writeSnapshot(root, "e", "2026-07-01T08-00-00-000Z-a", meta({ experimentId: "e", agent: "bub", startedAt: "2026-07-01T08:00:00.000Z", completedAt: "2026-07-01T08:10:00.000Z" }));
    const tuesday = await writeSnapshot(root, "e", "2026-07-02T08-00-00-000Z-b", meta({ experimentId: "e", agent: "bub", startedAt: "2026-07-02T08:00:00.000Z", completedAt: "2026-07-02T08:10:00.000Z" }));
    await writeResultFile(tuesday, "q1/a1", record({ id: "q1", attempt: 1 }));

    const results = await openRecord(root);

    const occupied = await makeRoot();
    await writeFile(join(occupied, "existing.txt"), "x", "utf-8");
    await expect(publish(latestRunSample(results), occupied)).rejects.toThrow(/not empty/);

    await expect(publish(latestRunSample(results), join(await makeRoot(), "out"), { artifacts: ["evnets" as never] })).rejects.toThrow(/Unknown artifact kind/);

    await expect(publish([], join(await makeRoot(), "out"))).rejects.toThrow(/no runs/);

    // 手工传入同一 experiment 的两个快照(未走 latest 去重):只带最新,记 warning。
    const dest2 = join(await makeRoot(), "run2");
    const collided = await publish(results.experiments[0].runs, dest2);
    expect(collided.issues).toHaveLength(1);
    expect(collided.issues[0]).toMatch(/multiple runs selected/);
    const destDirs = await readdir(join(dest2, "e"));
    expect(destDirs).toEqual([basename(tuesday)]);
  });
});

// ───────────────────────── AttemptLocator 集成 ─────────────────────────

describe("AttemptLocator · 落盘 / 读取 / 携带 / 撞车", () => {
  it("非携带条目由 writer 按身份算出 locator 并落盘;确定性(同身份重开两次相同);resolveLocator 能找到", async () => {
    const root = await makeRoot();
    const writer = createWriter(root, { producer: { name: "niceeval", version: "1.0.0" } });
    const snap = await writer.run({ experimentId: "e", agent: "bub", startedAt: "2026-07-01T08:00:00.000Z" });
    await snap.writeAttempt({ id: "q1", verdict: "passed", attempt: 0, durationMs: 1, assertions: [] });
    await snap.writeAttempt({ id: "q2", verdict: "passed", attempt: 0, durationMs: 1, assertions: [] });
    await finishAll(writer);

    const record1 = JSON.parse(await readFile(join(snap.dir, "q1/a0/result.json"), "utf-8"));
    expect(record1.locator).toMatch(/^@1[0-9A-HJKMNP-TV-Z]{12}$/);
    expect(record1.locatorRunId).toBe(snap.runId);
    expect(record1.locator).toBe(
      encodeAttemptLocator({ runId: snap.runId, evalId: "q1", attempt: 0 }),
    );

    const record2 = JSON.parse(await readFile(join(snap.dir, "q2/a0/result.json"), "utf-8"));
    expect(record2.locator).not.toBe(record1.locator); // 不同 evalId → 不同 locator

    const resultsA = await openRecord(root);
    const resultsB = await openRecord(root); // 独立重开一次:身份不变,locator 必须一致
    const q1a = resultsA.experiments[0].latestRun.evals.find((e) => e.id === "q1")!.attempts[0];
    const q1b = resultsB.experiments[0].latestRun.evals.find((e) => e.id === "q1")!.attempts[0];
    expect(q1a.locator).toBe(record1.locator);
    expect(q1b.locator).toBe(record1.locator);

    expect(resolveLocator(resultsA, record1.locator).evalId).toBe("q1");
  });

  it("携带条目原样复制 locator 来源；全根同时保留原条目时 resolve 选最新副本而不误报歧义", async () => {
    const root = await makeRoot();
    const writer1 = createWriter(root, { producer: { name: "niceeval", version: "1.0.0" } });
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
    await finishAll(writer1);

    const opened1 = await openRecord(root);
    const original = opened1.experiments[0].latestRun.evals.find((e) => e.id === "q1")!.attempts[0];
    const originalLocator = original.locator!;

    // 第二轮:carry 合入 q1(artifactBase 指回第一轮的快照),locator 从上一轮读回的记录里原样带过来。
    // q2(真正新跑的)先写:run() 的 startedAt 由「该实验首条落盘结果的 attempt 时刻」锚定
    // (writer.ts 的注释),让第二轮快照的真实 startedAt("07-02")明确不同于原快照("07-01")——
    // 这样如果 locator 被错误地按「当前快照」重算,会得到一个可判别的不同字符串。
    const writer2 = createWriter(root, { producer: { name: "niceeval", version: "1.0.0" } });
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
      artifactBase: `${original.ref.run}/${original.ref.attempt}`,
    };
    await writer2.writeAttemptFor(carried);
    await finishAll(writer2);

    const opened2 = await openRecord(root);
    const newest = opened2.experiments[0].latestRun;
    const carriedAttempt = newest.evals.find((e) => e.id === "q1")!.attempts[0];
    expect(carriedAttempt.locator).toBe(originalLocator);
    expect(carriedAttempt.result.locatorRunId).toBe(original.run.runId);
    expect(carriedAttempt.locatorIdentity).toEqual({ runId: original.run.runId, evalId: "q1", attempt: 0 });
    expect(resolveLocator(opened2, originalLocator)).toBe(carriedAttempt);
    // attempt.carried 是 artifactBase 的读取面投影:携带条目为 true,本快照真实执行的 q2 为 false。
    expect(carriedAttempt.carried).toBe(true);
    expect(newest.evals.find((e) => e.id === "q2")!.attempts[0].carried).toBe(false);

    // 反证:如果按承载它的新 Run 身份重算，会得到不同字符串。
    const wronglyRecomputed = encodeAttemptLocator({
      runId: newest.runId,
      evalId: "q1",
      attempt: 0,
    });
    expect(originalLocator).not.toBe(wronglyRecomputed);
  });

  it("旧格式 carry 缺 locatorRunId 时沿 artifactBase 回溯来源，不把同一 attempt 判成 ambiguous", async () => {
    const root = await makeRoot();
    const writer1 = createWriter(root, { producer: { name: "niceeval", version: "1.0.0" } });
    await writer1.writeAttemptFor({
      id: "legacy",
      experimentId: "e",
      agent: "bub",
      verdict: "passed",
      attempt: 0,
      startedAt: "2026-07-01T08:00:00.000Z",
      durationMs: 1,
      assertions: [],
    });
    await finishAll(writer1);

    const opened1 = await openRecord(root);
    const original = opened1.experiments[0].latestRun.attempts[0]!;
    const originalPath = join(original.run.dir, original.ref.attempt, "result.json");
    const originalRecord = JSON.parse(await readFile(originalPath, "utf-8"));
    delete originalRecord.locatorRunId;
    delete originalRecord.locator;
    await writeFile(originalPath, JSON.stringify(originalRecord), "utf-8");
    const expectedLocator = encodeAttemptLocator({ runId: original.run.runId, evalId: "legacy", attempt: 0 });

    const writer2 = createWriter(root, { producer: { name: "niceeval", version: "1.0.0" } });
    const snap2 = await writer2.run({ experimentId: "e", agent: "bub", startedAt: "2026-07-02T08:00:00.000Z" });
    await snap2.writeAttempt({ id: "fresh", verdict: "passed", attempt: 0, durationMs: 1, assertions: [] });
    const carryDir = join(snap2.dir, "legacy/a0");
    await mkdir(carryDir, { recursive: true });
    await writeFile(
      join(carryDir, "result.json"),
      JSON.stringify({
        ...originalRecord,
        artifactBase: `${original.ref.run}/${original.ref.attempt}`,
      }),
      "utf-8",
    );
    await finishAll(writer2);

    const results = await openRecord(root);
    const newestCarry = results.experiments[0].latestRun.evals.find((e) => e.id === "legacy")!.attempts[0]!;
    expect(newestCarry.result.locatorRunId).toBeUndefined();
    expect(newestCarry.locatorIdentity?.runId).toBe(original.run.runId);
    expect(newestCarry.locator).toBe(expectedLocator);
    expect(resolveLocator(results, expectedLocator)).toBe(newestCarry);
  });

  it("resolveLocator:malformed 与 not-found 是两种可判别的错误", async () => {
    const root = await makeRoot();
    await writeSnapshot(root, "e", "2026-07-01T08-00-00-000Z-a", meta({ experimentId: "e", agent: "bub", startedAt: "2026-07-01T08:00:00.000Z" }));
    const results = await openRecord(root);

    expect(() => resolveLocator(results, "not-a-locator")).toThrow(MalformedLocatorError);
    expect(() => resolveLocator(results, "@1ZZZZZZZZZZZZ")).toThrow(LocatorNotFoundError);
  });

  it("两个不同身份的 attempt 同 locator：openRecord 保留记录，resolve 抛 AmbiguousLocatorError 并列候选", async () => {
    const root = await makeRoot();
    const writer = createWriter(root, { producer: { name: "niceeval", version: "1.0.0" } });
    const snap = await writer.run({ experimentId: "e", agent: "bub", startedAt: "2026-07-01T08:00:00.000Z" });
    await snap.writeAttempt({ id: "q1", verdict: "passed", attempt: 0, durationMs: 1, assertions: [] });
    await snap.writeAttempt({ id: "q2", verdict: "passed", attempt: 0, durationMs: 1, assertions: [] });
    await finishAll(writer);

    // 人为制造撞车:把 q2 的 locator 改成和 q1 一样(真实哈希撞车不可复现,这里直接模拟其效果——
    // 索引建立逻辑只关心「同一 locator 字符串映射到身份三元组不同的两个 attempt」)。
    const q1Path = join(snap.dir, "q1/a0/result.json");
    const q2Path = join(snap.dir, "q2/a0/result.json");
    const q1Record = JSON.parse(await readFile(q1Path, "utf-8"));
    const q2Record = JSON.parse(await readFile(q2Path, "utf-8"));
    q2Record.locator = q1Record.locator;
    await writeFile(q2Path, JSON.stringify(q2Record), "utf-8");

    const results = await openRecord(root);
    let ambiguous: AmbiguousLocatorError | undefined;
    try {
      resolveLocator(results, q1Record.locator);
    } catch (error) {
      if (error instanceof AmbiguousLocatorError) ambiguous = error;
    }
    expect(ambiguous).toBeDefined();
    expect(ambiguous?.candidates).toEqual([
      { experimentId: "e", evalId: "q1", attempt: 0 },
      { experimentId: "e", evalId: "q2", attempt: 0 },
    ]);
  });

  it("多 experiment:同 evalId/attempt 在不同 experiment 下产出不同 locator,resolveLocator 精确定位到各自的 experiment", async () => {
    const root = await makeRoot();
    const writer = createWriter(root, { producer: { name: "niceeval", version: "1.0.0" } });
    const snapA = await writer.run({ experimentId: "compare/bub", agent: "bub", startedAt: "2026-07-01T08:00:00.000Z" });
    const snapB = await writer.run({ experimentId: "compare/codex", agent: "codex", startedAt: "2026-07-01T08:00:00.000Z" });
    await snapA.writeAttempt({ id: "algebra/q1", verdict: "passed", attempt: 0, durationMs: 1, assertions: [] });
    await snapB.writeAttempt({ id: "algebra/q1", verdict: "passed", attempt: 0, durationMs: 1, assertions: [] });
    await finishAll(writer);

    const results = await openRecord(root);
    const a = results.experiments.find((e) => e.id === "compare/bub")!.latestRun.evals[0]!.attempts[0]!;
    const b = results.experiments.find((e) => e.id === "compare/codex")!.latestRun.evals[0]!.attempts[0]!;
    // 两个 writer Run 的 runId 不同，因此相同 evalId / attempt 仍有不同 locator。
    expect(a.locator).not.toBe(b.locator);

    expect(resolveLocator(results, a.locator!).experimentId).toBe("compare/bub");
    expect(resolveLocator(results, b.locator!).experimentId).toBe("compare/codex");
  });

  it("同一 evalId 的不同 attempt 序号产出不同 locator,resolveLocator 各自精确定位到对应 attempt", async () => {
    const root = await makeRoot();
    const writer = createWriter(root, { producer: { name: "niceeval", version: "1.0.0" } });
    const snap = await writer.run({ experimentId: "e", agent: "bub", startedAt: "2026-07-01T08:00:00.000Z" });
    await snap.writeAttempt({ id: "q1", verdict: "failed", attempt: 0, durationMs: 1, assertions: [] });
    await snap.writeAttempt({ id: "q1", verdict: "passed", attempt: 1, durationMs: 1, assertions: [] });
    await finishAll(writer);

    const results = await openRecord(root);
    const attempts = results.experiments[0]!.latestRun.evals.find((e) => e.id === "q1")!.attempts;
    expect(attempts).toHaveLength(2);
    const [a0, a1] = attempts;
    expect(a0!.locator).not.toBe(a1!.locator);
    expect(resolveLocator(results, a0!.locator!).result).toMatchObject({ attempt: 0, verdict: "failed" });
    expect(resolveLocator(results, a1!.locator!).result).toMatchObject({ attempt: 1, verdict: "passed" });
  });

  it("历史快照(非 latest)的 attempt 依然被建进索引,resolveLocator 能定位到旧快照里的那份", async () => {
    const root = await makeRoot();
    const writer1 = createWriter(root, { producer: { name: "niceeval", version: "1.0.0" } });
    const monday = await writer1.run({ experimentId: "e", agent: "bub", startedAt: "2026-07-01T08:00:00.000Z" });
    await monday.writeAttempt({ id: "q1", verdict: "failed", attempt: 0, durationMs: 1, assertions: [] });
    await finishAll(writer1);

    const writer2 = createWriter(root, { producer: { name: "niceeval", version: "1.0.0" } });
    const friday = await writer2.run({ experimentId: "e", agent: "bub", startedAt: "2026-07-05T08:00:00.000Z" });
    await friday.writeAttempt({ id: "q1", verdict: "passed", attempt: 0, durationMs: 1, assertions: [] });
    await finishAll(writer2);

    const results = await openRecord(root);
    const exp = results.experiments[0]!;
    expect(exp.runs).toHaveLength(2); // 两次快照都在(忠实磁盘,不合并/不丢弃历史)
    const oldAttempt = exp.runs.find((s) => s.startedAt === "2026-07-01T08:00:00.000Z")!.attempts[0]!;
    const newAttempt = exp.runs.find((s) => s.startedAt === "2026-07-05T08:00:00.000Z")!.attempts[0]!;
    expect(oldAttempt.locator).not.toBe(newAttempt.locator); // 不同 runId → 不同身份 → 不同 locator

    expect(resolveLocator(results, oldAttempt.locator!).result.verdict).toBe("failed");
    expect(resolveLocator(results, newAttempt.locator!).result.verdict).toBe("passed");
  });

  it("手工构造的 Record(未经 openRecord())上调 resolveLocator:索引查不到,统一按 not-found 处理,不抛意外错误", () => {
    const run = fakeSnapshot({ experimentId: "e", startedAt: "2026-07-01T08:00:00.000Z", dir: "/tmp/e/s1" });
    const attempt = fakeAttempt(run, record({ id: "q1", attempt: 0 }));
    run.attempts = [attempt];
    run.evals = [{ id: "q1", attempts: [attempt] }];
    const handMadeResults: Record = {
      root: "/tmp/e",
      experiments: [{ id: "e", runs: [run], latestRun: run, knownEvalIds: ["q1"] }],
      unreadable: [],
    };
    // 这份 locator 语法合法、甚至真的对应 handMadeResults 里那个 attempt 的身份,
    // 但 handMadeResults 没经过 openRecord(),locatorIndexByResults 里查不到它 —— 空索引,not-found。
    const syntacticallyValidLocator = encodeAttemptLocator({
      runId: run.runId,
      evalId: "q1",
      attempt: 0,
    });
    expect(() => resolveLocator(handMadeResults, syntacticallyValidLocator)).toThrow(LocatorNotFoundError);
  });

  it("publish:普通(非 sources)attempt 的 locator 原样复制,目标结果根上 resolveLocator 依然命中", async () => {
    const root = await makeRoot();
    const writer = createWriter(root, { producer: { name: "niceeval", version: "1.0.0" } });
    const snap = await writer.run({ experimentId: "e", agent: "bub", startedAt: "2026-07-01T08:00:00.000Z" });
    await snap.writeAttempt({ id: "q1", verdict: "passed", attempt: 0, durationMs: 1, assertions: [] });
    await snap.writeAttempt({ id: "q1", verdict: "failed", attempt: 1, durationMs: 1, assertions: [] });
    await finishAll(writer);

    const results = await openRecord(root);
    const [a0, a1] = results.experiments[0]!.latestRun.evals[0]!.attempts;
    const locator0 = a0!.locator!;
    const locator1 = a1!.locator!;

    const dest = join(await makeRoot(), "published");
    await publish(latestRunSample(results), dest, { artifacts: [] });

    const destResults = await openRecord(dest);
    expect(resolveLocator(destResults, locator0).result.attempt).toBe(0);
    expect(resolveLocator(destResults, locator1).result.attempt).toBe(1);
  });

  it("createWriter({ snapshotStartedAt }):writeAttemptFor() 的隐式声明统一用这个锚点,不再按各 result 自己的 attempt startedAt 分别猜", async () => {
    const root = await makeRoot();
    const snapshotStartedAt = "2026-07-10T00:00:00.000Z";
    const writer = createWriter(root, {
      producer: { name: "niceeval", version: "1.0.0" },
      snapshotStartedAt,
    });

    // 两个不同 experiment,各自的 result.startedAt 与 writer 级锚点都不同 —— 如果还在按
    // 「该 experiment 首条落盘结果的 attempt 时刻」猜,两份 run.json 的 startedAt 会
    // 分别变成各自 result 的 attempt 时刻,而不是这里统一传入的 snapshotStartedAt。
    await writer.writeAttemptFor({
      id: "q1", experimentId: "e1", agent: "bub", verdict: "passed", attempt: 0,
      startedAt: "2020-01-01T00:00:00.000Z", durationMs: 1, assertions: [],
    });
    await writer.writeAttemptFor({
      id: "q1", experimentId: "e2", agent: "bub", verdict: "passed", attempt: 0,
      startedAt: "2021-06-15T00:00:00.000Z", durationMs: 1, assertions: [],
    });
    await finishAll(writer);

    const results = await openRecord(root);
    const expE1 = results.experiments.find((e) => e.id === "e1")!;
    const expE2 = results.experiments.find((e) => e.id === "e2")!;
    expect(expE1.latestRun.startedAt).toBe(snapshotStartedAt);
    expect(expE2.latestRun.startedAt).toBe(snapshotStartedAt); // 两个 experiment 共用同一个锚点,不碰撞

    // attempt 级 startedAt(墙钟事实)依然各自独立保留,没有被锚点覆盖 ——
    // 快照身份锚点与 attempt 墙钟事实是两回事,继续分别保存。
    const attempt1 = expE1.latestRun.evals[0]!.attempts[0]!;
    const attempt2 = expE2.latestRun.evals[0]!.attempts[0]!;
    expect(attempt1.result.startedAt).toBe("2020-01-01T00:00:00.000Z");
    expect(attempt2.result.startedAt).toBe("2021-06-15T00:00:00.000Z");

    // locator 由各自 runId 派生；展示时间相同不共享身份。
    expect(attempt1.locator).not.toBe(attempt2.locator);
    expect(attempt1.locator).toBe(
      encodeAttemptLocator({ runId: expE1.latestRun.runId, evalId: "q1", attempt: 0 }),
    );
    expect(attempt2.locator).toBe(
      encodeAttemptLocator({ runId: expE2.latestRun.runId, evalId: "q1", attempt: 0 }),
    );
  });

  it("createWriter() 省略 snapshotStartedAt 时保留旧的按首条 result.startedAt 猜测行为(第三方直调兼容)", async () => {
    const root = await makeRoot();
    const writer = createWriter(root, { producer: { name: "niceeval", version: "1.0.0" } });
    await writer.writeAttemptFor({
      id: "q1", experimentId: "e", agent: "bub", verdict: "passed", attempt: 0,
      startedAt: "2020-03-03T00:00:00.000Z", durationMs: 1, assertions: [],
    });
    await finishAll(writer);

    const results = await openRecord(root);
    expect(results.experiments[0]!.latestRun.startedAt).toBe("2020-03-03T00:00:00.000Z");
  });
});

// ───────────────────────── sources 去重仓库 ─────────────────────────

describe("sources · 快照级去重仓库", () => {
  it("经真实 --resume carry 流程(writeAttemptFor 的 artifactBase 分支)携带的 attempt,其 sources() 引用在新快照里依然能解到原快照内容", async () => {
    const root = await makeRoot();
    const content = "export default { test() {} };\n";
    const writer1 = createWriter(root, { producer: { name: "niceeval", version: "1.0.0" } });
    await writer1.writeAttemptFor({
      id: "q1",
      experimentId: "e",
      agent: "bub",
      verdict: "passed",
      attempt: 0,
      startedAt: "2026-07-01T08:00:00.000Z",
      durationMs: 1,
      assertions: [],
      sources: [{ path: "evals/q1.eval.ts", content, role: "referenced" }],
    });
    await finishAll(writer1);

    const opened1 = await openRecord(root);
    const original = opened1.experiments[0]!.latestRun.evals.find((e) => e.id === "q1")!.attempts[0]!;
    expect(await original.sources()).toEqual([{ path: "evals/q1.eval.ts", content, role: "referenced" }]);

    // 第二轮:q2 是真正新跑的(锚定新快照的 startedAt 明确晚于原快照),q1 是 carry 合入 ——
    // artifactBase 指回第一轮的快照,与 locator carry 测试同一套构造手法。
    const writer2 = createWriter(root, { producer: { name: "niceeval", version: "1.0.0" } });
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
      artifactBase: `${original.ref.run}/${original.ref.attempt}`,
    };
    await writer2.writeAttemptFor(carried);
    await finishAll(writer2);

    const opened2 = await openRecord(root);
    const carriedAttempt = opened2.experiments[0]!.latestRun.evals.find((e) => e.id === "q1")!.attempts[0]!;
    // 新快照下没有为携带条目重新写 sources.json/blob(carry 分支不写 artifact),
    // sources() 必须靠 artifactBase 回退到原快照的去重仓库才能解出内容。
    expect(await carriedAttempt.sources()).toEqual([{ path: "evals/q1.eval.ts", content, role: "referenced" }]);
  });

  it("同一快照内相同内容只落一份 blob;不同内容各一份;attempt.sources() 各自读回正确内容", async () => {
    const root = await makeRoot();
    const writer = createWriter(root, { producer: { name: "niceeval", version: "1.0.0" } });
    const snap = await writer.run({ experimentId: "e", agent: "bub", startedAt: "2026-07-01T08:00:00.000Z" });
    const shared = [{ path: "evals/shared.eval.ts", content: "export default { test() {} };\n", role: "referenced" as const }];
    const other = [{ path: "evals/other.eval.ts", content: "export default { test() { /* different */ } };\n", role: "referenced" as const }];
    await snap.writeAttempt({ id: "q1", verdict: "passed", attempt: 0, durationMs: 1, assertions: [] }, { sources: shared });
    await snap.writeAttempt({ id: "q2", verdict: "passed", attempt: 0, durationMs: 1, assertions: [] }, { sources: shared });
    await snap.writeAttempt({ id: "q3", verdict: "passed", attempt: 0, durationMs: 1, assertions: [] }, { sources: other });
    await finishAll(writer);

    const storeFiles = await readdir(join(snap.dir, "sources"));
    expect(storeFiles).toHaveLength(2); // 三份引用,内容只两种 → 两个 blob

    // attempt 级 sources.json 只是引用(小,不含 content),不是全量内容。
    const q1Ref = JSON.parse(await readFile(join(snap.dir, "q1/a0/sources.json"), "utf-8"));
    expect(q1Ref).toEqual([{ path: "evals/shared.eval.ts", sha256: expect.any(String), role: "referenced" }]);
    expect(JSON.stringify(q1Ref)).not.toContain("export default");

    const results = await openRecord(root);
    const evalById = (id: string) => results.experiments[0].latestRun.evals.find((e) => e.id === id)!.attempts[0];
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
    await writeResultFile(oldSnap, "q1/a0", record({ id: "q1", attempt: 0, artifacts: ["sources"] }));
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
      record({ id: "q1", attempt: 0, startedAt: "2026-06-30T08:01:00.000Z", artifactBase: "e/2026-06-30T08-00-00-000Z-xxxx/q1/a0", artifacts: ["sources"] }),
    );

    const results = await openRecord(root);
    const carried = results.experiments[0].latestRun.evals.find((e) => e.id === "q1")!.attempts[0];
    expect(await carried.sources()).toEqual([{ path: "evals/q1.eval.ts", content: "export default {};\n", role: "referenced" }]);
  });

  it("publish:sources 引用与去重仓库一起复制,内容按目的地重新去重(同一份不重复落盘)", async () => {
    const root = await makeRoot();
    const writer = createWriter(root, { producer: { name: "niceeval", version: "1.0.0" } });
    const snap = await writer.run({ experimentId: "e", agent: "bub", startedAt: "2026-07-01T08:00:00.000Z" });
    const shared = [{ path: "evals/shared.eval.ts", content: "export default { test() {} };\n", role: "referenced" as const }];
    await snap.writeAttempt({ id: "q1", verdict: "passed", attempt: 0, durationMs: 1, assertions: [] }, { sources: shared });
    await snap.writeAttempt({ id: "q2", verdict: "passed", attempt: 0, durationMs: 1, assertions: [] }, { sources: shared });
    await finishAll(writer);

    const originalLocator = JSON.parse(await readFile(join(snap.dir, "q1/a0/result.json"), "utf-8")).locator;

    const results = await openRecord(root);
    const dest = join(await makeRoot(), "published");
    await publish(latestRunSample(results), dest, { artifacts: ["sources"] });

    const destSnapDir = join(dest, "e", basename(snap.dir));
    const destStoreFiles = await readdir(join(destSnapDir, "sources"));
    expect(destStoreFiles).toHaveLength(1); // 复制后在目的地重新按内容去重,仍只一份

    const destResults = await openRecord(dest);
    const q1 = destResults.experiments[0].latestRun.evals.find((e) => e.id === "q1")!.attempts[0];
    expect(await q1.sources()).toEqual(shared);
    expect(q1.result.locator).toBe(originalLocator); // locator 随 result.json 原样复制,不重算
  });
});
