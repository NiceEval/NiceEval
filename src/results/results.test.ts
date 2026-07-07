// niceeval/results 读取面的单测:临时目录里手工构造最小 summary.json / 工件 fixture,
// 覆盖快照切片、latest-per-experiment、残缺警告、resume 去重、版本 skipped、懒加载。
// fixture 的目录名/工件路径全部手写(不 import 库的路径函数),让测试独立于实现充当格式基准。

import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  RESULTS_FORMAT,
  RESULTS_SCHEMA_VERSION,
  copyRun,
  dedupeAttempts,
  latestPerExperiment,
  openResults,
  type EvalResult,
  type RunSummary,
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

function res(over: Partial<EvalResult> & Pick<EvalResult, "id" | "agent">): EvalResult {
  return { outcome: "passed", attempt: 1, durationMs: 1000, assertions: [], ...over };
}

function summaryOf(results: EvalResult[], over: Partial<RunSummary> = {}): RunSummary {
  const count = (o: EvalResult["outcome"]) => results.filter((r) => r.outcome === o).length;
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

// ───────────────────────── 测试 ─────────────────────────

describe("openResults · 快照切片", () => {
  it("一个 run 装两个 experiment:按 experimentId 切成两个快照,agent/model/evalIds 取自切片自身", async () => {
    const root = await makeRoot();
    await writeRun(root, "2026-07-01T08-00-00-000Z", summaryOf([
      res({ id: "algebra/q1", agent: "bub", model: "gpt-5", experimentId: "compare/bub", startedAt: "2026-07-01T08:01:00.000Z" }),
      res({ id: "algebra/q2", agent: "bub", model: "gpt-5", experimentId: "compare/bub", outcome: "failed" }),
      res({ id: "algebra/q1", agent: "codex", model: "o3", experimentId: "compare/codex" }),
    ]));

    const results = await openResults(root);
    expect(results.runs).toHaveLength(1);
    expect(results.skipped).toHaveLength(0);
    expect(results.warnings).toHaveLength(0);
    expect(results.snapshots).toHaveLength(2);

    const bub = results.snapshots.find((s) => s.experimentId === "compare/bub")!;
    expect(bub.agent).toBe("bub");
    expect(bub.model).toBe("gpt-5");
    expect(bub.attempts).toHaveLength(2);
    expect(bub.evalIds).toEqual(["algebra/q1", "algebra/q2"]);
    expect(bub.startedAt).toBe(results.runs[0].summary.startedAt);
    expect(bub.run).toBe(results.runs[0]);

    const codex = results.snapshots.find((s) => s.experimentId === "compare/codex")!;
    expect(codex.agent).toBe("codex");
    expect(codex.model).toBe("o3");
    expect(codex.attempts).toHaveLength(1);
  });

  it("experimentId 缺失时以 <agent>/<model> 合成快照键,并出英文 warning(无 model 用 default)", async () => {
    const root = await makeRoot();
    await writeRun(root, "2026-07-01T08-00-00-000Z", summaryOf([
      res({ id: "q1", agent: "codex" }),
      res({ id: "q2", agent: "codex" }),
    ]));

    const results = await openResults(root);
    expect(results.snapshots).toHaveLength(1);
    expect(results.snapshots[0].experimentId).toBe("codex/default");
    expect(results.warnings).toHaveLength(1);
    expect(results.warnings[0]).toMatch(/without experimentId/);
    expect(results.warnings[0]).toMatch(/"codex\/default"/);
  });
});

describe("latestPerExperiment", () => {
  it("跨两个 run 各取所属:每个 experiment 拿自己最新的快照", async () => {
    const root = await makeRoot();
    const monday = await writeRun(root, "2026-07-01T08-00-00-000Z", summaryOf([
      res({ id: "q1", agent: "bub", experimentId: "mid/a" }),
      res({ id: "q2", agent: "bub", experimentId: "mid/a" }),
      res({ id: "q1", agent: "codex", experimentId: "mid/b" }),
      res({ id: "q2", agent: "codex", experimentId: "mid/b" }),
    ], { startedAt: "2026-07-01T08:00:00.000Z" }));
    const tuesday = await writeRun(root, "2026-07-02T08-00-00-000Z", summaryOf([
      res({ id: "q1", agent: "codex", experimentId: "mid/b" }),
      res({ id: "q2", agent: "codex", experimentId: "mid/b" }),
    ], { startedAt: "2026-07-02T08:00:00.000Z" }));

    const all = await openResults(root);
    const { snapshots, warnings } = latestPerExperiment(all.snapshots);
    expect(warnings).toHaveLength(0);
    expect(snapshots.map((s) => s.experimentId)).toEqual(["mid/a", "mid/b"]);
    expect(snapshots.find((s) => s.experimentId === "mid/a")!.run.dir).toBe(monday);
    expect(snapshots.find((s) => s.experimentId === "mid/b")!.run.dir).toBe(tuesday);

    // experiments 前缀过滤,同 CLI 语义;尾斜杠写法等价。
    expect(latestPerExperiment(all.snapshots, { experiments: "mid/a" }).snapshots).toHaveLength(1);
    expect(latestPerExperiment(all.snapshots, { experiments: "mid/" }).snapshots).toHaveLength(2);
    expect(latestPerExperiment(all.snapshots, { experiments: "other" }).snapshots).toHaveLength(0);
  });

  it("最新快照残缺(只重跑了一道题)时生成 covers x of y 警告,仍返回该快照", async () => {
    const root = await makeRoot();
    await writeRun(root, "2026-07-01T08-00-00-000Z", summaryOf([
      res({ id: "algebra/q1", agent: "bub", experimentId: "midterm/bub-gpt-5.4" }),
      res({ id: "algebra/q2", agent: "bub", experimentId: "midterm/bub-gpt-5.4" }),
      res({ id: "algebra/q3", agent: "bub", experimentId: "midterm/bub-gpt-5.4" }),
    ], { startedAt: "2026-07-01T08:00:00.000Z" }));
    await writeRun(root, "2026-07-05T08-00-00-000Z", summaryOf([
      res({ id: "algebra/q1", agent: "bub", experimentId: "midterm/bub-gpt-5.4" }),
    ], { startedAt: "2026-07-05T08:00:00.000Z" }));

    const all = await openResults(root);
    const { snapshots, warnings } = latestPerExperiment(all.snapshots);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].startedAt).toBe("2026-07-05T08:00:00.000Z");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^warning: snapshot "midterm\/bub-gpt-5\.4" @ 2026-07-05T08:00:00\.000Z covers 1 of 3 evals seen in history\./);
    expect(warnings[0]).toMatch(/Re-run `niceeval exp midterm\/bub-gpt-5\.4` for a full snapshot/);
  });
});

