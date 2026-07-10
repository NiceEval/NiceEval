// view 数据层(data.ts)的单测:loader 收编到 openResults、统计收编到官方计算函数之后,
// 守护三件事——skipped 三种原因如实进 viewData(producer 感知的 npx 提示)、榜单是
// results.latest() 口径(不再跨历史合并)、跨快照去重让 Runs/Traces 不被 --resume 复印件灌票。
// 另含 loadLatestResultsPerEval 的续跑携带语义(从旧 loader.test.ts 移植,口径不变)。

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { IncompatibleResultsError, ViewInputError, loadLatestResultsPerEval, loadViewScan } from "./data.ts";
import { createRunWriter } from "../results/index.ts";
import { RESULTS_FORMAT, RESULTS_SCHEMA_VERSION, type EvalResult, type RunSummary } from "../types.ts";

const roots: string[] = [];
async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "niceeval-viewdata-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

function res(over: Partial<EvalResult> & Pick<EvalResult, "id" | "agent">): EvalResult {
  return { outcome: "passed", attempt: 0, durationMs: 1000, assertions: [], ...over };
}

function summaryOf(results: EvalResult[], over: Partial<RunSummary> = {}): RunSummary {
  const count = (o: EvalResult["outcome"]) => results.filter((r) => r.outcome === o).length;
  return {
    format: RESULTS_FORMAT,
    schemaVersion: RESULTS_SCHEMA_VERSION,
    producer: { name: "niceeval", version: "0.4.0" },
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
  await writeFile(join(dir, "summary.json"), typeof summary === "string" ? summary : JSON.stringify(summary), "utf-8");
  return dir;
}

describe("loadViewScan · skipped 三种原因进 viewData", () => {
  it("incompatible-version / malformed / incomplete 都进 skippedRuns;niceeval 落盘拼 npx 命令,第三方如实报名字不拼", async () => {
    const root = await makeRoot();
    // 正常 run,页面照常渲染。
    await writeRun(root, "2026-07-01T08-00-00-000Z", summaryOf([res({ id: "q1", agent: "bub", experimentId: "exp/a", startedAt: "2026-07-01T08:01:00.000Z" })]));
    // 版本不同:niceeval 写的。
    await writeRun(root, "2026-07-02T08-00-00-000Z", summaryOf([], { schemaVersion: 999, producer: { name: "niceeval", version: "9.9.9" } }));
    // 版本不同:第三方 harness 写的。
    await writeRun(root, "2026-07-03T08-00-00-000Z", summaryOf([], { schemaVersion: 999, producer: { name: "otherharness", version: "1.2.3" } }));
    // 坏 JSON。
    await writeRun(root, "2026-07-04T08-00-00-000Z", "{not json");
    // incomplete:有 attempt 工件、没有 summary(run 中途 crash)。
    await mkdir(join(root, "2026-07-05T08-00-00-000Z", "q1", "bub", "default", "a0"), { recursive: true });
    await writeFile(join(root, "2026-07-05T08-00-00-000Z", "q1", "bub", "default", "a0", "events.json"), "[]", "utf-8");

    const { viewData } = await loadViewScan(root);
    const byReason = new Map(viewData.skippedRuns!.map((s) => [s.dir, s]));
    expect(viewData.skippedRuns).toHaveLength(4);

    const niceevalSkip = [...byReason.values()].find((s) => s.producerName === "niceeval" && s.reason === "incompatible-version")!;
    expect(niceevalSkip.schemaVersion).toBe(999);
    expect(niceevalSkip.command).toContain("npx niceeval@9.9.9 view ");

    const foreignSkip = [...byReason.values()].find((s) => s.producerName === "otherharness")!;
    expect(foreignSkip.reason).toBe("incompatible-version");
    expect(foreignSkip.producerVersion).toBe("1.2.3");
    expect(foreignSkip.command).toBeUndefined(); // 第三方版本号拼 npx 是一句错误提示,不拼

    const malformed = [...byReason.values()].find((s) => s.reason === "malformed")!;
    expect(malformed.detail).toBe("invalid JSON");

    const incomplete = [...byReason.values()].find((s) => s.reason === "incomplete")!;
    expect(incomplete.dir).toContain("2026-07-05T08-00-00-000Z");

    // 正常 run 照常进榜单,坏 run 不拖垮整页。
    expect(viewData.table.rows.map((r) => r.key)).toEqual(["exp/a"]);
  });

  it("单文件模式指向版本不同的报告:抛 IncompatibleResultsError(CLI 打印提示退出)", async () => {
    const root = await makeRoot();
    const dir = await writeRun(root, "2026-07-02T08-00-00-000Z", summaryOf([], { schemaVersion: 999, producer: { name: "niceeval", version: "9.9.9" } }));
    await expect(loadViewScan(join(dir, "summary.json"))).rejects.toBeInstanceOf(IncompatibleResultsError);
  });
});

describe("loadViewScan · 榜单是 latest 口径,不再跨历史合并", () => {
  it("同一实验两次 run:榜单格子只反映最新快照;partial-coverage 警告经 overview.warnings 透传", async () => {
    const root = await makeRoot();
    // 周一全量:q1 失败、q2 通过。
    await writeRun(root, "2026-07-01T08-00-00-000Z", summaryOf([
      res({ id: "q1", agent: "bub", experimentId: "exp/a", outcome: "failed", startedAt: "2026-07-01T08:01:00.000Z" }),
      res({ id: "q2", agent: "bub", experimentId: "exp/a", startedAt: "2026-07-01T08:02:00.000Z" }),
    ], { startedAt: "2026-07-01T08:00:00.000Z" }));
    // 周二只补跑 q1(通过):latest 快照只盖 1/2 道题。
    await writeRun(root, "2026-07-02T08-00-00-000Z", summaryOf([
      res({ id: "q1", agent: "bub", experimentId: "exp/a", startedAt: "2026-07-02T08:01:00.000Z" }),
    ], { startedAt: "2026-07-02T08:00:00.000Z" }));

    const { viewData } = await loadViewScan(root);
    const row = viewData.table.rows.find((r) => r.key === "exp/a")!;
    // 旧的 aggregateRows 会把两次 run 揉在一起(q1 一败一过);latest 口径只看周二快照:全过。
    expect(row.cells["pass-rate"]!.value).toBe(1);
    expect(row.cells["pass-rate"]!.refs.length).toBe(1);

    // 快照元信息:latest 标记 + 每行可标注判决时间。
    const latest = viewData.snapshots.filter((s) => s.latest);
    expect(latest).toHaveLength(1);
    expect(latest[0]!.startedAt).toBe("2026-07-02T08:00:00.000Z");
    expect(viewData.composedRuns).toBe(1);
    expect(viewData.lastRunAt).toBe("2026-07-02T08:00:00.000Z");

    // 挑选警告随 OverviewData 进前端,不静默。
    const kinds = viewData.overview.warnings.map((w) => w.kind);
    expect(kinds).toContain("partial-coverage");
    const partial = viewData.overview.warnings.find((w) => w.kind === "partial-coverage")!;
    expect(partial.message).toContain("1 of 2");

    // 历史快照仍在(Runs / Traces 吃全部),但不是 latest。
    const historical = viewData.snapshots.filter((s) => !s.latest);
    expect(historical).toHaveLength(1);
    expect(historical[0]!.results.map((r) => r.id).sort()).toEqual(["q1", "q2"]);
  });

  it("缺 experimentId 的落盘:合成键快照 synthetic: true,synthetic-experiment-id 警告透传", async () => {
    const root = await makeRoot();
    await writeRun(root, "2026-07-01T08-00-00-000Z", summaryOf([
      res({ id: "q1", agent: "bub", model: "gpt-5", startedAt: "2026-07-01T08:01:00.000Z" }),
    ]));
    const { viewData } = await loadViewScan(root);
    expect(viewData.snapshots[0]!.synthetic).toBe(true);
    expect(viewData.snapshots[0]!.experimentId).toBe("bub/gpt-5");
    expect(viewData.overview.warnings.map((w) => w.kind)).toContain("synthetic-experiment-id");
  });
});

describe("loadViewScan · 跨快照去重(--resume 携带的复印件只算一次)", () => {
  it("同一 attempt 存在于两份落盘:只保留最新 run 里的那份,attemptRef 落在最新落盘,artifactBase 沿用原 run 工件", async () => {
    const root = await makeRoot();
    const original = res({
      id: "q1",
      agent: "bub",
      experimentId: "exp/a",
      startedAt: "2026-07-01T08:01:00.000Z",
      artifactsDir: "artifacts/q1/bub/default/a0",
      hasEvents: true,
    });
    const oldRun = await writeRun(root, "2026-07-01T08-00-00-000Z", summaryOf([original], { startedAt: "2026-07-01T08:00:00.000Z" }));
    await mkdir(join(oldRun, "artifacts/q1/bub/default/a0"), { recursive: true });
    await writeFile(join(oldRun, "artifacts/q1/bub/default/a0/events.json"), "[]", "utf-8");
    // 携带条目:artifactsDir 清空,artifactBase 指向原 run 的工件目录(runner 的 carriedResults 形状)。
    const carried = { ...original, artifactsDir: undefined, artifactBase: "2026-07-01T08-00-00-000Z/artifacts/q1/bub/default/a0" };
    await writeRun(root, "2026-07-02T08-00-00-000Z", summaryOf([
      carried,
      res({ id: "q2", agent: "bub", experimentId: "exp/a", startedAt: "2026-07-02T08:02:00.000Z", artifactsDir: "artifacts/q2/bub/default/a0" }),
    ], { startedAt: "2026-07-02T08:00:00.000Z" }));

    const { viewData, artifactDirs } = await loadViewScan(root);
    // 全部快照(Runs/Traces 的数据面)里 q1 只出现一次:复印件不灌票。
    const allResults = viewData.snapshots.flatMap((s) => s.results);
    expect(allResults.filter((r) => r.id === "q1")).toHaveLength(1);
    const q1 = allResults.find((r) => r.id === "q1")!;
    expect(q1.attemptRef).toEqual({ run: "2026-07-02T08-00-00-000Z", result: 0 }); // 证据身份跟着最新落盘走
    expect(q1.artifactBase).toBe("2026-07-01T08-00-00-000Z/artifacts/q1/bub/default/a0"); // 工件仍指原 run
    // 静态导出(--out)能把携带条目的工件一并带走。
    expect(artifactDirs.get("2026-07-01T08-00-00-000Z/artifacts/q1/bub/default/a0")).toBe(join(oldRun, "artifacts/q1/bub/default/a0"));
    // 条目全被吸走的旧快照不再出现。
    expect(viewData.snapshots.filter((s) => !s.latest)).toHaveLength(0);
  });
});

describe("loadViewScan · createRunWriter 写出的落盘直接可读(writer/reader 同一契约)", () => {
  it("writer roundtrip:官方榜单、快照与 attemptRef 都从写入面产物算出", async () => {
    const root = await makeRoot();
    const writer = await createRunWriter(root, { producer: { name: "niceeval", version: "0.4.6" } });
    const snap = writer.snapshot({
      experiment: "compare/bub",
      agent: "bub",
      model: "gpt-5",
      startedAt: "2026-07-03T08:00:00.000Z",
    });
    await snap.writeAttempt(
      { id: "q1", outcome: "passed", attempt: 0, durationMs: 1200, assertions: [], estimatedCostUSD: 0.5 },
      { events: [{ type: "run.started", t: 0 } as never] },
    );
    await snap.writeAttempt({ id: "q2", outcome: "failed", attempt: 0, durationMs: 800, assertions: [] });
    await writer.finish();

    const { viewData } = await loadViewScan(root);
    expect(viewData.table.rows.map((r) => r.key)).toEqual(["compare/bub"]);
    expect(viewData.table.rows[0]!.cells["pass-rate"]!.value).toBe(0.5);
    expect(viewData.overview.totals.evals).toBe(2);
    const snapshot = viewData.snapshots[0]!;
    expect(snapshot.latest).toBe(true);
    expect(snapshot.agent).toBe("bub");
    expect(snapshot.results.every((r) => r.attemptRef?.run === snapshot.run)).toBe(true);
    // 写入面拆出的工件,读取面拼回相对 view 根的 artifactBase。
    const q1 = snapshot.results.find((r) => r.id === "q1")!;
    expect(q1.hasEvents).toBe(true);
    expect(q1.artifactBase).toBe(`${snapshot.run}/${q1.artifactsDir}`);
  });
});

describe("loadLatestResultsPerEval(续跑携带基线,口径与旧 loader 一致)", () => {
  it("部分补跑 run 只遮蔽它跑过的 eval,其它 eval 仍取自更早的全量 run", async () => {
    const root = await makeRoot();
    await writeRun(root, "2026-01-01T00-00-00", summaryOf([
      res({ id: "e1", agent: "a", experimentId: "exp/a" }),
      res({ id: "e2", agent: "a", experimentId: "exp/a", outcome: "errored" }),
      res({ id: "e1", agent: "a", experimentId: "exp/b" }),
    ], { startedAt: "2026-01-01T00:00:00.000Z" }));
    // 部分补跑:只重跑了 exp/a 的 e2
    await writeRun(root, "2026-01-02T00-00-00", summaryOf([
      res({ id: "e2", agent: "a", experimentId: "exp/a" }),
    ], { startedAt: "2026-01-02T00:00:00.000Z" }));

    const results = await loadLatestResultsPerEval(root);
    const byKey = new Map(results.map((r) => [`${r.experimentId}|${r.id}`, r.outcome]));
    expect(byKey.get("exp/a|e1")).toBe("passed"); // 来自旧全量 run,没被部分 run 冲掉
    expect(byKey.get("exp/a|e2")).toBe("passed"); // 来自补跑 run(最新)
    expect(byKey.get("exp/b|e1")).toBe("passed");
    expect(results).toHaveLength(3);
  });

  it("同 (experiment, eval) 多 attempt 整批取自含它的最新 run,不跨 run 混装;artifactBase 已拼好", async () => {
    const root = await makeRoot();
    await writeRun(root, "2026-01-01T00-00-00", summaryOf([
      res({ id: "e1", agent: "a", experimentId: "exp/a", fingerprint: "old" }),
    ], { startedAt: "2026-01-01T00:00:00.000Z" }));
    await writeRun(root, "2026-01-02T00-00-00", summaryOf([
      res({ id: "e1", agent: "a", experimentId: "exp/a", outcome: "failed", fingerprint: "new", artifactsDir: "artifacts/e1/a0" }),
      res({ id: "e1", agent: "a", experimentId: "exp/a", attempt: 1, fingerprint: "new" }),
    ], { startedAt: "2026-01-02T00:00:00.000Z" }));

    const results = await loadLatestResultsPerEval(root);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.fingerprint === "new")).toBe(true);
    // runner 携带条目时依赖 artifactBase(相对结果根)可解析,view 才找得回工件。
    const withArtifacts = results.find((r) => r.artifactsDir)!;
    expect(withArtifacts.artifactBase).toBe("2026-01-02T00-00-00/artifacts/e1/a0");
  });
});

