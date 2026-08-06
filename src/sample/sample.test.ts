// @ts-nocheck
// cases: docs/engineering/testing/unit/sample.md
// 选择层(niceeval/scope)的单测:在临时目录里构造最小落盘树,直接调选择器,
// 覆盖定稿契约(docs/feature/sample/library.md):两个选择口径、覆盖缺口(coverage)、
// Attempt 来源与 Sample 的删减语义、四面同步重算、身份键去重、警告 kind 全集。
// fixture 的目录名/artifact 路径手写(不 import 库的路径函数),让测试独立于实现充当口径基准。
import { afterEach, describe, expect, it, vi } from "vitest";
import { currentSample, latestRunSample } from "./index.ts";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  RECORD_FORMAT,
  RECORD_SCHEMA_VERSION,
  publish,
  createWriter,
  dedupeAttempts,
  openRecord,
  resolveLocator,
  LocatorNotFoundError,
  MalformedLocatorError,
  LocatorCollisionError,
  encodeAttemptLocator,
  type AttemptHandle,
  type EvalResult,
  type Writer,
  type Record,
  type Run,
  type RunMeta,
} from "../record/index.ts";
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
async function finishAll(writer: Writer): Promise<void> {
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
    configHash: over.configHash ?? "fixture-config",
    experiment: over.experiment ?? {
      attempts: 1,
      earlyExit: true,
      sandboxLayer: {},
      sandboxPlansByEval: {},
      agentInstalls: [],
    },
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

// ───────────────────────── latest() Selection 与警告 ─────────────────────────

describe("latestRunSample(results) · Selection", () => {
  it("每个实验取最新快照;experiments 前缀过滤同 CLI 语义(尾斜杠等价)", async () => {
    const root = await makeRoot();
    const mondayA = await writeSnapshot(root, "mid_a", "s1", meta({ experimentId: "mid/a", agent: "bub", startedAt: "2026-07-01T08:00:00.000Z", completedAt: "2026-07-01T08:10:00.000Z" }));
    await writeResultFile(mondayA, "q1/a1", record({ id: "q1", attempt: 1 }));
    const mondayB = await writeSnapshot(root, "mid_b", "s1", meta({ experimentId: "mid/b", agent: "codex", startedAt: "2026-07-01T08:00:00.000Z", completedAt: "2026-07-01T08:10:00.000Z" }));
    await writeResultFile(mondayB, "q1/a1", record({ id: "q1", attempt: 1 }));
    const tuesday = await writeSnapshot(root, "mid_b", "s2", meta({ experimentId: "mid/b", agent: "codex", startedAt: "2026-07-02T08:00:00.000Z", completedAt: "2026-07-02T08:10:00.000Z" }));
    await writeResultFile(tuesday, "q1/a1", record({ id: "q1", attempt: 1 }));

    const results = await openRecord(root);
    const latest = latestRunSample(results);
    expect(latest.runs.map((s) => s.experimentId)).toEqual(["mid/a", "mid/b"]);
    expect(latest.runs[1].dir).toBe(tuesday);

    expect(latestRunSample(results, { experiments: "mid/a" }).runs).toHaveLength(1);
    expect(latestRunSample(results, { experiments: "mid/" }).runs).toHaveLength(2);
    expect(latestRunSample(results, { experiments: ["mid/a", "mid/b"] }).runs).toHaveLength(2);
    expect(latestRunSample(results, { experiments: "other" }).runs).toHaveLength(0);
    expect(latestRunSample(results, { experiments: "mid/a" }).runs[0].experimentId).toBe("mid/a"); // 不误配 "mid/ab"
  });

  it("coverage:最新快照覆盖 < 已知并集时,missing 列出缺的题;分母是 knownEvalIds", async () => {
    const root = await makeRoot();
    const mondayDir = await writeSnapshot(root, "midterm", "2026-07-01T08-00-00-000Z", meta({ experimentId: "midterm/bub-gpt-5.4", agent: "bub", startedAt: "2026-07-01T08:00:00.000Z", completedAt: "2026-07-01T08:10:00.000Z" }));
    await writeResultFile(mondayDir, "algebra/q1/a1", record({ id: "algebra/q1", attempt: 1 }));
    await writeResultFile(mondayDir, "algebra/q2/a1", record({ id: "algebra/q2", attempt: 1 }));
    await writeResultFile(mondayDir, "algebra/q3/a1", record({ id: "algebra/q3", attempt: 1 }));

    const fridayDir = await writeSnapshot(root, "midterm", "2026-07-05T08-00-00-000Z", meta({ experimentId: "midterm/bub-gpt-5.4", agent: "bub", startedAt: "2026-07-05T08:00:00.000Z", completedAt: "2026-07-05T08:10:00.000Z" }));
    await writeResultFile(fridayDir, "algebra/q1/a1", record({ id: "algebra/q1", attempt: 1 }));

    const latest = latestRunSample(await openRecord(root));
    expect(latest.runs).toHaveLength(1);
    // partial-coverage / stale-run 不再是 issues —— 覆盖缺口是行级事实,物化在 coverage 上。
    expect(latest.issues.filter((w) => w.code !== "unreadable-run")).toHaveLength(0);
    const coverage = latest.coverage.find((c) => c.experimentId === "midterm/bub-gpt-5.4")!;
    expect(coverage.knownEvalIds).toEqual(["algebra/q1", "algebra/q2", "algebra/q3"]);
    expect(coverage.missing.map((item) => item.evalId)).toEqual(["algebra/q2", "algebra/q3"]);
    expect(coverage.missing.map((item) => item.reason)).toEqual(["previous-result", "previous-result"]);
    // 锚点是最新 Run：分组读 agent 时与 friday 对齐，不必出现在 missing 题的 attempt 上。
    expect(coverage.run.dir).toBe(fridayDir);
    expect(coverage.run.agent).toBe("bub");
  });

  it("coverage 锚点 Run:全缺口 Experiment 仍有锚点，且不进 Sample.runs", async () => {
    const root = await makeRoot();
    // 周一全量；周二改 configHash 后零 attempt（只声明 knownEvalIds）——
    // current 以周二为可比性基准，周一不可比，全部题进缺口。
    const mondayDir = await writeSnapshot(root, "gap_e", "2026-07-01T08-00-00-000Z", meta({
      experimentId: "gap/e",
      agent: "bub",
      model: "gpt-old",
      startedAt: "2026-07-01T08:00:00.000Z",
      completedAt: "2026-07-01T08:10:00.000Z",
      configHash: "v1",
    }));
    await writeResultFile(mondayDir, "q1/a1", record({ id: "q1", attempt: 1 }));
    await writeResultFile(mondayDir, "q2/a1", record({ id: "q2", attempt: 1 }));
    const tuesdayDir = await writeSnapshot(root, "gap_e", "2026-07-02T08-00-00-000Z", meta({
      experimentId: "gap/e",
      agent: "codex",
      model: "gpt-new",
      startedAt: "2026-07-02T08:00:00.000Z",
      completedAt: "2026-07-02T08:10:00.000Z",
      configHash: "v2",
      knownEvalIds: ["q1", "q2"],
    }));

    const current = currentSample(await openRecord(root));
    expect(current.runs).toHaveLength(0);
    expect(current.attempts).toHaveLength(0);
    const coverage = current.coverage.find((c) => c.experimentId === "gap/e")!;
    expect(coverage.missing.map((item) => item.evalId)).toEqual(["q1", "q2"]);
    // 锚点是确定可比性配置的最新 Run（周二），不是周一。
    expect(coverage.run.dir).toBe(tuesdayDir);
    expect(coverage.run.agent).toBe("codex");
    expect(coverage.run.model).toBe("gpt-new");
    // latest 口径锚最新 Run，同样有缺口。
    const latest = latestRunSample(await openRecord(root));
    expect(latest.coverage[0]!.run.dir).toBe(tuesdayDir);
    expect(latest.coverage[0]!.missing.map((item) => item.evalId)).toEqual(["q1", "q2"]);
  });

  it("unfinished-run:选中快照缺 completedAt", async () => {
    const root = await makeRoot();
    const dir = await writeSnapshot(root, "e", "2026-07-01T08-00-00-000Z", meta({ experimentId: "e", agent: "bub", startedAt: "2026-07-01T08:00:00.000Z" }));

    const latest = latestRunSample(await openRecord(root));
    const warn = latest.issues.find((w) => w.code === "unfinished-run")!;
    expect(warn).toEqual({
      code: "unfinished-run",
      experimentId: "e",
      startedAt: "2026-07-01T08:00:00.000Z",
      dir,
    });
  });

  it("Selection.filter 只删观测:总体 coverage 分母不变,被删 eval 进入 missing", async () => {
    const root = await makeRoot();
    const aDir = await writeSnapshot(root, "mid_a", "s1", meta({ experimentId: "mid/a", agent: "bub", startedAt: "2026-07-01T08:00:00.000Z", completedAt: "2026-07-01T08:10:00.000Z" }));
    await writeResultFile(aDir, "q1/a1", record({ id: "q1", attempt: 1 }));
    await writeResultFile(aDir, "q2/a1", record({ id: "q2", attempt: 1 }));

    const latest = latestRunSample(await openRecord(root));
    expect(latest.coverage.find((c) => c.experimentId === "mid/a")!.missing.map((item) => item.evalId)).toEqual([]);

    const filtered = latest.filter((attempt) => attempt.evalId === "q1");
    expect(filtered.runs.map((s) => s.experimentId)).toEqual(["mid/a"]);
    expect(filtered.coverage.map((c) => c.experimentId)).toEqual(["mid/a"]);
    expect(filtered.attempts.map((attempt) => attempt.evalId)).toEqual(["q1"]);
    expect(filtered.coverage.find((c) => c.experimentId === "mid/a")!.knownEvalIds).toEqual(["q1", "q2"]);
    expect(filtered.coverage.find((c) => c.experimentId === "mid/a")!.missing.map((item) => item.evalId)).toEqual(["q2"]);
    expect(latest.attempts.map((attempt) => attempt.evalId)).toEqual(["q1", "q2"]);
  });

  it("current() 下同一 experiment 有两个贡献 Run 时,filter 删除其中一个只删该来源的水位,不整实验全留或全删", async () => {
    const root = await makeRoot();
    // 周一:q1、q2 真实执行。
    const mondayDir = await writeSnapshot(root, "multi_e", "2026-07-01T08-00-00-000Z", meta({ experimentId: "multi/e", agent: "bub", startedAt: "2026-07-01T08:00:00.000Z", completedAt: "2026-07-01T08:10:00.000Z" }));
    await writeResultFile(mondayDir, "q1/a1", record({ id: "q1", attempt: 1 }));
    await writeResultFile(mondayDir, "q2/a1", record({ id: "q2", attempt: 1 }));
    // 周二:只重跑 q1;current() 从周一补齐 q2,两个真实快照都进 Sample.runs。
    const tuesdayDir = await writeSnapshot(root, "multi_e", "2026-07-02T08-00-00-000Z", meta({ experimentId: "multi/e", agent: "bub", startedAt: "2026-07-02T08:00:00.000Z", completedAt: "2026-07-02T08:10:00.000Z" }));
    await writeResultFile(tuesdayDir, "q1/a1", record({ id: "q1", attempt: 1 }));

    const current = currentSample(await openRecord(root));
    expect(current.runs.map((s) => s.startedAt).sort()).toEqual(["2026-07-01T08:00:00.000Z", "2026-07-02T08:00:00.000Z"]);
    expect(current.attempts.map((a) => a.evalId).sort()).toEqual(["q1", "q2"]);
    expect(current.coverage.find((c) => c.experimentId === "multi/e")!.missing.map((item) => item.evalId)).toEqual([]);

    // 删掉周一(q2 唯一来源),周二(q1 来源)保留:不是整实验全留或全删。
    const filtered = current.filter((s) => s.run.startedAt !== "2026-07-01T08:00:00.000Z");
    expect(filtered.runs.map((s) => s.startedAt)).toEqual(["2026-07-02T08:00:00.000Z"]);
    expect(filtered.attempts.map((a) => a.evalId)).toEqual(["q1"]);
    // knownEvalIds(分母)不变,只有被删来源独占贡献的 q2 转入 missing。
    const filteredCoverage = filtered.coverage.find((c) => c.experimentId === "multi/e")!;
    expect(filteredCoverage.knownEvalIds).toEqual(["q1", "q2"]);
    expect(filteredCoverage.missing.map((item) => item.evalId)).toEqual(["q2"]);
    // 原 Sample 不被改动。
    expect(current.runs).toHaveLength(2);
    expect(current.attempts).toHaveLength(2);

    // 反过来删掉周二(q1 唯一来源),周一(q2 来源)保留。
    const otherWay = current.filter((s) => s.run.startedAt !== "2026-07-02T08:00:00.000Z");
    expect(otherWay.runs.map((s) => s.startedAt)).toEqual(["2026-07-01T08:00:00.000Z"]);
    expect(otherWay.attempts.map((a) => a.evalId)).toEqual(["q2"]);
    expect(otherWay.coverage.find((c) => c.experimentId === "multi/e")!.missing.map((item) => item.evalId)).toEqual(["q1"]);

    // attempt.run 原样指回真实来源(不是过滤时重建的新对象)。
    for (const attempt of filtered.attempts) {
      expect(filtered.runs).toContain(attempt.run);
    }
  });
});

// ───────────────────────── unreadable-run 警告 ─────────────────────────

describe("latestRunSample(results) / currentSample(results) · unreadable-run", () => {
  it("malformed 快照产生 warning 且其余快照照常计入;无关 JSON 不产生 warning", async () => {
    const root = await makeRoot();
    const okDir = await writeSnapshot(root, "ok-exp", "2026-07-04T08-00-00-000Z-oooo", meta({ experimentId: "ok", agent: "bub", startedAt: "2026-07-04T08:00:00.000Z", completedAt: "2026-07-04T08:10:00.000Z" }));
    await writeResultFile(okDir, "q1/a1", record({ id: "q1", attempt: 1 }));

    const badDir = join(root, "bad-exp", "2026-07-02T08-00-00-000Z-zzzz");
    await mkdir(badDir, { recursive: true });
    await writeFile(join(badDir, "run.json"), "not json {", "utf-8");

    const alienDir = join(root, "alien-exp", "2026-07-06T08-00-00-000Z-alien");
    await mkdir(alienDir, { recursive: true });
    await writeFile(join(alienDir, "summary.json"), JSON.stringify({ hello: 1 }), "utf-8");

    const results = await openRecord(root);
    const latest = latestRunSample(results);
    // 其余快照照常计入,不被坏落盘拖垮。
    expect(latest.runs.map((s) => s.experimentId)).toEqual(["ok"]);

    const unreadable = latest.issues.filter((w) => w.code === "unreadable-run");
    expect(unreadable).toHaveLength(1); // 无关 JSON(alien)不产生 warning
    expect(unreadable[0]).toEqual({ code: "unreadable-run", dir: badDir, reason: "malformed" });

    // currentSample(results) 同一份事实(show / view 报告槽走的是它)。
    const current = currentSample(results);
    expect(current.issues.filter((w) => w.code === "unreadable-run")).toHaveLength(1);
  });

  it("incompatible(schemaVersion 不兼容,niceeval producer)保留 producer 与读取证据", async () => {
    const root = await makeRoot();
    const oldDir = join(root, "old-exp", "2026-06-01T08-00-00-000Z");
    await mkdir(oldDir, { recursive: true });
    await writeFile(
      join(oldDir, "run.json"),
      JSON.stringify({
        format: RECORD_FORMAT,
        schemaVersion: RECORD_SCHEMA_VERSION - 1,
        producer: { name: "niceeval", version: "0.4.6" },
        experimentId: "old",
        agent: "bub",
        startedAt: "2026-06-01T08:00:00.000Z",
      }),
      "utf-8",
    );

    const latest = latestRunSample(await openRecord(root));
    const warn = latest.issues.find((w) => w.code === "unreadable-run")!;
    expect(warn).toEqual({
      code: "unreadable-run",
      dir: oldDir,
      reason: "incompatible",
      producer: { name: "niceeval", version: "0.4.6" },
    });
  });

  it("非实验作用域:Selection.filter 收窄后 unreadable-run warning 仍在", async () => {
    const root = await makeRoot();
    const aDir = await writeSnapshot(root, "mid_a", "s1", meta({ experimentId: "mid/a", agent: "bub", startedAt: "2026-07-01T08:00:00.000Z", completedAt: "2026-07-01T08:10:00.000Z" }));
    await writeResultFile(aDir, "q1/a1", record({ id: "q1", attempt: 1 }));

    const badDir = join(root, "bad-exp", "2026-07-02T08-00-00-000Z-zzzz");
    await mkdir(badDir, { recursive: true });
    await writeFile(join(badDir, "run.json"), "not json {", "utf-8");

    const latest = latestRunSample(await openRecord(root));
    expect(latest.issues.filter((w) => w.code === "unreadable-run")).toHaveLength(1);

    // filter 只删快照,不删非实验作用域的警告 —— 即便过滤条件与该 warning 无关的实验都不复存在。
    const filtered = latest.filter((s) => s.experimentId === "mid/a");
    expect(filtered.runs).toHaveLength(1);
    expect(filtered.issues.filter((w) => w.code === "unreadable-run")).toHaveLength(1);
  });
});

// ───────────────────────── SampleIssue 联合成员恰为三种(回归锁死) ─────────────────────────

// 类型契约(编译期,随 pnpm typecheck):SampleIssue 联合成员恰为三种——多一个 kind 而没同步
// 改这里,default 分支的 never 赋值编译不过;少一个则对应 case 编译不过。kind 全集不是运行时
// 行为,没有运行时断言可写(docs/engineering/testing/unit/README.md「类型契约」)。
function assertScopeWarningKindExhaustive(kind: import("../record/types.ts").SampleIssue["kind"]): void {
  switch (kind) {
    case "unfinished-run":
    case "unreadable-run":
      return;
    default: {
      const exhausted: never = kind;
      void exhausted;
    }
  }
}
void assertScopeWarningKindExhaustive;

// ───────────────────────── Attempt 来源与当前口径 ─────────────────────────

describe("Attempt 来源与当前口径", () => {
  it("carried Attempt 与本次执行 Attempt 同样进入 latest/current,历史按稳定身份去重", async () => {
    const root = await makeRoot();
    const monday = await writeSnapshot(root, "e", "2026-07-01T08-00-00-000Z", meta({
      experimentId: "e",
      agent: "bub",
      startedAt: "2026-07-01T08:00:00.000Z",
      completedAt: "2026-07-01T08:10:00.000Z",
    }));
    await writeResultFile(monday, "q1/a1", record({
      id: "q1",
      attempt: 1,
      startedAt: "2026-07-01T08:01:00.000Z",
    }));
    const tuesday = await writeSnapshot(root, "e", "2026-07-02T08-00-00-000Z", meta({
      experimentId: "e",
      agent: "bub",
      startedAt: "2026-07-02T08:00:00.000Z",
      completedAt: "2026-07-02T08:10:00.000Z",
    }));
    await writeResultFile(tuesday, "q1/a1", record({
      id: "q1",
      attempt: 1,
      startedAt: "2026-07-01T08:01:00.000Z",
      artifactBase: "e/2026-07-01T08-00-00-000Z/q1/a1",
    }));
    await writeResultFile(tuesday, "q2/a1", record({ id: "q2", attempt: 1 }));

    const results = await openRecord(root);
    const latest = latestRunSample(results);
    expect(latest.attempts.map((attempt) => attempt.evalId)).toEqual(["q1", "q2"]);
    expect(latest.attempts.find((attempt) => attempt.evalId === "q1")!.carried).toBe(true);
    expect(latest.historyAttempts).toHaveLength(2);
    expect(latest.historyAttempts[0]!.run.dir).toBe(tuesday);

    const current = currentSample(results);
    expect(current.attempts.map((attempt) => attempt.evalId)).toEqual(["q1", "q2"]);
    expect(current.historyAttempts).toHaveLength(2);
    expect(current.historyAttempts[0]!.run.dir).toBe(tuesday);
  });

  it("latest 统计携带与本次执行 Attempt,来源 Run 仍保留原始 evals", async () => {
    const root = await makeRoot();
    const monday = await writeSnapshot(root, "e", "2026-07-01T08-00-00-000Z", meta({ experimentId: "e", agent: "bub", startedAt: "2026-07-01T08:00:00.000Z", completedAt: "2026-07-01T08:10:00.000Z" }));
    await writeResultFile(monday, "q1/a1", record({ id: "q1", attempt: 1 }));

    // 周二:q1 携带合入(artifactBase 指回周一),q2 真实执行。
    const tuesday = await writeSnapshot(root, "e", "2026-07-02T08-00-00-000Z", meta({ experimentId: "e", agent: "bub", startedAt: "2026-07-02T08:00:00.000Z", completedAt: "2026-07-02T08:10:00.000Z" }));
    await writeResultFile(tuesday, "q1/a1", record({ id: "q1", attempt: 1, startedAt: "2026-07-01T08:00:00.000Z", artifactBase: "e/2026-07-01T08-00-00-000Z/q1/a1" }));
    await writeResultFile(tuesday, "q2/a1", record({ id: "q2", attempt: 1 }));

    const results = await openRecord(root);
    const sample = latestRunSample(results);
    expect(sample.attempts.map((a) => a.evalId)).toEqual(["q1", "q2"]);
    expect(sample.coverage.find((c) => c.experimentId === "e")!.missing).toEqual([]);
    // 真实 Run 原样保留:q1 仍在它自己的 evals 里,carried 不是报告过滤状态。
    expect(sample.runs[0]!.evals.map((e) => e.id).sort()).toEqual(["q1", "q2"]);
  });

  it("current 同时计入 carried 与可比旧 Run 的物理 Attempt", async () => {
    const root = await makeRoot();
    // 周一:q1、q2 真实执行。
    const monday = await writeSnapshot(root, "e", "2026-07-01T08-00-00-000Z", meta({ experimentId: "e", agent: "bub", startedAt: "2026-07-01T08:00:00.000Z", completedAt: "2026-07-01T08:10:00.000Z" }));
    await writeResultFile(monday, "q1/a1", record({ id: "q1", attempt: 1 }));
    await writeResultFile(monday, "q2/a1", record({ id: "q2", attempt: 1 }));

    // 周二:q1 携带合入(仍是这次快照里"最新"的一份,但 carried=true);q3 真实执行;q2 本次没有
    // 任何 attempt —— current() 从周一补齐它,补齐来的 q2 attempt 所属快照早于本实验在 Sample 中
    // 最新快照(周二),是「跨快照拼入」的历史执行,即使它自己不是携带条目。
    const tuesday = await writeSnapshot(root, "e", "2026-07-02T08-00-00-000Z", meta({ experimentId: "e", agent: "bub", startedAt: "2026-07-02T08:00:00.000Z", completedAt: "2026-07-02T08:10:00.000Z" }));
    await writeResultFile(tuesday, "q1/a1", record({ id: "q1", attempt: 1, startedAt: "2026-07-01T08:00:00.000Z", artifactBase: "e/2026-07-01T08-00-00-000Z/q1/a1" }));
    await writeResultFile(tuesday, "q3/a1", record({ id: "q3", attempt: 1 }));

    const results = await openRecord(root);
    const sample = currentSample(results);
    expect(sample.attempts.map((a) => a.evalId).sort()).toEqual(["q1", "q2", "q3"]);
    expect(sample.coverage.find((c) => c.experimentId === "e")!.missing).toEqual([]);
    // 两个真实来源都在场:q2 唯一来自周一,q1/q3 来自周二——不是一个合并对象。
    expect(sample.runs.map((s) => s.startedAt).sort()).toEqual(["2026-07-01T08:00:00.000Z", "2026-07-02T08:00:00.000Z"]);
  });

  it("current 对缺口区分 never-run/previous-result,并保留 carried 与 unfinished issue", async () => {
    const root = await makeRoot();
    const monday = await writeSnapshot(root, "e", "2026-07-01T08-00-00-000Z", meta({
      experimentId: "e",
      agent: "bub",
      startedAt: "2026-07-01T08:00:00.000Z",
      completedAt: "2026-07-01T08:10:00.000Z",
      configHash: "old-config",
    }));
    await writeResultFile(monday, "q1/a1", record({
      id: "q1",
      attempt: 1,
      verdict: "failed",
      startedAt: "2026-07-01T08:01:00.000Z",
    }));
    const mondayLater = await writeSnapshot(root, "e", "2026-07-01T09-00-00-000Z", meta({
      experimentId: "e",
      agent: "bub",
      startedAt: "2026-07-01T09:00:00.000Z",
      completedAt: "2026-07-01T09:10:00.000Z",
      configHash: "old-config",
    }));
    await writeResultFile(mondayLater, "q1/a1", record({
      id: "q1",
      attempt: 1,
      verdict: "passed",
      startedAt: "2026-07-01T09:01:00.000Z",
    }));
    // 新配置的 Run 没有物理 Attempt；q1 只有不同 configHash 的旧 Attempt,q2 从未有物理 Attempt。
    const tuesday = await writeSnapshot(root, "e", "2026-07-02T08-00-00-000Z", meta({
      experimentId: "e",
      agent: "bub",
      startedAt: "2026-07-02T08:00:00.000Z",
      configHash: "new-config",
      knownEvalIds: ["q1", "q2"],
    }));
    const sample = currentSample(await openRecord(root));
    expect(sample.attempts).toEqual([]);
    expect(sample.runs).toEqual([]);
    const oldAttempt = sample.historyAttempts.find((attempt) => attempt.run.dir === mondayLater)!;
    expect(sample.coverage.find((c) => c.experimentId === "e")!.missing).toEqual([
      {
      evalId: "q1",
      reason: "previous-result",
      previous: {
        locator: oldAttempt.locator,
        verdict: "passed",
        startedAt: "2026-07-01T09:01:00.000Z",
      },
      },
      { evalId: "q2", reason: "never-run" },
    ]);
    expect(sample.issues).toContainEqual({
      code: "unfinished-run",
      experimentId: "e",
      startedAt: "2026-07-02T08:00:00.000Z",
      dir: tuesday,
    });
    expect(sample.filter(() => true).issues).toContainEqual({
      code: "unfinished-run",
      experimentId: "e",
      startedAt: "2026-07-02T08:00:00.000Z",
      dir: tuesday,
    });
  });
});

// ───────────────────────── 物理 Attempt 并入携带条目(exp 写入面) ─────────────────────────

describe("currentSample · 物理 Attempt 并入携带条目", () => {
  // bug: memory/exp-runjson-missing-confighash-breaks-current-sample.md
  it("收窄跑一题 + 携带合入:不依赖 persisted 选题字段,currentSample 看到全部条目", async () => {
    const root = await makeRoot();
    const writer = createWriter(root, { producer: { name: "niceeval", version: "0.12.0" } });

    // 本次收窄只重跑了 algebra/q1(narrow rerun 的正常姿势);q2/q3 携带合入同一份快照。
    const experimentInfo = {
      attempts: 1,
      earlyExit: true,
      sandboxLayer: {},
      sandboxPlansByEval: {},
      agentInstalls: [],
    };
    await writer.writeAttemptFor({
      id: "algebra/q1",
      experimentId: "compare/bub",
      experiment: experimentInfo,
      agent: "bub",
      model: "gpt-5.4",
      verdict: "passed",
      fingerprint: "fp-q1",
      attempt: 1,
      startedAt: "2026-08-04T08:00:00.000Z",
      durationMs: 100,
      assertions: [],
      evidenceCoverage: completeEvidenceCoverage,
    });
    await writer.writeAttemptFor({
      id: "algebra/q2",
      experimentId: "compare/bub",
      agent: "bub",
      model: "gpt-5.4",
      verdict: "passed",
      fingerprint: "fp-q2",
      attempt: 1,
      startedAt: "2026-08-03T08:00:00.000Z",
      durationMs: 100,
      assertions: [],
      evidenceCoverage: completeEvidenceCoverage,
      artifactBase: "compare_bub/2026-08-03T08-00-00-000Z-aaaa/algebra/q2/a1",
    });
    await writer.writeAttemptFor({
      id: "algebra/q3",
      experimentId: "compare/bub",
      agent: "bub",
      model: "gpt-5.4",
      verdict: "passed",
      fingerprint: "fp-q3",
      attempt: 1,
      startedAt: "2026-08-03T08:00:00.000Z",
      durationMs: 100,
      assertions: [],
      evidenceCoverage: completeEvidenceCoverage,
      artifactBase: "compare_bub/2026-08-03T08-00-00-000Z-aaaa/algebra/q3/a1",
    });

    const runs = await writer.snapshotWriters();
    await runs[0]!.writer.finish({
      completedAt: "2026-08-04T08:05:00.000Z",
    });

    const results = await openRecord(root);
    const runMeta = JSON.parse(await readFile(join(results.experiments[0]!.latestRun.dir, "run.json"), "utf-8"));
    expect(runMeta.experiment).not.toHaveProperty("selectedEvalIds");
    expect(runMeta.experiment).not.toHaveProperty("evalFilterFingerprint");

    const sample = currentSample(results);
    expect(sample.attempts.map((a) => a.evalId).sort()).toEqual(["algebra/q1", "algebra/q2", "algebra/q3"]);
    expect(sample.coverage.find((c) => c.experimentId === "compare/bub")!.missing).toEqual([]);
  });
});

// ───────────────────────── 身份键去重 ─────────────────────────

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

    const { attempts, issues } = dedupeAttempts([a1, a2Mon, a3Mon, a1Resumed, a2Tue, a3Tue]);
    expect(attempts).toHaveLength(5);
    const q1 = attempts.filter((a) => a.evalId === "q1");
    expect(q1).toHaveLength(1);
    expect(q1[0].run).toBe(tuesday); // 保留最新快照
    expect(attempts.filter((a) => a.evalId === "q2")).toHaveLength(2);
    expect(attempts.filter((a) => a.evalId === "q3")).toHaveLength(2);

    expect(issues).toHaveLength(2);
    expect(issues[0]).toMatchObject({ kind: "missing-startedAt", experimentId: "e", evalId: "q3" });
    expect(issues[0].message).toContain("has no startedAt");
  });
});