describe("dedupeAttempts", () => {
  it("resume 原样合入的重复 attempt 按身份键去重,保留最新 run 的那份;缺 startedAt 不去重并出 warning", async () => {
    const root = await makeRoot();
    // 周一:q1 通过、q2 失败;q3 没有 startedAt(异常数据)。
    const monday = await writeRun(root, "2026-07-01T08-00-00-000Z", summaryOf([
      res({ id: "q1", agent: "bub", experimentId: "e", startedAt: "2026-07-01T08:01:00.000Z" }),
      res({ id: "q2", agent: "bub", experimentId: "e", outcome: "failed", startedAt: "2026-07-01T08:02:00.000Z" }),
      res({ id: "q3", agent: "bub", experimentId: "e" }),
    ], { startedAt: "2026-07-01T08:00:00.000Z" }));
    // 周二 --resume:q1 原样合入(身份键完全相同),q2 重跑出新 startedAt,q3 依旧没有 startedAt。
    const tuesday = await writeRun(root, "2026-07-02T08-00-00-000Z", summaryOf([
      res({ id: "q1", agent: "bub", experimentId: "e", startedAt: "2026-07-01T08:01:00.000Z" }),
      res({ id: "q2", agent: "bub", experimentId: "e", startedAt: "2026-07-02T08:02:00.000Z" }),
      res({ id: "q3", agent: "bub", experimentId: "e" }),
    ], { startedAt: "2026-07-02T08:00:00.000Z" }));

    const all = await openResults(root);
    const attempts = all.snapshots.flatMap((s) => s.attempts);
    expect(attempts).toHaveLength(6);

    const { attempts: deduped, warnings } = dedupeAttempts(attempts);
    // q1 合并成一条;q2 两条(startedAt 不同,是两次真实运行);q3 两条(缺 startedAt,不敢去重)。
    expect(deduped).toHaveLength(5);
    const q1 = deduped.filter((a) => a.result.id === "q1");
    expect(q1).toHaveLength(1);
    expect(q1[0].run.dir).toBe(tuesday);
    expect(deduped.filter((a) => a.result.id === "q2")).toHaveLength(2);
    expect(deduped.filter((a) => a.result.id === "q3")).toHaveLength(2);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatch(/"q3".*has no startedAt/);
    void monday;
  });
});

