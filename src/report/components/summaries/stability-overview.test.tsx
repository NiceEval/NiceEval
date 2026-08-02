// cases: docs/engineering/testing/unit/reports.md
// 「StabilityOverview 的投影」段:散点与堆叠柱从 StabilityContent 字面投影(点身份、refs 原样
// 进 measure cell)、堆叠三段与 totals 同值、读数格的零通过与闪烁计数(全过与全挂都不算闪烁)。
// 断言面是展开树与 Content,不经浏览器。

import { describe, expect, it } from "vitest";
import type { EvalResult, Verdict } from "../../../types.ts";
import { completeEvidenceCoverage } from "../../../assertions/coverage.ts";
import type { AttemptHandle, Run } from "../../../record/index.ts";
import { attemptHandleOf, resultsOf, scopeOf } from "../scope.harness.ts";
import { buildReportMeta, defineReport } from "../../definition/report.ts";
import { ResolveMemo, resolveReportTree } from "../../definition/tree.ts";
import { pickReportPage } from "../../runtime/text.ts";
import { renderSamplePage } from "../../runtime/page-render.ts";
import { Chart, Grid, Stat, Table } from "../../definition/primitives.tsx";
import { StabilityOverview } from "./stability-overview.tsx";
import type { Dataset, MetricValue } from "../../model/types.ts";

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
function snap(experimentId: string, results: EvalResult[]): Run {
  runSeq += 1;
  const startedAt = `2026-06-01T00:00:00.${String(runSeq).padStart(3, "0")}Z`;
  const run = {
    experimentId,
    startedAt,
    completedAt: startedAt,
    agent: "agent-x",
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

function collectByType(
  node: unknown,
  target: unknown,
  out: Array<{ props: globalThis.Record<string, unknown> }> = [],
): Array<{ props: globalThis.Record<string, unknown> }> {
  if (node === null || node === undefined || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const child of node) collectByType(child, target, out);
    return out;
  }
  const el = node as { type?: unknown; props?: { children?: unknown } };
  if (el.type === target) out.push(el as { props: globalThis.Record<string, unknown> });
  if (el.props && "children" in el.props) collectByType(el.props.children, target, out);
  return out;
}

async function resolveOverview(runs: Run[]) {
  const scope = scopeOf(runs);
  const definition = defineReport(() => <StabilityOverview />);
  const page = pickReportPage(definition);
  const tree = await renderSamplePage(page, scope);
  return resolveReportTree(tree, {
    scope,
    results: resultsOf(runs),
    report: buildReportMeta(definition, scope),
    page: { id: page.id, input: "sample" },
    memo: new ResolveMemo(),
  });
}

describe("StabilityOverview(组合组件)", () => {
  it("散点点身份 eval · 条件,格 refs 原样进两个 measure cell;堆叠三段与 totals 同值;读数格零通过/闪烁计数区分全过与全挂", async () => {
    // exp-a:q1 闪烁(1 过 1 挂)、q2 零通过(全挂)、q3 全过(2 次)——后两者都不算闪烁。
    // exp-b:q1 全过——闪烁按格判,q1 行仍因 exp-a 格闪烁计入一次。
    const expA = snap("exp-a", [
      res("q1", "passed", 0),
      res("q1", "failed", 1),
      res("q2", "failed", 0),
      res("q3", "passed", 0),
      res("q3", "passed", 1),
    ]);
    const expB = snap("exp-b", [res("q1", "passed", 0)]);
    const resolved = await resolveOverview([expA, expB]);

    // 读数格:历史执行 6、零通过题 1(q2)、闪烁题 1(q1;q2 全挂与 q3 全过都不算)。
    const stats = collectByType(resolved, Stat);
    expect(stats.map((s) => s.props.value)).toEqual([6, 1, 1]);
    const grid = collectByType(resolved, Grid)[0]!;
    expect(grid).toBeDefined();

    const charts = collectByType(resolved, Chart);
    expect(charts).toHaveLength(2);

    // 散点:一点一格,key 是 `eval · 条件`;refs 与该格计票同一集合,两个 measure cell 都携带。
    const scatter = charts[0]!.props.data as Dataset;
    const q1a = scatter.rows.find((r) => r.key === "q1 · exp-a")!;
    expect(q1a).toBeDefined();
    const executions = q1a.values.executions as MetricValue;
    const passRatio = q1a.values.passRatio as MetricValue;
    expect(executions.value).toBe(2);
    expect(passRatio.value).toBe(0.5);
    expect(executions.refs).toHaveLength(2);
    expect(passRatio.refs).toEqual(executions.refs);
    expect(scatter.rows.map((r) => r.key).sort()).toEqual(["q1 · exp-a", "q1 · exp-b", "q2 · exp-a", "q3 · exp-a"]);

    // 堆叠柱:一条件一柱,三段与矩阵 totals 同值。
    const bars = charts[1]!.props.data as Dataset;
    const byCondition = new Map(bars.rows.map((r) => [r.key, r.values]));
    expect(byCondition.get("exp-a")).toEqual({ condition: "exp-a", passed: 3, failed: 2, errored: 0 });
    expect(byCondition.get("exp-b")).toEqual({ condition: "exp-b", passed: 1, failed: 0, errored: 0 });

    // 矩阵原样交给 Table:行携带 neverPassed,格是带 refs 的 verdict cell。
    const table = collectByType(resolved, Table)[0]!;
    const content = table.props.data as {
      rows: Array<{ evalId: string; neverPassed: boolean; cells: globalThis.Record<string, { kind: string; refs?: readonly string[] }> }>;
    };
    const q2 = content.rows.find((r) => r.evalId === "q2")!;
    expect(q2.neverPassed).toBe(true);
    expect(q2.cells["exp-a"]!.kind).toBe("verdict");
    expect(q2.cells["exp-a"]!.refs).toHaveLength(1);
  });
});
