// cases: docs/engineering/testing/unit/reports.md
// 「参数化页与下钻目标」ExperimentDetails:收窄恰好一个实验时六区块投影同一份转换结果;
// 零个或多个实验按完整用户反馈报错;experiment 作用域 facts 进 notices 区块。观察面是
// resolve 后的组件树(元素 type/props)与 experimentDetailsData 的普通值,不渲染到文本或 HTML。

import { describe, expect, it } from "vitest";

import type { AssertionResult, EvalResult, Verdict } from "../../../types.ts";
import { completeEvidenceCoverage } from "../../../assertions/coverage.ts";
import type { AttemptHandle, Run, Sample, SampleIssue, SampleCoverage } from "../../../record/index.ts";
import { attemptHandleOf, resultsOf, scopeOf } from "../scope.harness.ts";
import { defineReport } from "../../definition/report.ts";
import { buildReportMeta } from "../../definition/report.ts";
import { resolveReportTree, ResolveMemo, validateReportTree, type ReportNode } from "../../definition/tree.ts";
import { Callouts, CopyBlock, Stat, Table } from "../../definition/primitives.tsx";
import { experimentListContent } from "../entity-lists/content.ts";
import { sampleNoticesContent, runNoticesContent } from "../site-components/projections.ts";
import { experimentDetailsData } from "./compute.ts";
import { ExperimentDetails } from "./index.tsx";

let seq = 0;

function res(id: string, verdict: Verdict, extra: Partial<EvalResult> = {}): EvalResult {
  seq += 1;
  return {
    id,
    agent: "agent-x",
    verdict,
    attempt: 0,
    startedAt: `2026-07-01T00:00:00.${String(seq).padStart(6, "0")}Z`,
    durationMs: 1000,
    assertions: [],
    evidenceCoverage: completeEvidenceCoverage,
    ...extra,
  };
}

function scoreAssertion(points: number): AssertionResult {
  return { name: "score", severity: "gate", outcome: "passed", score: 1, points } as AssertionResult;
}

let runSeq = 0;

function snap(spec: { experimentId: string; results: EvalResult[]; agent?: string }): Run {
  runSeq += 1;
  const startedAt = `2026-06-01T00:00:00.${String(runSeq).padStart(3, "0")}Z`;
  const run = {
    runId: `run-${runSeq}`,
    experimentId: spec.experimentId,
    startedAt,
    completedAt: startedAt,
    agent: spec.agent ?? "agent-x",
    schemaVersion: 1,
    dir: `/results/exp/snap-${runSeq}`,
  } as Run;
  const attempts: AttemptHandle[] = spec.results.map((r) =>
    attemptHandleOf(run, r, { run: `exp/snap-${runSeq}`, attempt: `${r.id}/a${r.attempt}` }),
  );
  run.attempts = attempts;
  const evals = new Map<string, AttemptHandle[]>();
  for (const attempt of attempts) evals.set(attempt.evalId, [...(evals.get(attempt.evalId) ?? []), attempt]);
  run.evals = [...evals.entries()].map(([id, list]) => ({ id, attempts: list }));
  return run;
}

/** resolve <ExperimentDetails input={scope} /> 完整走管线;断言面是解析后的树,不渲染。 */
async function resolveExperimentDetails(scope: Sample): Promise<ReportNode> {
  const node = <ExperimentDetails input={scope} /> as unknown as ReportNode;
  const definition = defineReport(() => node);
  const resolved = await resolveReportTree(node, {
    scope,
    results: resultsOf(scope.runs),
    report: buildReportMeta(definition, scope),
    page: { id: "experiment", input: "sample" },
    memo: new ResolveMemo(),
  });
  validateReportTree(resolved);
  return resolved;
}

function collectElementsByType(
  node: unknown,
  target: unknown,
  out: Array<{ props: globalThis.Record<string, unknown> }> = [],
): Array<{ props: globalThis.Record<string, unknown> }> {
  if (node === null || node === undefined || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const child of node) collectElementsByType(child, target, out);
    return out;
  }
  const el = node as { type?: unknown; props?: { children?: unknown } };
  if (el.type === target) out.push(el as { props: globalThis.Record<string, unknown> });
  if (el.props && "children" in el.props) collectElementsByType(el.props.children, target, out);
  return out;
}

