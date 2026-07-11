// niceeval/results 的单测:临时目录里构造最小 summary.json / artifact fixture,覆盖定稿契约
// (docs/results-lib.md):分层读取、懒加载回退、skipped 三种原因、latest() 三种警告、
// Selection.filter 修剪、dedupeAttempts 身份键、writer roundtrip、copySnapshots 补记,
// 以及 Artifacts 报告器(writer 薄壳)与直写时代逐字节等价的守护。
// 读取面 fixture 的目录名/artifact 路径手写(不 import 库的路径函数),让测试独立于实现充当格式基准。

import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  RESULTS_FORMAT,
  RESULTS_SCHEMA_VERSION,
  copySnapshots,
  createRunWriter,
  dedupeAttempts,
  openResults,
  type EvalResult,
  type RunSummary,
} from "./index.ts";
import { Artifacts } from "../runner/reporters/artifacts.ts";

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

function res(over: Partial<EvalResult> & Pick<EvalResult, "id" | "agent">): EvalResult {
  return { verdict: "passed", attempt: 1, durationMs: 1000, assertions: [], ...over };
}

function summaryOf(results: EvalResult[], over: Partial<RunSummary> = {}): RunSummary {
  const count = (o: EvalResult["verdict"]) => results.filter((r) => r.verdict === o).length;
  return {
    format: RESULTS_FORMAT,
    schemaVersion: RESULTS_SCHEMA_VERSION,
    producer: { name: "niceeval", version: "0.3.0" },
    agent: results[0]?.agent ?? "agent",
    startedAt: "2026-07-01T08:00:00.000Z",
    completedAt: "2026-07-01T08:10:00.000Z",
    passed: count("passed"),
    failed: count("failed"),
    skipped: count("skipped"),
    errored: count("errored"),
    durationMs: 60_000,
    results,
    ...over,
  };
}

async function writeRun(root: string, dirName: string, summary: unknown): Promise<string> {
  const dir = join(root, dirName);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "summary.json"), typeof summary === "string" ? summary : JSON.stringify(summary, null, 2), "utf-8");
  return dir;
}

async function writeArtifact(runDir: string, relDir: string, file: string, data: unknown): Promise<string> {
  const dir = join(runDir, relDir);
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
  it("一个 run 装两个 experiment:切成两个快照;实验按 id 字典序,快照最新在前,latest = snapshots[0]", async () => {
    const root = await makeRoot();
    const monday = await writeRun(root, "2026-07-01T08-00-00-000Z", summaryOf([
      res({ id: "algebra/q1", agent: "bub", model: "gpt-5", experimentId: "compare/bub", startedAt: "2026-07-01T08:01:00.000Z" }),
      res({ id: "algebra/q1", agent: "bub", model: "gpt-5", experimentId: "compare/bub", attempt: 2, verdict: "failed" }),
      res({ id: "algebra/q2", agent: "bub", model: "gpt-5", experimentId: "compare/bub" }),
      res({ id: "algebra/q1", agent: "codex", model: "o3", experimentId: "compare/codex" }),
    ], { startedAt: "2026-07-01T08:00:00.000Z" }));
    const tuesday = await writeRun(root, "2026-07-02T08-00-00-000Z", summaryOf([
      res({ id: "algebra/q1", agent: "bub", model: "gpt-5", experimentId: "compare/bub" }),
    ], { startedAt: "2026-07-02T08:00:00.000Z" }));

    const results = await openResults(root);
    expect(results.skipped).toHaveLength(0);
    expect(results.runDirs.map((r) => r.dir)).toEqual([tuesday, monday]); // 新→旧
    expect(results.experiments.map((e) => e.id)).toEqual(["compare/bub", "compare/codex"]); // 字典序

    const bub = results.experiments[0];
    expect(bub.snapshots.map((s) => s.startedAt)).toEqual(["2026-07-02T08:00:00.000Z", "2026-07-01T08:00:00.000Z"]);
    expect(bub.latest).toBe(bub.snapshots[0]);
    expect(bub.evalIds).toEqual(["algebra/q1", "algebra/q2"]); // 本地历史并集

    // eval 分组:attempt 挂在题下面;attempts 平铺 = evals 逐题展开。
    const mondayBub = bub.snapshots[1];
    expect(mondayBub.agent).toBe("bub");
    expect(mondayBub.model).toBe("gpt-5");
    expect(mondayBub.producer).toEqual({ name: "niceeval", version: "0.3.0" });
    expect(mondayBub.schemaVersion).toBe(RESULTS_SCHEMA_VERSION);
    expect(mondayBub.runDir.dir).toBe(monday);
    expect(mondayBub.evals.map((e) => e.id)).toEqual(["algebra/q1", "algebra/q2"]);
    expect(mondayBub.evals[0].attempts).toHaveLength(2);
    expect(mondayBub.attempts).toHaveLength(3);

    // attempt 直达字段与证据引用。
    const attempt = mondayBub.evals[0].attempts[0];
    expect(attempt.evalId).toBe("algebra/q1");
    expect(attempt.experimentId).toBe("compare/bub");
    expect(attempt.ref).toEqual({ run: "2026-07-01T08-00-00-000Z", result: 0 });
    expect(attempt.result.startedAt).toBe("2026-07-01T08:01:00.000Z");
  });

  it("summary.snapshots 元数据:快照级 startedAt 覆盖顶层,knownEvalIds 并进 exp.evalIds", async () => {
    const root = await makeRoot();
    await writeRun(root, "2026-07-01T08-00-00-000Z", summaryOf([
      res({ id: "q1", agent: "bub", experimentId: "mid/a" }),
      res({ id: "q1", agent: "codex", experimentId: "mid/b" }),
    ], {
      startedAt: "2026-07-01T08:00:00.000Z",
      snapshots: {
        "mid/b": { startedAt: "2026-06-20T08:00:00.000Z", knownEvalIds: ["q1", "q2", "q3"] },
      },
    }));

    const results = await openResults(root);
    const a = results.experiments.find((e) => e.id === "mid/a")!;
    const b = results.experiments.find((e) => e.id === "mid/b")!;
    expect(a.latest.startedAt).toBe("2026-07-01T08:00:00.000Z");
    expect(b.latest.startedAt).toBe("2026-06-20T08:00:00.000Z");
    expect(b.latest.knownEvalIds).toEqual(["q1", "q2", "q3"]);
    expect(b.evalIds).toEqual(["q1", "q2", "q3"]); // 本地覆盖 ∪ 携带的 knownEvalIds
    expect(a.evalIds).toEqual(["q1"]);
  });
});

