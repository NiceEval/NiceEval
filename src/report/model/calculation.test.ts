// cases: docs/engineering/testing/unit/reports.md
// 普通值计算内核：Reducer / MetricValue / rollup / aggregate / coverage 锚点分组。

import { describe, expect, it } from "vitest";

import type { EvalResult, Verdict } from "../../types.ts";
import { completeEvidenceCoverage } from "../../assertions/coverage.ts";
import type { AttemptHandle, Run, Sample } from "../../record/index.ts";
import { encodeAttemptLocator } from "../../record/locator.ts";
import { attemptHandleOf, scopeOf } from "../components/scope.harness.ts";
import { flag, label, runConfig } from "./flag.ts";
import type { DimensionRef } from "./types.ts";
import {
  aggregate,
  agent,
  evalId,
  evidenceRow,
  experiment,
  max,
  mean,
  metricValue,
  min,
  model,
  passRate,
  parseEvidenceRow,
  parseEvidenceRows,
  percentile,
  rollup,
  sum,
  tokens,
} from "./calculation.ts";

function assertReportCalculationStaticContracts(sample: Sample): void {
  // @ts-expect-error 维度字段不能冒充 EvidenceRow，必须至少包含一个 MetricValue
  evidenceRow({ agent: "codex" });
  // @ts-expect-error by 与 values 的同名键在 aggregate 调用处拒绝
  void aggregate(sample, { by: { agent }, values: { agent: passRate } });
  // @ts-expect-error refs 是行级保留键，不能出现在分组键里
  void aggregate(sample, { by: { refs: agent }, values: { passRate } });
  const flagRef: Extract<DimensionRef, { readonly kind: "flag" }> = flag("memory");
  const labelRef: Extract<DimensionRef, { readonly kind: "label" }> = label("line");
  const configRef: Extract<DimensionRef, { readonly kind: "runConfig" }> = runConfig("model");
  void [flagRef, labelRef, configRef];
  // @ts-expect-error runConfig 只接受 RunConfigKey，不接受任意字符串。
  runConfig("arbitrary-config");
}
void assertReportCalculationStaticContracts;

let seq = 0;
let runSeq = 0;

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

function snap(spec: {
  experimentId: string;
  results: EvalResult[];
  agent?: string;
  model?: string;
  knownEvalIds?: string[];
}): Run {
  runSeq += 1;
  const startedAt = `2026-06-01T00:00:00.${String(runSeq).padStart(3, "0")}Z`;
  const run = {
    runId: `run-${runSeq}`,
    experimentId: spec.experimentId,
    startedAt,
    completedAt: startedAt,
    agent: spec.agent ?? "agent-x",
    model: spec.model,
    schemaVersion: 1,
    producer: { name: "niceeval", version: "test" },
    dir: `/results/${spec.experimentId}/snap-${runSeq}`,
    knownEvalIds: spec.knownEvalIds,
    evals: [],
    attempts: [],
  } as Run;
  const attempts: AttemptHandle[] = spec.results.map((r) => {
    const handle = attemptHandleOf(
      run,
      { ...r, experimentId: spec.experimentId },
      {
        run: `${spec.experimentId}/snap-${runSeq}`,
        attempt: `${r.id}/a${r.attempt}`,
      },
    );
    handle.locator = encodeAttemptLocator({
      runId: run.runId,
      evalId: r.id,
      attempt: r.attempt,
    });
    return handle;
  });
  (run as { attempts: AttemptHandle[] }).attempts = attempts;
  (run as { evals: { id: string; attempts: AttemptHandle[] }[] }).evals = [
    ...new Map(
      attempts.map((a) => {
        const list = attempts.filter((x) => x.evalId === a.evalId);
        return [a.evalId, { id: a.evalId, attempts: list }] as const;
      }),
    ).values(),
  ];
  return run;
}