describe("openResults · 版本与坏文件", () => {
  it("schemaVersion 不匹配进 skipped 带 producerVersion;坏 JSON 记 malformed;无关 JSON 静默忽略;legacy 无信封照读", async () => {
    const root = await makeRoot();
    const incompatible = await writeRun(root, "2026-07-03T08-00-00-000Z", {
      format: RESULTS_FORMAT,
      schemaVersion: RESULTS_SCHEMA_VERSION + 1,
      producer: { name: "niceeval", version: "9.9.9" },
      startedAt: "2026-07-03T08:00:00.000Z",
      results: [],
    });
    await writeRun(root, "2026-07-04T08-00-00-000Z", "not json {");
    await writeRun(root, "unrelated", { hello: 1 });
    // 只有 results 键、没有 startedAt:不满足 legacy 启发式,按无关 JSON 静默忽略(不进 skipped)
    await writeRun(root, "alien-results", { results: [] });
    await writeRun(root, "2026-07-01T08-00-00-000Z", summaryOf([res({ id: "q1", agent: "bub", experimentId: "e" })]));
    // legacy:引入版本号之前的存量报告,没有 format 信封,按 schemaVersion 1 读。
    const legacy = summaryOf([res({ id: "q1", agent: "bub", experimentId: "old" })], { startedAt: "2026-06-01T08:00:00.000Z" });
    delete legacy.format;
    delete legacy.schemaVersion;
    delete legacy.producer;
    await writeRun(root, "2026-06-01T08-00-00-000Z", legacy);

    const results = await openResults(root);
    expect(results.runs).toHaveLength(2);
    expect(results.skipped).toHaveLength(2);

    const versionSkip = results.skipped.find((s) => s.reason === "incompatible-version")!;
    expect(versionSkip.dir).toBe(incompatible);
    expect(versionSkip.schemaVersion).toBe(RESULTS_SCHEMA_VERSION + 1);
    expect(versionSkip.producerVersion).toBe("9.9.9");

    const malformed = results.skipped.find((s) => s.reason === "malformed")!;
    expect(malformed.detail).toBe("invalid JSON");
  });
});