// ───────────────────────── 懒加载与回退 ─────────────────────────

describe("AttemptHandle · 懒加载", () => {
  it("缺文件返回 null 不抛错;读过一次即记忆化; artifactsDir 优先、 artifactBase 回退;原 run 清理后如实 null", async () => {
    const root = await makeRoot();
    // 原 run:携带条目的 artifact 真身。
    const oldRun = await writeRun(root, "2026-06-30T08-00-00-000Z", summaryOf([
      res({ id: "q3", agent: "bub", model: "gpt-5", experimentId: "e", artifactsDir: "q3/bub/gpt-5/e/a1", hasEvents: true }),
    ], { startedAt: "2026-06-30T08:00:00.000Z" }));
    await writeArtifact(oldRun, "q3/bub/gpt-5/e/a1", "events.json", [{ type: "message", text: "old" }]);

    const runDir = await writeRun(root, "2026-07-01T08-00-00-000Z", summaryOf([
      res({ id: "q1", agent: "bub", model: "gpt-5", experimentId: "e", artifactsDir: "q1/bub/gpt-5/e/a1", hasEvents: true }),
      res({ id: "q2", agent: "bub", model: "gpt-5", experimentId: "e" }),
      // --resume 携带条目:本 run 没有 artifact, artifactBase(相对结果根)指向原 run。
      res({ id: "q3", agent: "bub", model: "gpt-5", experimentId: "e", artifactBase: "2026-06-30T08-00-00-000Z/q3/bub/gpt-5/e/a1", hasEvents: true }),
    ], { startedAt: "2026-07-01T08:00:00.000Z" }));
    const eventsPath = await writeArtifact(runDir, "q1/bub/gpt-5/e/a1", "events.json", [{ type: "message", text: "hi" }]);

    const results = await openResults(root);
    const snap = results.experiments[0].latest;
    const [q1, q2, q3] = snap.evals.map((e) => e.attempts[0]);

    const events = await q1.events();
    expect(events).toHaveLength(1);
    // summary 只有 hasEvents/hasTrace/hasSources 三个标记,o11y/diff 没有标记 —— 全靠方法语义吸收。
    expect(await q1.trace()).toBeNull();
    expect(await q1.o11y()).toBeNull();
    expect(await q1.diff()).toBeNull();
    expect(await q1.sources()).toBeNull();

    // 记忆化:同一 handle 读一次缓存,文件删掉后再读仍返回同一份数据。
    await rm(eventsPath);
    expect(await q1.events()).toBe(events);

    // 条目没有 artifactsDir 也没有 artifactBase:不猜路径,全部 null。
    expect(await q2.events()).toBeNull();

    // 携带条目经 artifactBase 回退读到原 run 的 artifact;ref 指条目所在的落盘(新 run)。
    expect(await q3.events()).toEqual([{ type: "message", text: "old" }]);
    expect(q3.ref.run).toBe("2026-07-01T08-00-00-000Z");

    // 原 run 被清理:回退落空,如实返回 null(新句柄,不吃上面的记忆化)。
    await rm(oldRun, { recursive: true });
    const reopened = await openResults(root);
    const q3Again = reopened.experiments[0].latest.evals.find((e) => e.id === "q3")!.attempts[0];
    expect(await q3Again.events()).toBeNull();
  });
});