describe("ExperimentDetails:六区块投影同一份转换结果", () => {
  it("单实验收窄:Table/Callouts/CopyBlock 的 props 与 experimentDetailsData 逐项相等", async () => {
    const issue: SampleIssue = {
      code: "unfinished-run",
      experimentId: "agents/codex",
      startedAt: "2026-06-01T00:00:00.001Z",
      dir: "/results/exp/snap-1",
    };
    const run = snap({ experimentId: "agents/codex", results: [res("q1", "passed"), res("q2", "failed")] });
    run.diagnostics = [{ code: "slow-teardown", level: "warning", detail: "teardown took 12s" }];
    const coverage: SampleCoverage = {
      experimentId: "agents/codex",
      run,
      knownEvalIds: ["q1", "q2", "q3"],
      missing: [{ evalId: "q3", reason: "never-run" }],
    };
    const scope = scopeOf([run], [issue], [coverage]);

    const data = await experimentDetailsData(scope);
    expect(data.experiment.experimentId).toBe("agents/codex");
    expect(data.experiment.evalVerdicts).toEqual({ passed: 1, failed: 1, errored: 0, skipped: 0 });
    expect(data.experiment.missing).toEqual([{ evalId: "q3", reason: "never-run" }]);
    expect(data.catchUpCommand).toBe("niceeval exp agents/codex");
    expect(data.notices).toEqual(await sampleNoticesContent(scope));
    expect(data.diagnostics).toEqual(await runNoticesContent(scope));
    expect(data.notices.length).toBeGreaterThan(0);
    expect(data.diagnostics.length).toBeGreaterThan(0);

    const resolved = await resolveExperimentDetails(scope);
    const tables = collectElementsByType(resolved, Table);
    expect(tables).toHaveLength(1);
    expect(tables[0]!.props.data).toEqual(experimentListContent([data.experiment]));

    const copyBlocks = collectElementsByType(resolved, CopyBlock);
    expect(copyBlocks).toHaveLength(1);
    expect(copyBlocks[0]!.props.text).toBe(data.catchUpCommand);

    const callouts = collectElementsByType(resolved, Callouts);
    expect(callouts).toHaveLength(2);
    expect(callouts[0]!.props.items).toEqual(data.notices);
    expect(callouts[1]!.props.items).toEqual(data.diagnostics);

    const stats = collectElementsByType(resolved, Stat);
    expect(stats.some((s) => s.props.value === "agents/codex")).toBe(true);
    expect(stats.some((s) => s.props.value === "agent-x")).toBe(true);
  });

  it("无缺口时覆盖缺口区块不挂 CopyBlock", async () => {
    const run = snap({ experimentId: "agents/codex", results: [res("q1", "passed")] });
    const scope = scopeOf([run]);
    const data = await experimentDetailsData(scope);
    expect(data.catchUpCommand).toBeNull();
    const resolved = await resolveExperimentDetails(scope);
    expect(collectElementsByType(resolved, CopyBlock)).toHaveLength(0);
  });

  it("单实验混型时身份标成 mixed，摘要并排显示通过率与总分", async () => {
    const run = snap({
      experimentId: "agents/mixed",
      results: [
        res("plain", "failed"),
        res("score", "passed", { evaluationKind: "points", assertions: [scoreAssertion(5)] }),
      ],
    });
    const scope = scopeOf([run]);
    const data = await experimentDetailsData(scope);
    expect(data.experiment.evaluationKind).toBe("mixed");
    expect(data.experiment.endToEndPassRate.value).toBe(0);
    expect(data.experiment.totalScore.value).toBe(5);

    const resolved = await resolveExperimentDetails(scope);
    const stats = collectElementsByType(resolved, Stat);
    expect(stats.some((stat) => (stat.props.label as { en?: string } | undefined)?.en === "Pass rate")).toBe(true);
    expect(stats.some((stat) => (stat.props.label as { en?: string } | undefined)?.en === "Total score")).toBe(true);
    expect(stats.some((stat) => stat.props.value === "mixed")).toBe(true);
  });

  it("收窄到零个实验:按完整用户反馈报错,不静默取第一个", async () => {
    const scope = scopeOf([]);
    await expect(experimentDetailsData(scope)).rejects.toThrow(/exactly one experiment.*none|contains none/s);
  });

  it("收窄到多个实验:按完整用户反馈报错并点名全部实验 id", async () => {
    const runA = snap({ experimentId: "agents/codex", results: [res("q1", "passed")] });
    const runB = snap({ experimentId: "agents/claude", results: [res("q1", "failed")] });
    const scope = scopeOf([runA, runB]);
    await expect(experimentDetailsData(scope)).rejects.toThrow(/agents\/codex/);
    await expect(experimentDetailsData(scope)).rejects.toThrow(/agents\/claude/);
  });
});