describe("Reducer", () => {
  it("空集合返回 null；percentile 在 [0,1] 线性插值", () => {
    expect(mean([])).toBeNull();
    expect(sum([])).toBeNull();
    expect(min([])).toBeNull();
    expect(max([])).toBeNull();
    expect(percentile(0.5)([1, 2, 3, 4])).toBe(2.5);
    expect(percentile(0)([10, 20])).toBe(10);
    expect(percentile(1)([10, 20])).toBe(20);
    expect(() => percentile(1.5)).toThrow(/\[0, 1\]/);
  });
});

describe("DimensionRef", () => {
  it("三种构造函数保留判别 kind，runConfig 只承载声明的配置键", () => {
    expect(flag("memory")).toMatchObject({ kind: "flag", name: "memory" });
    expect(label("line")).toMatchObject({ kind: "label", name: "line" });
    expect(runConfig("reasoningEffort")).toMatchObject({ kind: "runConfig", name: "reasoningEffort" });
  });
});

describe("metricValue / evidenceRow", () => {
  it("校验 samples/total，refs 稳定去重；evidenceRow 合并 MetricValue refs", () => {
    const locA = encodeAttemptLocator({
      runId: "e/run-a",
      evalId: "a",
      attempt: 0,
    });
    const locB = encodeAttemptLocator({
      runId: "e/run-a",
      evalId: "b",
      attempt: 0,
    });
    const mv = metricValue({
      value: 0.5,
      samples: 1,
      total: 2,
      basis: "eval",
      evidence: [locA, locA, locB],
    });
    expect(mv.refs).toEqual([locA, locB]);
    expect(() => metricValue({ value: 1, samples: 3, total: 2, basis: "eval", evidence: [] })).toThrow(
      /samples/,
    );
    const row = evidenceRow({ passRate: mv, label: "x" });
    expect(row.refs).toEqual([locA, locB]);
    expect(row.label).toBe("x");
    // 无类型 JavaScript 输入仍走运行时护栏；类型作者会在调用处被静态契约拦住。
    expect(() => evidenceRow({ label: "no-metric" } as never)).toThrow(/MetricValue/);
  });

  it("parseEvidenceRow(s) 为 unknown 数据逐字段建立同一份证据证明", () => {
    const metric = {
      value: 0.8,
      samples: 4,
      total: 5,
      basis: "eval" as const,
      refs: ["exp@2026-07-01T00:00:00.000Z/e/a0"],
    };
    const row = parseEvidenceRow({ agent: "codex", passRate: metric });
    expect(row.refs).toEqual(metric.refs);
    expect(parseEvidenceRows([{ agent: "codex", passRate: metric }])).toHaveLength(1);
    expect(() => parseEvidenceRow({ agent: "codex", model: "gpt" })).toThrow(
      /only dimensions \(agent, model\)/,
    );
    expect(() => parseEvidenceRow({ passRate: { value: "bad" } })).toThrow(/field "passRate"/);
    expect(() => parseEvidenceRow({ agent: Number.NaN, passRate: metric })).toThrow(/field "agent"/);
    expect(() => parseEvidenceRows({})).toThrow(/expected an array/);
  });
});