// ───────────────────────── skipped 三种原因 ─────────────────────────

describe("openResults · skipped", () => {
  it("版本不匹配带 schemaVersion 与完整 producer;坏 JSON 记 malformed;无 summary 有 artifact 记 incomplete;无关 JSON 静默;legacy 无信封按 1 读", async () => {
    const root = await makeRoot();
    const incompatible = await writeRun(root, "2026-07-03T08-00-00-000Z", {
      format: RESULTS_FORMAT,
      schemaVersion: RESULTS_SCHEMA_VERSION + 1,
      producer: { name: "other-harness", version: "9.9.9" },
      startedAt: "2026-07-03T08:00:00.000Z",
      results: [],
    });
    await writeRun(root, "2026-07-04T08-00-00-000Z", "not json {");
    await writeRun(root, "unrelated", { hello: 1 });
    await writeRun(root, "alien-results", { results: [] }); // 只沾一个键:无关 JSON,不进 skipped
    // crash 没收尾:有 attempt artifact、没有 summary.json。
    const crashed = join(root, "2026-07-05T08-00-00-000Z");
    await writeArtifact(crashed, "q1/bub/default/a1", "events.json", [{ type: "message" }]);
    // 空目录:既无 summary 也无 artifact,静默忽略。
    await mkdir(join(root, "2026-07-06T08-00-00-000Z"), { recursive: true });
    await writeRun(root, "2026-07-01T08-00-00-000Z", summaryOf([res({ id: "q1", agent: "bub", experimentId: "e" })]));
    // legacy:引入版本号之前的存量报告,没有 format 信封,按 schemaVersion 1 读。
    const legacy = summaryOf([res({ id: "q1", agent: "bub", experimentId: "old" })], { startedAt: "2026-06-01T08:00:00.000Z" });
    delete legacy.format;
    delete legacy.schemaVersion;
    delete legacy.producer;
    await writeRun(root, "2026-06-01T08-00-00-000Z", legacy);

    const results = await openResults(root);
    expect(results.runDirs).toHaveLength(2);
    expect(results.skipped).toHaveLength(3);

    const versionSkip = results.skipped.find((s) => s.reason === "incompatible-version")!;
    expect(versionSkip.dir).toBe(incompatible);
    expect(versionSkip.schemaVersion).toBe(RESULTS_SCHEMA_VERSION + 1);
    // 完整 producer:第三方 harness 的名字如实报出,消费方才能做对「要不要拼 npx 提示」的分支。
    expect(versionSkip.producer).toEqual({ name: "other-harness", version: "9.9.9" });

    expect(results.skipped.find((s) => s.reason === "malformed")!.detail).toBe("invalid JSON");
    expect(results.skipped.find((s) => s.reason === "incomplete")!.dir).toBe(crashed);

    const legacyExp = results.experiments.find((e) => e.id === "old")!;
    expect(legacyExp.latest.schemaVersion).toBe(1);
    expect(legacyExp.latest.producer).toBeUndefined();
  });
});

// ───────────────────────── latest() Selection 与警告 ─────────────────────────