describe("AttemptHandle · 懒加载", () => {
  it("缺文件返回 null 不抛错;读过一次即缓存(文件删了也还在);没有 artifactsDir 时全部为 null", async () => {
    const root = await makeRoot();
    const runDir = await writeRun(root, "2026-07-01T08-00-00-000Z", summaryOf([
      res({ id: "q1", agent: "bub", model: "gpt-5", experimentId: "e", artifactsDir: "q1/bub/gpt-5/a1", hasEvents: true }),
      res({ id: "q2", agent: "bub", model: "gpt-5", experimentId: "e" }),
    ]));
    const eventsPath = await writeArtifact(runDir, "q1/bub/gpt-5/a1", "events.json", [
      { type: "message", role: "assistant", text: "hi" },
    ]);

    const results = await openResults(root);
    const [q1, q2] = results.runs[0].attempts;

    // ref 契约:run 目录名 + summary.results 下标,Reports 的 refs 与 view 深链直接可用
    expect(q1.ref).toEqual({ run: "2026-07-01T08-00-00-000Z", result: 0 });
    expect(q2.ref).toEqual({ run: "2026-07-01T08-00-00-000Z", result: 1 });

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

    // 条目没有 artifactsDir(异常/极简数据):不猜路径,全部 null。
    expect(await q2.events()).toBeNull();
    expect(await q2.diff()).toBeNull();
  });
});

