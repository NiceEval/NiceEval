// cases: docs/engineering/testing/unit/reports.md
// 「show 的范围 × 切片正交」stabilityMatrixData 判据段。
// stabilityMatrixData(稳定性矩阵):证据面与 --history 相同(跨快照身份键去重、不设可比性门槛)、
// failed 与 errored 分列不合并、unreadable 不计、neverPassed(零通过且执行数>0)、无执行组合是
// 缺失不是三个 0、行按历史最高通过率升序。

import { describe, expect, it } from "vitest";
import type { EvalResult, Verdict } from "../../types.ts";
import { completeEvidenceCoverage } from "../../scoring/coverage.ts";
import type { AttemptHandle, Run } from "../../record/index.ts";
import { attemptHandleOf, scopeOf } from "../components/scope.harness.ts";
import { stabilityMatrixData } from "./compute.ts";
import { validateStabilityMatrixData } from "./validate.ts";

let seq = 0;
function res(id: string, verdict: Verdict, attempt = 0): EvalResult {
  seq += 1;
  return {
    id,
    agent: "agent-x",
    verdict,
    attempt,
    startedAt: `2026-07-01T00:00:00.${String(seq).padStart(6, "0")}Z`,
    durationMs: 1000,
    assertions: [],
    evidenceCoverage: completeEvidenceCoverage,
  };
}

let runSeq = 0;
function snap(
  experimentId: string,
  results: EvalResult[],
  opts: { agent?: string; model?: string; runStartedAt?: string } = {},
): Run {
  runSeq += 1;
  const startedAt = opts.runStartedAt ?? `2026-06-01T00:00:00.${String(runSeq).padStart(3, "0")}Z`;
  const run = {
    experimentId,
    startedAt,
    completedAt: startedAt,
    agent: opts.agent ?? "agent-x",
    model: opts.model,
    schemaVersion: 1,
    dir: `/results/${experimentId}/snap-${runSeq}`,
  } as Run;
  const attempts: AttemptHandle[] = results.map((r) =>
    attemptHandleOf(run, r, {
      run: `${experimentId}/snap-${runSeq}`,
      attempt: `${r.id}/a${r.attempt}`,
    }),
  );
  const evals = new Map<string, AttemptHandle[]>();
  for (const a of attempts) evals.set(a.evalId, [...(evals.get(a.evalId) ?? []), a]);
  run.evals = [...evals.entries()].map(([id, list]) => ({ id, attempts: list }));
  run.attempts = attempts;
  return run;
}

/** 从 data.cells 里取一个 (row, column) 格子。 */
function cellAt(data: Awaited<ReturnType<typeof stabilityMatrixData>>, row: string, column: string) {
  return data.cells.find((c) => c.row === row && c.column === column)?.cell;
}