describe("aggregate · Eval 级分组与 coverage 锚点", () => {
  it("library 算例：题内 [1,0,null]+[1]+缺口 → mean/mean = 0.75，samples/total = 2/3，basis=eval", async () => {
    // a: 三个 attempt 题内值 [1, 0, null] → within mean 0.5
    // b: 一个 attempt [1] → 1
    // c: 零 attempt coverage 缺口 → 只抬 total
    const run = snap({
      experimentId: "exam",
      agent: "codex",
      model: "gpt-5",
      knownEvalIds: ["a", "b", "c"],
      results: [
        res("a", "passed"),
        res("a", "failed", { attempt: 1 }),
        res("a", "skipped", { attempt: 2 }),
        res("b", "passed"),
      ],
    });
    const sample = scopeOf(
      [run],
      [],
      [{ experimentId: "exam", run, knownEvalIds: ["a", "b", "c"], missing: [{ evalId: "c", reason: "never-run" }] }],
    );
    const rows = await aggregate(sample, {
      by: { experiment },
      values: { passRate },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.passRate.value).toBe(0.75);
    expect(rows[0]!.passRate.samples).toBe(2);
    expect(rows[0]!.passRate.total).toBe(3);
    expect(rows[0]!.passRate.basis).toBe("eval");
    // refs：a 的三个 + b 的一个；c 无 locator
    expect(rows[0]!.passRate.refs).toHaveLength(4);
  });

  it("全缺口 Experiment 按锚点 Run 的 agent 归组，计入 total", async () => {
    const bub = snap({
      experimentId: "compare/bub",
      agent: "bub",
      model: "m1",
      knownEvalIds: ["q1"],
      results: [res("q1", "passed")],
    });
    const codexGap = snap({
      experimentId: "compare/codex",
      agent: "codex",
      model: "m2",
      knownEvalIds: ["q1"],
      results: [],
    });
    const sample = scopeOf(
      [bub],
      [],
      [
        { experimentId: "compare/bub", run: bub, knownEvalIds: ["q1"], missing: [] },
        { experimentId: "compare/codex", run: codexGap, knownEvalIds: ["q1"], missing: [{ evalId: "q1", reason: "never-run" }] },
      ],
    );
    const rows = await aggregate(sample, {
      by: { agent },
      values: { passRate },
    });
    const byAgent = new Map(rows.map((r) => [r.agent, r]));
    expect(byAgent.get("bub")!.passRate).toMatchObject({ value: 1, samples: 1, total: 1 });
    // 全缺口：value null、samples 0、total 1——删除 coverage 单元会让这行消失
    expect(byAgent.get("codex")!.passRate).toMatchObject({ value: null, samples: 0, total: 1 });
    expect(byAgent.get("codex")!.passRate.refs).toEqual([]);
  });

  it("分组函数读 Run 顶层 model，不读 ExperimentRunInfo", async () => {
    const run = snap({
      experimentId: "e",
      agent: "x",
      model: "gpt-4o",
      results: [res("q1", "passed")],
    });
    const sample = scopeOf(
      [run],
      [],
      [{ experimentId: "e", run, knownEvalIds: ["q1"], missing: [] }],
    );
    const rows = await aggregate(sample, {
      by: { model },
      values: { passRate },
    });
    expect(rows[0]!.model).toBe("gpt-4o");
  });

  it("by/values 键冲突与 refs 保留键在运行时拒绝", async () => {
    const run = snap({ experimentId: "e", results: [res("q1", "passed")] });
    const sample = scopeOf(
      [run],
      [],
      [{ experimentId: "e", run, knownEvalIds: ["q1"], missing: [] }],
    );
    await expect(
      aggregate(sample, {
        by: { passRate: agent },
        values: { passRate },
      } as never),
    ).rejects.toThrow(/both by and values/);
    await expect(
      aggregate(sample, {
        by: { refs: agent },
        values: { passRate },
      } as never),
    ).rejects.toThrow(/refs/);
  });

  it("分组值包含 NUL 或等号时仍按 tuple 身份分行，不因字符串拼接碰撞", async () => {
    const run = snap({
      experimentId: "e",
      knownEvalIds: ["q1", "q2"],
      results: [res("q1", "passed"), res("q2", "failed")],
    });
    const sample = scopeOf(
      [run],
      [],
      [{ experimentId: "e", run, knownEvalIds: ["q1", "q2"], missing: [] }],
    );
    const rows = await aggregate(sample, {
      by: {
        a: (subject) => (subject.evalId === "q1" ? "x\0b=y" : "x"),
        b: (subject) => (subject.evalId === "q1" ? "z" : "y\0b=z"),
      },
      values: { passRate },
    });
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => [row.a, row.b])).toEqual([
      ["x", "y\0b=z"],
      ["x\0b=y", "z"],
    ]);
  });

  it("自定义 withinEval/acrossEvals：min/max 算例 value=1，samples/total=2/3", async () => {
    const calc = rollup(
      (attempt) => {
        switch (attempt.result.verdict) {
          case "passed":
            return 1;
          case "failed":
            return 0;
          default:
            return null;
        }
      },
      { withinEval: min, acrossEvals: max },
    );
    const run = snap({
      experimentId: "exam",
      knownEvalIds: ["a", "b", "c"],
      results: [
        res("a", "passed"),
        res("a", "failed", { attempt: 1 }),
        res("a", "skipped", { attempt: 2 }),
        res("b", "passed"),
      ],
    });
    const sample = scopeOf(
      [run],
      [],
      [{ experimentId: "exam", run, knownEvalIds: ["a", "b", "c"], missing: [{ evalId: "c", reason: "never-run" }] }],
    );
    const rows = await aggregate(sample, { by: { experiment }, values: { score: calc } });
    // a within min([1,0])=0；b=1；across max → 1
    expect(rows[0]!.score).toMatchObject({ value: 1, samples: 2, total: 3, basis: "eval" });
  });

  it("tokens 单 Attempt 计完整模型流量：缓存桶计入、缺失按 0，input/output 缺失为 null，两级 mean", async () => {
    const run = snap({
      experimentId: "exp/tokens",
      knownEvalIds: ["a", "b", "c", "d", "e"],
      results: [
        // a：两轮实测 → within mean (3012 + 7024) / 2 = 5018
        res("a", "passed", {
          attempt: 0,
          usage: { inputTokens: 10, outputTokens: 2, cacheReadTokens: 1_000, cacheCreationTokens: 2_000 },
        }),
        res("a", "failed", {
          attempt: 1,
          usage: { inputTokens: 20, outputTokens: 4, cacheReadTokens: 3_000, cacheCreationTokens: 4_000 },
        }),
        // b：只报一个缓存桶，另一桶缺失按 0 → 30 + 5000 + 0 + 6 = 5036；skipped 轮 null
        res("b", "passed", { usage: { inputTokens: 30, outputTokens: 6, cacheReadTokens: 5_000 } }),
        res("b", "skipped", { attempt: 1 }),
        // c：coverage 缺口 → 只抬 total
        // d：只报缓存明细、缺 input/output → null，不拿 150 冒充完整流量
        res("d", "passed", { usage: { cacheReadTokens: 100, cacheCreationTokens: 50 } }),
        // e：两个缓存桶都不报 → 按 0，5 + 1 = 6
        res("e", "passed", { usage: { inputTokens: 5, outputTokens: 1 } }),
      ],
    });
    const sample = scopeOf(
      [run],
      [],
      [{ experimentId: "exp/tokens", run, knownEvalIds: ["a", "b", "c", "d", "e"], missing: [{ evalId: "c", reason: "never-run" }] }],
    );

    // Eval 内 mean：a / b / e 各自折叠(题内两轮取平均,5018 = mean(3012, 7024),和会是 10036)，
    // d 为 null cell、c 只抬 total
    const perEval = await aggregate(sample, { by: { evalId }, values: { tokens } });
    const byId = new Map(perEval.map((row) => [row.evalId, row.tokens]));
    expect(byId.get("a")!).toMatchObject({ value: 5018, samples: 1, total: 1, basis: "eval", unit: "tokens" });
    expect(byId.get("b")!).toMatchObject({ value: 5036, samples: 1, total: 1 });
    expect(byId.get("d")!).toMatchObject({ value: null, samples: 0, total: 1 });
    expect(byId.get("e")!).toMatchObject({ value: 6, samples: 1, total: 1 });
    expect(byId.get("c")!).toMatchObject({ value: null, samples: 0, total: 1 });

    // 跨 Eval 宏平均 mean(5018, 5036, 6) = 10060/3；若错误地展平 4 个 attempt 会得 3769.5
    const rows = await aggregate(sample, { by: { experiment }, values: { tokens } });
    expect(rows[0]!.tokens.value).toBeCloseTo(10060 / 3);
    expect(rows[0]!.tokens.value).not.toBeCloseTo(3769.5);
    expect(rows[0]!.tokens).toMatchObject({ samples: 3, total: 5, basis: "eval", unit: "tokens" });
  });
});