describe("results.latest() · Selection", () => {
  it("每个实验取最新快照;experiments 前缀过滤同 CLI 语义(尾斜杠等价)", async () => {
    const root = await makeRoot();
    await writeRun(root, "2026-07-01T08-00-00-000Z", summaryOf([
      res({ id: "q1", agent: "bub", experimentId: "mid/a" }),
      res({ id: "q1", agent: "codex", experimentId: "mid/b" }),
    ], { startedAt: "2026-07-01T08:00:00.000Z" }));
    const tuesday = await writeRun(root, "2026-07-02T08-00-00-000Z", summaryOf([
      res({ id: "q1", agent: "codex", experimentId: "mid/b" }),
    ], { startedAt: "2026-07-02T08:00:00.000Z" }));

    const results = await openResults(root);
    const latest = results.latest();
    expect(latest.snapshots.map((s) => s.experimentId)).toEqual(["mid/a", "mid/b"]);
    expect(latest.snapshots[1].runDir.dir).toBe(tuesday);

    expect(results.latest({ experiments: "mid/a" }).snapshots).toHaveLength(1);
    expect(results.latest({ experiments: "mid/" }).snapshots).toHaveLength(2);
    expect(results.latest({ experiments: ["mid/a", "mid/b"] }).snapshots).toHaveLength(2);
    expect(results.latest({ experiments: "other" }).snapshots).toHaveLength(0);
    expect(results.latest({ experiments: "mid/a" }).snapshots[0].experimentId).toBe("mid/a"); // 不误配 "mid/ab"
  });

  it("partial-coverage:最新快照覆盖 < 已知并集;结构化字段 + 渲染好的英文 message", async () => {
    const root = await makeRoot();
    await writeRun(root, "2026-07-01T08-00-00-000Z", summaryOf([
      res({ id: "algebra/q1", agent: "bub", experimentId: "midterm/bub-gpt-5.4" }),
      res({ id: "algebra/q2", agent: "bub", experimentId: "midterm/bub-gpt-5.4" }),
      res({ id: "algebra/q3", agent: "bub", experimentId: "midterm/bub-gpt-5.4" }),
    ], { startedAt: "2026-07-01T08:00:00.000Z" }));
    await writeRun(root, "2026-07-05T08-00-00-000Z", summaryOf([
      res({ id: "algebra/q1", agent: "bub", experimentId: "midterm/bub-gpt-5.4" }),
    ], { startedAt: "2026-07-05T08:00:00.000Z" }));

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
    await writeRun(root, "2026-07-01T08-00-00-000Z", summaryOf([
      res({ id: "q1", agent: "bub", experimentId: "mid/a" }),
    ], { startedAt: "2026-07-01T08:00:00.000Z" }));
    await writeRun(root, "2026-07-05T08-00-00-000Z", summaryOf([
      res({ id: "q1", agent: "codex", experimentId: "mid/b" }),
    ], { startedAt: "2026-07-05T08:00:00.000Z" }));

    const latest = (await openResults(root)).latest();
    const stale = latest.warnings.filter((w) => w.kind === "stale-snapshot");
    expect(stale).toHaveLength(1);
    expect(stale[0]).toMatchObject({
      experimentId: "mid/a",
      startedAt: "2026-07-01T08:00:00.000Z",
      latestStartedAt: "2026-07-05T08:00:00.000Z",
    });
    expect(stale[0].message).toContain("predates the latest run in this selection by 4 days");
  });

  it("synthetic-experiment-id:落盘缺 experimentId 以 <agent>/<model> 合成键(无 model 用 default)", async () => {
    const root = await makeRoot();
    const runDir = await writeRun(root, "2026-07-01T08-00-00-000Z", summaryOf([
      res({ id: "q1", agent: "codex" }),
    ]));

    const results = await openResults(root);
    expect(results.experiments[0].id).toBe("codex/default");
    expect(results.experiments[0].latest.synthetic).toBe(true);

    const latest = results.latest();
    const synthetic = latest.warnings.find((w) => w.kind === "synthetic-experiment-id")!;
    expect(synthetic).toMatchObject({ experimentId: "codex/default", runDir });
    expect(synthetic.message).toContain("without experimentId");
    // 合成键拼不出可执行的 niceeval exp 命令:partial 提示退化成中性说法(此处无 partial,仅验证不炸)。
  });

  it("Selection.filter 只删不换:快照删减,幸存实验的警告保留、其余丢弃", async () => {
    const root = await makeRoot();
    // 两个实验都制造 partial-coverage。
    await writeRun(root, "2026-07-01T08-00-00-000Z", summaryOf([
      res({ id: "q1", agent: "bub", experimentId: "mid/a" }),
      res({ id: "q2", agent: "bub", experimentId: "mid/a" }),
      res({ id: "q1", agent: "codex", experimentId: "mid/b" }),
      res({ id: "q2", agent: "codex", experimentId: "mid/b" }),
    ], { startedAt: "2026-07-01T08:00:00.000Z" }));
    await writeRun(root, "2026-07-02T08-00-00-000Z", summaryOf([
      res({ id: "q1", agent: "bub", experimentId: "mid/a" }),
      res({ id: "q1", agent: "codex", experimentId: "mid/b" }),
    ], { startedAt: "2026-07-02T08:00:00.000Z" }));

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

describe("dedupeAttempts", () => {
  it("按 (experimentId, evalId, attempt, startedAt) 去重,保留最新 run 目录的那份;缺 startedAt 不去重并出 missing-startedAt", async () => {
    const root = await makeRoot();
    await writeRun(root, "2026-07-01T08-00-00-000Z", summaryOf([
      res({ id: "q1", agent: "bub", experimentId: "e", startedAt: "2026-07-01T08:01:00.000Z" }),
      res({ id: "q2", agent: "bub", experimentId: "e", verdict: "failed", startedAt: "2026-07-01T08:02:00.000Z" }),
      res({ id: "q3", agent: "bub", experimentId: "e" }),
    ], { startedAt: "2026-07-01T08:00:00.000Z" }));
    const tuesday = await writeRun(root, "2026-07-02T08-00-00-000Z", summaryOf([
      res({ id: "q1", agent: "bub", experimentId: "e", startedAt: "2026-07-01T08:01:00.000Z" }), // resume 原样合入
      res({ id: "q2", agent: "bub", experimentId: "e", startedAt: "2026-07-02T08:02:00.000Z" }), // 重跑,新 startedAt
      res({ id: "q3", agent: "bub", experimentId: "e" }),
    ], { startedAt: "2026-07-02T08:00:00.000Z" }));

    const results = await openResults(root);
    const all = results.experiments[0].snapshots.flatMap((s) => s.attempts);
    expect(all).toHaveLength(6);

    const { attempts, warnings } = dedupeAttempts(all);
    // q1 合并成一条(取新 run 让 ref 落在最新落盘);q2 两条(两次真实运行);q3 两条(缺 startedAt 不敢去重)。
    expect(attempts).toHaveLength(5);
    const q1 = attempts.filter((a) => a.evalId === "q1");
    expect(q1).toHaveLength(1);
    expect(q1[0].runDir.dir).toBe(tuesday);
    expect(attempts.filter((a) => a.evalId === "q2")).toHaveLength(2);
    expect(attempts.filter((a) => a.evalId === "q3")).toHaveLength(2);

    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatchObject({ kind: "missing-startedAt", experimentId: "e", evalId: "q3" });
    expect(warnings[0].message).toContain("has no startedAt");
  });
});

// ───────────────────────── writer roundtrip ─────────────────────────

describe("createRunWriter", () => {
  it("writeAttempt + snapshot 声明写出 → openResults 读回逐字段相等; artifact 懒加载;knownEvalIds 进分母", async () => {
    const root = await makeRoot();
    const writer = await createRunWriter(root, { producer: { name: "my-harness", version: "1.0.0" } });
    expect(writer.dir.startsWith(root)).toBe(true);

    const snapA = writer.snapshot({
      experiment: "compare/a",
      agent: "bub",
      model: "gpt-5",
      startedAt: "2026-07-01T08:00:00.000Z",
      knownEvalIds: ["q1", "q2", "q3"],
    });
    const events = [{ type: "message", role: "assistant", text: "hi" }] as never[];
    const o11y = { toolCalls: 2 } as never;
    await snapA.writeAttempt(
      {
        id: "q1",
        verdict: "passed",
        attempt: 1,
        durationMs: 100,
        assertions: [],
        usage: { inputTokens: 10, outputTokens: 5 },
        estimatedCostUSD: 0.25,
      },
      { events, o11y },
    );
    await snapA.writeAttempt({ id: "q2", verdict: "failed", attempt: 1, durationMs: 50, assertions: [] });

    const snapB = writer.snapshot({ experiment: "compare/b", agent: "codex", startedAt: "2026-07-02T09:00:00.000Z" });
    await snapB.writeAttempt(
      { id: "q1", verdict: "passed", attempt: 1, durationMs: 80, assertions: [] },
      { diff: { generatedFiles: { "a.txt": "1" }, deletedFiles: [] } },
    );

    const summary = await writer.finish();
    // summary 从已写 attempt 推导:计数永远和条目一致;版本元数据注入。
    expect(summary.format).toBe(RESULTS_FORMAT);
    expect(summary.schemaVersion).toBe(RESULTS_SCHEMA_VERSION);
    expect(summary.producer).toEqual({ name: "my-harness", version: "1.0.0" });
    expect(summary.passed).toBe(2);
    expect(summary.failed).toBe(1);
    expect(summary.startedAt).toBe("2026-07-01T08:00:00.000Z"); // 最早的快照时刻
    expect(summary.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(summary.estimatedCostUSD).toBe(0.25);

    const results = await openResults(root);
    expect(results.skipped).toHaveLength(0);
    expect(results.experiments.map((e) => e.id)).toEqual(["compare/a", "compare/b"]);

    const a = results.experiments[0].latest;
    expect(a.agent).toBe("bub");
    expect(a.model).toBe("gpt-5");
    expect(a.startedAt).toBe("2026-07-01T08:00:00.000Z");
    expect(a.producer).toEqual({ name: "my-harness", version: "1.0.0" });
    expect(a.schemaVersion).toBe(RESULTS_SCHEMA_VERSION);
    expect(a.knownEvalIds).toEqual(["q1", "q2", "q3"]);
    expect(results.experiments[0].evalIds).toEqual(["q1", "q2", "q3"]);

    // 快照级字段注入进条目(agent/model/experimentId/startedAt),attempt 级字段原样读回。
    const q1 = a.evals.find((e) => e.id === "q1")!.attempts[0];
    expect(q1.experimentId).toBe("compare/a");
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
    expect(await q1.o11y()).toEqual(o11y);
    expect(await q1.trace()).toBeNull();
    expect(await q1.diff()).toBeNull();

    // 第二个快照:自己的 startedAt(≠ 顶层)经快照元数据读回;diff artifact 可达。
    const b = results.experiments[1].latest;
    expect(b.agent).toBe("codex");
    expect(b.model).toBeUndefined();
    expect(b.startedAt).toBe("2026-07-02T09:00:00.000Z");
    expect(await b.attempts[0].diff()).toEqual({ generatedFiles: { "a.txt": "1" }, deletedFiles: [] });

    // knownEvalIds 是残缺检测的分母:compare/a 只写了 2/3 → partial-coverage。
    const partial = results.latest().warnings.find((w) => w.kind === "partial-coverage")!;
    expect(partial).toMatchObject({ experimentId: "compare/a", covered: 2, total: 3 });
  });

  it("没走到 finish() 的目录 = skipped(\"incomplete\"):有 artifact、无 summary,reader 不读半份落盘", async () => {
    const root = await makeRoot();
    const writer = await createRunWriter(root, { producer: { name: "my-harness" } });
    const snap = writer.snapshot({ experiment: "e", agent: "bub", startedAt: "2026-07-01T08:00:00.000Z" });
    await snap.writeAttempt(
      { id: "q1", verdict: "passed", attempt: 1, durationMs: 10, assertions: [] },
      { events: [{ type: "message" }] as never[] },
    );
    // crash:没有 finish()。
    const results = await openResults(root);
    expect(results.experiments).toHaveLength(0);
    expect(results.skipped).toEqual([{ dir: writer.dir, reason: "incomplete" }]);
  });

  it("snapshot() 的 startedAt 必填(运行时也拦):身份键与去重以它为锚", async () => {
    const root = await makeRoot();
    const writer = await createRunWriter(root, { producer: { name: "x" } });
    expect(() => writer.snapshot({ experiment: "e", agent: "a", startedAt: "" })).toThrow(/startedAt/);
  });
});

// ───────────────────────── copySnapshots ─────────────────────────

describe("copySnapshots", () => {
  it("按指定 artifact 复制;summary 重建保留版本元数据;补记 knownEvalIds 让发布目录重算出同样的残缺警告", async () => {
    const root = await makeRoot();
    const monday = await writeRun(root, "2026-07-01T08-00-00-000Z", summaryOf([
      res({ id: "q1", agent: "bub", model: "gpt-5", experimentId: "compare/bub", artifactsDir: "q1/bub/gpt-5/compare_bub/a1", hasEvents: true, hasTrace: true, startedAt: "2026-07-01T08:01:00.000Z" }),
      res({ id: "q2", agent: "bub", model: "gpt-5", experimentId: "compare/bub", startedAt: "2026-07-01T08:02:00.000Z" }),
      res({ id: "q1", agent: "codex", model: "o3", experimentId: "compare/codex", artifactsDir: "q1/codex/o3/compare_codex/a1", hasEvents: true, verdict: "failed", startedAt: "2026-07-01T08:03:00.000Z" }),
    ], { startedAt: "2026-07-01T08:00:00.000Z" }));
    await writeArtifact(monday, "q1/bub/gpt-5/compare_bub/a1", "events.json", [{ n: 1 }]);
    await writeArtifact(monday, "q1/bub/gpt-5/compare_bub/a1", "trace.json", [{ name: "turn" }]);
    await writeArtifact(monday, "q1/bub/gpt-5/compare_bub/a1", "diff.json", { generatedFiles: {}, deletedFiles: [] });
    await writeArtifact(monday, "q1/codex/o3/compare_codex/a1", "events.json", [{ n: 2 }]);
    // 周五只重跑了 compare/bub 的 q1:它的最新快照残缺。
    const friday = await writeRun(root, "2026-07-05T08-00-00-000Z", summaryOf([
      res({ id: "q1", agent: "bub", model: "gpt-5", experimentId: "compare/bub", artifactsDir: "q1/bub/gpt-5/compare_bub/a1", hasEvents: true, startedAt: "2026-07-05T08:01:00.000Z" }),
    ], { startedAt: "2026-07-05T08:00:00.000Z" }));
    await writeArtifact(friday, "q1/bub/gpt-5/compare_bub/a1", "events.json", [{ n: 1 }, { n: 2 }]);

    const results = await openResults(root);
    const dest = join(await makeRoot(), "site/data/run");
    const copied = await copySnapshots(results.latest(), dest, { artifacts: ["events", "sources"] });

    expect(copied.warnings).toHaveLength(0);
    expect(copied.summary.format).toBe(RESULTS_FORMAT);
    expect(copied.summary.schemaVersion).toBe(RESULTS_SCHEMA_VERSION);
    expect(copied.summary.producer?.version).toBe("0.3.0");
    expect(copied.summary.results).toHaveLength(2);
    // 补记的覆盖事实:复制时刻该实验已知的 eval 并集。
    expect(copied.summary.snapshots?.["compare/bub"].knownEvalIds).toEqual(["q1", "q2"]);
    expect(copied.summary.snapshots?.["compare/codex"].knownEvalIds).toEqual(["q1"]);

    // 磁盘:只有选中的 artifact 种类被复制;存在标记按目标目录重算。
    expect(await exists(join(dest, "q1/bub/gpt-5/compare_bub/a1/events.json"))).toBe(true);
    expect(await exists(join(dest, "q1/bub/gpt-5/compare_bub/a1/trace.json"))).toBe(false);
    expect(await exists(join(dest, "q1/bub/gpt-5/compare_bub/a1/diff.json"))).toBe(false);
    const bubEntry = copied.summary.results.find((r) => r.experimentId === "compare/bub")!;
    expect(bubEntry.startedAt).toBe("2026-07-05T08:01:00.000Z"); // 最新快照的那份
    expect(bubEntry.hasEvents).toBe(true);
    expect(bubEntry.hasTrace).toBe(false);

    // 发布目录上重新 openResults().latest():残缺警告被同一套机制重新算出来,不靠发布者转述。
    const republished = await openResults(dest);
    expect(republished.experiments.find((e) => e.id === "compare/bub")!.evalIds).toEqual(["q1", "q2"]);
    const partial = republished.latest().warnings.find((w) => w.kind === "partial-coverage")!;
    expect(partial).toMatchObject({ experimentId: "compare/bub", covered: 1, total: 2 });
    // 快照各自的 startedAt 也随行(compare/bub 周五、compare/codex 周一)。
    expect(republished.experiments.find((e) => e.id === "compare/bub")!.latest.startedAt).toBe("2026-07-05T08:00:00.000Z");
    expect(republished.experiments.find((e) => e.id === "compare/codex")!.latest.startedAt).toBe("2026-07-01T08:00:00.000Z");
    // artifact 懒加载在发布目录同样成立。
    const bubAttempt = republished.experiments.find((e) => e.id === "compare/bub")!.latest.attempts[0];
    expect(await bubAttempt.events()).toHaveLength(2);
    expect(await bubAttempt.trace()).toBeNull();
  });

  it("目标目录非空即报错(不静默覆盖、不合并); artifacts 非法值报错;同实验重复快照落同一目录出 warning", async () => {
    const root = await makeRoot();
    await writeRun(root, "2026-07-01T08-00-00-000Z", summaryOf([
      res({ id: "q1", agent: "bub", model: "gpt-5", experimentId: "e", artifactsDir: "q1/bub/gpt-5/e/a1", startedAt: "2026-07-01T08:01:00.000Z" }),
    ], { startedAt: "2026-07-01T08:00:00.000Z" }));
    await writeRun(root, "2026-07-02T08-00-00-000Z", summaryOf([
      res({ id: "q1", agent: "bub", model: "gpt-5", experimentId: "e", artifactsDir: "q1/bub/gpt-5/e/a1", startedAt: "2026-07-01T08:01:00.000Z" }),
    ], { startedAt: "2026-07-02T08:00:00.000Z" }));
    const results = await openResults(root);

    const occupied = await makeRoot();
    await writeFile(join(occupied, "existing.txt"), "x", "utf-8");
    await expect(copySnapshots(results.latest(), occupied)).rejects.toThrow(/not empty/);

    await expect(
      copySnapshots(results.latest(), join(await makeRoot(), "out"), { artifacts: ["evnets" as never] }),
    ).rejects.toThrow(/Unknown artifact kind/);

    await expect(copySnapshots([], join(await makeRoot(), "out"))).rejects.toThrow(/no snapshots/);

    // 同一 experiment 的两个快照(未走 latest 的手工数组):同键 attempt 落同一目录 → 保留最新 + warning。
    const both = results.experiments[0].snapshots;
    expect(both).toHaveLength(2);
    const dest2 = join(await makeRoot(), "run2");
    const collided = await copySnapshots(both, dest2);
    expect(collided.warnings).toHaveLength(1);
    expect(collided.warnings[0]).toMatch(/multiple attempts map to/);
    expect(collided.summary.results).toHaveLength(1);
  });
});

// ───────────────────────── Artifacts 报告器 = writer 薄壳 ─────────────────────────

describe("Artifacts reporter(writer 薄壳)", () => {
  it("落盘行为与 runner 直写时代逐字节等价:summary.json 键序/瘦身/携带条目原样, artifact 文件按需紧凑写", async () => {
    const root = await makeRoot();
    const rep = Artifacts(root);
    await rep.onRunStart?.([], {} as never);

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
      assertions: [{ kind: "contains", ok: true } as never],
      usage: { inputTokens: 10, outputTokens: 5 },
      estimatedCostUSD: 0.5,
      events: [{ type: "message", role: "assistant", text: "hi" } as never],
      sources: [{ path: "evals/a.ts", content: "x" }],
      trace: [{ name: "turn", kind: "turn" } as never],
      o11y: { toolCalls: 2 } as never,
      diff: { generatedFiles: { "a.txt": "1" }, deletedFiles: [] },
      rawTranscript: "raw",
    };
    const noArtifacts: EvalResult = {
      id: "algebra/q2",
      agent: "bub",
      verdict: "failed",
      attempt: 1,
      durationMs: 10,
      assertions: [],
      events: [],
    };
    // --resume 携带条目: artifactBase 指向原 run,has* 真值原样携带,不得重算或编造 artifactsDir。
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
      artifactBase: "2026-06-30T08-00-00-000Z/algebra/q3/bub/gpt-5.4/compare_bub/a1",
      hasEvents: true,
      hasTrace: false,
      hasSources: true,
    };

    await rep.onEvalComplete?.(fresh);
    await rep.onEvalComplete?.(noArtifacts);
    await rep.onRunComplete?.({
      name: "demo",
      agent: "bub",
      startedAt: "2026-07-01T08:00:00.000Z",
      completedAt: "2026-07-01T08:10:00.000Z",
      passed: 2,
      failed: 1,
      skipped: 0,
      errored: 0,
      durationMs: 600000,
      usage: { inputTokens: 10, outputTokens: 5 },
      estimatedCostUSD: 0.5,
      results: [carried, fresh, noArtifacts],
    });

    const dir = rep.outputDir();
    const version = (JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf-8")) as { version: string }).version;

    // 基线由改造前的实现捕获(runner 直写时代的真实输出),薄壳必须逐字节还原它。
    const expected = `{
  "format": "niceeval.results",
  "schemaVersion": ${RESULTS_SCHEMA_VERSION},
  "producer": {
    "name": "niceeval",
    "version": "${version}"
  },
  "name": "demo",
  "agent": "bub",
  "startedAt": "2026-07-01T08:00:00.000Z",
  "completedAt": "2026-07-01T08:10:00.000Z",
  "passed": 2,
  "failed": 1,
  "skipped": 0,
  "errored": 0,
  "durationMs": 600000,
  "usage": {
    "inputTokens": 10,
    "outputTokens": 5
  },
  "estimatedCostUSD": 0.5,
  "results": [
    {
      "id": "algebra/q3",
      "experimentId": "compare/bub",
      "agent": "bub",
      "model": "gpt-5.4",
      "verdict": "passed",
      "attempt": 1,
      "startedAt": "2026-06-30T08:01:00.000Z",
      "durationMs": 99,
      "assertions": [],
      "artifactBase": "2026-06-30T08-00-00-000Z/algebra/q3/bub/gpt-5.4/compare_bub/a1",
      "hasEvents": true,
      "hasTrace": false,
      "hasSources": true
    },
    {
      "id": "algebra/q1",
      "experimentId": "compare/bub",
      "experiment": {
        "id": "compare/bub",
        "flags": {
          "style": "concise"
        }
      },
      "agent": "bub",
      "model": "gpt-5.4",
      "verdict": "passed",
      "fingerprint": "abc",
      "attempt": 1,
      "startedAt": "2026-07-01T08:01:00.000Z",
      "durationMs": 1234,
      "assertions": [
        {
          "kind": "contains",
          "ok": true
        }
      ],
      "usage": {
        "inputTokens": 10,
        "outputTokens": 5
      },
      "estimatedCostUSD": 0.5,
      "artifactsDir": "algebra/q1/bub/gpt-5.4/compare_bub/a1",
      "hasTrace": true,
      "hasEvents": true,
      "hasSources": true
    },
    {
      "id": "algebra/q2",
      "agent": "bub",
      "verdict": "failed",
      "attempt": 1,
      "durationMs": 10,
      "assertions": [],
      "artifactsDir": "algebra/q2/bub/default/a1",
      "hasTrace": false,
      "hasEvents": false,
      "hasSources": false
    }
  ],
  "outputDir": "${dir}"
}`;
    expect(await readFile(join(dir, "summary.json"), "utf-8")).toBe(expected);

    // artifact:紧凑 JSON,按需生成(q2 全空不落文件;q1 五类都在)。
    const q1Dir = join(dir, "algebra/q1/bub/gpt-5.4/compare_bub/a1");
    expect(await readFile(join(q1Dir, "events.json"), "utf-8")).toBe('[{"type":"message","role":"assistant","text":"hi"}]');
    expect(await readFile(join(q1Dir, "sources.json"), "utf-8")).toBe('[{"path":"evals/a.ts","content":"x"}]');
    expect(await readFile(join(q1Dir, "trace.json"), "utf-8")).toBe('[{"name":"turn","kind":"turn"}]');
    expect(await readFile(join(q1Dir, "o11y.json"), "utf-8")).toBe('{"toolCalls":2}');
    expect(await readFile(join(q1Dir, "diff.json"), "utf-8")).toBe('{"generatedFiles":{"a.txt":"1"},"deletedFiles":[]}');
    expect(await exists(join(dir, "algebra/q2/bub/default/a1/events.json"))).toBe(false);
  });
});