describe("stabilityMatrixData", () => {
  it("failed 与 errored 分列不合并——混列算法会把两者加成一个数,分列算法各自保留", async () => {
    const s = snap("exp-a", [res("q", "failed", 0), res("q", "errored", 1)]);
    const scope = scopeOf([s]);
    const data = await stabilityMatrixData(scope, { by: "experiment" });
    const cell = cellAt(data, "q", "exp-a")!;
    expect(cell.failed).toBe(1);
    expect(cell.errored).toBe(1);
    expect(cell.executions).toBe(2); // 混列算法会把 failed+errored 揉成一个字段,这里分列各自 1
  });

  it("unreadable 不计入任何列", async () => {
    const s = snap("exp-a", [res("q", "passed", 0), res("q", "unreadable", 1)]);
    const data = await stabilityMatrixData(scopeOf([s]), { by: "experiment" });
    const cell = cellAt(data, "q", "exp-a")!;
    expect(cell).toEqual({ passed: 1, failed: 0, errored: 0, executions: 1 });
  });

  it("neverPassed:该行全部条件历史执行通过次数为 0 且执行数 > 0", async () => {
    const s = snap("exp-a", [res("never", "failed"), res("sometimes", "passed")]);
    const data = await stabilityMatrixData(scopeOf([s]), { by: "experiment" });
    expect(data.rows.find((r) => r.evalId === "never")!.neverPassed).toBe(true);
    expect(data.rows.find((r) => r.evalId === "sometimes")!.neverPassed).toBe(false);
  });

  it("无执行组合是缺失不是三个 0:全 unreadable 的 (eval, column) 不生成格子;某 eval 在某 experiment 从未跑过同理", async () => {
    const skippedOnly = snap("exp-a", [res("only-unreadable", "unreadable")]);
    const other = snap("exp-b", [res("other-eval", "passed")]);
    const data = await stabilityMatrixData(scopeOf([skippedOnly, other]), { by: "experiment" });
    // "only-unreadable" 在 exp-a 下全 unreadable:不生成格子,该 eval 也不出现在 rows 里(没有任何真实历史执行)
    expect(data.rows.some((r) => r.evalId === "only-unreadable")).toBe(false);
    // "other-eval" 只在 exp-b 跑过,exp-a 下这道题从未涉及:该组合缺失
    expect(cellAt(data, "other-eval", "exp-a")).toBeUndefined();
    expect(cellAt(data, "other-eval", "exp-b")).toBeDefined();
  });

  it("行按历史最高通过率(各列分别算,取最高值)升序排列,零通过排最前;同序值按 evalId 字典序收口", async () => {
    // "b": exp-a 通过率 0/2=0%,exp-b 1/1=100% → 最高 100%
    // "a": exp-a 通过率 0/1=0% → 最高 0%(never passed,排最前)
    // "c": exp-a 通过率 1/2=50% → 最高 50%
    const expA = snap("exp-a", [
      res("a", "failed"),
      res("b", "failed", 0),
      res("b", "failed", 1),
      res("c", "passed", 0),
      res("c", "failed", 1),
    ]);
    const expB = snap("exp-b", [res("b", "passed")]);
    const data = await stabilityMatrixData(scopeOf([expA, expB]), { by: "experiment" });
    expect(data.rows.map((r) => r.evalId)).toEqual(["a", "c", "b"]);
  });

  it("不设可比性门槛:agent/model 不同的列照样并排出现,不做过滤", async () => {
    const s1 = snap("exp-a", [res("q", "passed")], { agent: "codex", model: "m1" });
    const s2 = snap("exp-b", [res("q", "failed")], { agent: "claude", model: "m2" });
    const data = await stabilityMatrixData(scopeOf([s1, s2]), { by: "experiment" });
    expect(data.columns).toEqual(["exp-a", "exp-b"]);
  });

  it("证据面与 --history 相同:跨快照按身份键去重后的历次执行(重复条目不重复计数)", async () => {
    // 两份独立快照携带同一个 (experimentId, evalId, attempt, startedAt) 身份键的条目
    // (如现刻水位与手挑历史范围重叠)——collectItems 复用 niceeval/record 的 dedupeAttempts,
    // 只应计一次,不是两次历史执行。
    const fixedStartedAt = "2026-05-01T00:00:00.000Z";
    const attemptA = res("q", "passed", 0);
    attemptA.startedAt = fixedStartedAt;
    const attemptB = res("q", "passed", 0);
    attemptB.startedAt = fixedStartedAt;
    const snapshotA = snap("exp-a", [attemptA], { runStartedAt: "2026-05-01T00:00:00.000Z" });
    const snapshotB = snap("exp-a", [attemptB], { runStartedAt: "2026-05-02T00:00:00.000Z" });
    const data = await stabilityMatrixData([snapshotA, snapshotB], { by: "experiment" });
    expect(cellAt(data, "q", "exp-a")).toEqual({ passed: 1, failed: 0, errored: 0, executions: 1 });
  });

  it("totals 是各列的合计", async () => {
    const s = snap("exp-a", [res("a", "passed"), res("a", "failed", 1), res("b", "errored")]);
    const data = await stabilityMatrixData(scopeOf([s]), { by: "experiment" });
    expect(data.totals["exp-a"]).toEqual({ passed: 1, failed: 1, errored: 1, executions: 3 });
  });

  it("evals 前缀过滤:与 CLI 位置参数同语义", async () => {
    const s = snap("exp-a", [res("coding/a", "passed"), res("other/b", "passed")]);
    const data = await stabilityMatrixData(scopeOf([s]), { by: "experiment", evals: "coding/" });
    expect(data.rows.map((r) => r.evalId)).toEqual(["coding/a"]);
  });

  it("options.by 缺省时按完整用户反馈报错", async () => {
    const s = snap("exp-a", [res("q", "passed")]);
    await expect(stabilityMatrixData(scopeOf([s]))).rejects.toThrow(/options\.by/);
  });

  it("空 rows 两面零输出;返回结构通过 validateStabilityMatrixData", async () => {
    const empty = scopeOf([]);
    const data = await stabilityMatrixData(empty, { by: "experiment" });
    expect(data.rows).toEqual([]);
    expect(validateStabilityMatrixData(data)).toBeNull();
  });

  it("真实计算产物通过 validateStabilityMatrixData", async () => {
    const s = snap("exp-a", [res("a", "passed"), res("a", "failed", 1), res("b", "errored")]);
    const data = await stabilityMatrixData(scopeOf([s]), { by: "experiment" });
    expect(validateStabilityMatrixData(data)).toBeNull();
  });
});