describe("copyRun", () => {
  it("按指定工件种类复制选中快照,重建的 summary 只含选中条目并保留版本元数据;产物可被 openResults 回读", async () => {
    const root = await makeRoot();
    const monday = await writeRun(root, "2026-07-01T08-00-00-000Z", summaryOf([
      res({ id: "q1", agent: "bub", model: "gpt-5", experimentId: "compare/bub", artifactsDir: "q1/bub/gpt-5/a1", hasEvents: true, hasTrace: true, startedAt: "2026-07-01T08:01:00.000Z", estimatedCostUSD: 0.5, usage: { inputTokens: 10, outputTokens: 5 } }),
      res({ id: "q1", agent: "codex", model: "o3", experimentId: "compare/codex", artifactsDir: "q1/codex/o3/a1", hasEvents: true, outcome: "failed", estimatedCostUSD: 0.25, usage: { inputTokens: 20, outputTokens: 2 } }),
    ], { startedAt: "2026-07-01T08:00:00.000Z" }));
    await writeArtifact(monday, "q1/bub/gpt-5/a1", "events.json", [{ type: "message" }]);
    await writeArtifact(monday, "q1/bub/gpt-5/a1", "trace.json", [{ name: "turn" }]);
    await writeArtifact(monday, "q1/bub/gpt-5/a1", "diff.json", { generatedFiles: {}, deletedFiles: [] });
    await writeArtifact(monday, "q1/codex/o3/a1", "events.json", [{ type: "message" }]);
    const tuesday = await writeRun(root, "2026-07-02T08-00-00-000Z", summaryOf([
      res({ id: "q1", agent: "bub", model: "gpt-5", experimentId: "compare/bub", artifactsDir: "q1/bub/gpt-5/a1", hasEvents: true, startedAt: "2026-07-02T08:01:00.000Z" }),
    ], { startedAt: "2026-07-02T08:00:00.000Z" }));
    await writeArtifact(tuesday, "q1/bub/gpt-5/a1", "events.json", [{ type: "message" }, { type: "message" }]);

    const all = await openResults(root);
    const picked = latestPerExperiment(all.snapshots, { experiments: "compare/" });
    const dest = join(await makeRoot(), "site/data/run");
    const copied = await copyRun(picked.snapshots, dest, { artifacts: ["events", "sources"] });

    expect(copied.warnings).toHaveLength(0);
    expect(copied.summary.format).toBe(RESULTS_FORMAT);
    expect(copied.summary.schemaVersion).toBe(RESULTS_SCHEMA_VERSION);
    expect(copied.summary.producer?.version).toBe("0.3.0");
    expect(copied.summary.results).toHaveLength(2);
    expect(copied.summary.passed).toBe(1);
    expect(copied.summary.failed).toBe(1);
    // bub 取周二那份(最新),codex 取周一那份。
    const bubEntry = copied.summary.results.find((r) => r.experimentId === "compare/bub")!;
    expect(bubEntry.startedAt).toBe("2026-07-02T08:01:00.000Z");
    expect(bubEntry.hasEvents).toBe(true);
    expect(bubEntry.hasTrace).toBe(false); // trace 没被选中,存在标记按目标目录重算

    // 磁盘:只有选中的工件种类被复制。
    // 目标目录带 experiment 段(与 writer 的 attemptDir 同规则),源 fixture 的旧式路径靠 artifactsDir 定位
    expect(await exists(join(dest, "q1/bub/gpt-5/compare_bub/a1/events.json"))).toBe(true);
    expect(await exists(join(dest, "q1/bub/gpt-5/compare_bub/a1/trace.json"))).toBe(false);
    expect(await exists(join(dest, "q1/bub/gpt-5/compare_bub/a1/diff.json"))).toBe(false);
    expect(await exists(join(dest, "q1/codex/o3/compare_codex/a1/events.json"))).toBe(true);

    // 回读:产物是合法 run 目录,懒加载语义不变。
    const reopened = await openResults(dest);
    expect(reopened.runs).toHaveLength(1);
    expect(reopened.snapshots.map((s) => s.experimentId).sort()).toEqual(["compare/bub", "compare/codex"]);
    const bubAttempt = reopened.snapshots.find((s) => s.experimentId === "compare/bub")!.attempts[0];
    expect(await bubAttempt.events()).toHaveLength(2);
    expect(await bubAttempt.trace()).toBeNull();

    // 同一 experiment 的两个快照(未 dedupe)落到同一工件目录:保留最新并出 warning。
    const bubSnapshots = all.snapshots.filter((s) => s.experimentId === "compare/bub");
    expect(bubSnapshots).toHaveLength(2);
    const dest2 = join(await makeRoot(), "run2");
    const collided = await copyRun(bubSnapshots, dest2);
    expect(collided.warnings).toHaveLength(1);
    expect(collided.warnings[0]).toMatch(/multiple attempts map to "q1\/bub\/gpt-5\/compare_bub\/a1"/);
    expect(collided.summary.results).toHaveLength(1);
    expect(collided.summary.results[0].startedAt).toBe("2026-07-02T08:01:00.000Z");
  });

  it("同 agent 同 model 只差 experiment 的两个实验互不覆盖(目录带 experiment 段)", async () => {
    // memory-evals 的典型配对:bub-gpt-5.4 vs bub-gpt-5.4--agents-md,只差 flags。
    // attemptDirOf 少了 experiment 段时,这两份工件会在拷贝时碰撞、其中一份被静默丢弃。
    const root = await makeRoot();
    const run = await writeRun(root, "2026-07-01T08-00-00-000Z", summaryOf([
      res({ id: "q1", agent: "bub", model: "gpt-5.4", experimentId: "compare/bub", artifactsDir: "q1/bub/gpt-5.4/compare_bub/a1", hasEvents: true }),
      res({ id: "q1", agent: "bub", model: "gpt-5.4", experimentId: "compare/bub--agents-md", artifactsDir: "q1/bub/gpt-5.4/compare_bub--agents-md/a1", hasEvents: true }),
    ]));
    await writeArtifact(run, "q1/bub/gpt-5.4/compare_bub/a1", "events.json", [{ n: 1 }]);
    await writeArtifact(run, "q1/bub/gpt-5.4/compare_bub--agents-md/a1", "events.json", [{ n: 2 }]);

    const all = await openResults(root);
    const dest = join(await makeRoot(), "pair");
    const copied = await copyRun(all.snapshots, dest);
    expect(copied.warnings).toHaveLength(0);
    expect(copied.summary.results).toHaveLength(2);
    expect(await exists(join(dest, "q1/bub/gpt-5.4/compare_bub/a1/events.json"))).toBe(true);
    expect(await exists(join(dest, "q1/bub/gpt-5.4/compare_bub--agents-md/a1/events.json"))).toBe(true);
  });
});