describe("loadViewScan · 零可读结果直说,不渲染空页面", () => {
  it("目录真空:抛 ViewInputError,给「先跑一轮」提示(与 show 同文案)", async () => {
    const root = await makeRoot();
    await expect(loadViewScan(root)).rejects.toBeInstanceOf(ViewInputError);
    await expect(loadViewScan(root)).rejects.toThrow(/niceeval exp/);
  });

  it("全被跳过:错误逐条列目录与原因,niceeval 落盘的 schemaVersion 场景给出可跑的 npx 命令", async () => {
    const root = await makeRoot();
    await writeRun(root, "2026-07-02T08-00-00-000Z", summaryOf([], { schemaVersion: 999, producer: { name: "niceeval", version: "9.9.9" } }));
    await writeRun(root, "2026-07-04T08-00-00-000Z", "{not json");

    const err = await loadViewScan(root).then(
      () => { throw new Error("expected ViewInputError"); },
      (e) => e as Error,
    );
    expect(err).toBeInstanceOf(ViewInputError);
    expect(err.message).toContain("2 run directories were skipped");
    expect(err.message).toContain("incompatible-version, schemaVersion 999");
    expect(err.message).toContain("npx niceeval@9.9.9 view ");
    expect(err.message).toContain("malformed");
  });
});
