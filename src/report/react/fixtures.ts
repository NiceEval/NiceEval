// 手工 fixture:模拟计算函数(MetricTable.data / MetricMatrix.data / …)的产物。
// 仅供渲染测试与 scripts/report-react-demo.tsx 使用,不从入口导出。
// 数字刻意覆盖诚实细节:coverage 角标(samples<total)、全 null 格子、
// 稀疏矩阵、缺数据的散点、delta 的 null 不硬算、truncated 计数。

import type {
  CaseListData,
  DeltaData,
  LineData,
  MatrixData,
  MetricColumn,
  OverviewData,
  ScatterData,
  ScoreboardData,
  TableData,
} from "../types.ts";

export const passRateColumn: MetricColumn = { key: "pass-rate", label: "pass rate", unit: "%", better: "higher" };
export const codeLinesColumn: MetricColumn = { key: "code-lines", label: "code lines", unit: "lines", better: "lower" };
export const costColumn: MetricColumn = { key: "cost", label: "cost", unit: "$", better: "lower" };

export const overviewData: OverviewData = {
  snapshots: [
    { experimentId: "compare/bub", agent: "bub", model: "gpt-5.4", startedAt: "2026-07-01T10:00:00Z" },
    { experimentId: "compare/codex", agent: "codex", startedAt: "2026-07-01T11:30:00Z" },
  ],
  totals: {
    evals: 12,
    attempts: 48,
    passed: 36,
    failed: 8,
    errored: 2,
    skipped: 2,
    costUSD: null, // 全部 attempt 都没报成本:null,组件必须显示缺数据而不是 $0
    durationMs: 261_000,
  },
  warnings: [
    {
      kind: "partial-coverage",
      experimentId: "compare/bub",
      covered: 9,
      total: 12,
      message: "snapshot covers 9 of 12 evals seen in history; re-run `niceeval exp compare/bub` for a full snapshot",
    },
  ],
};

export const overviewWithCost: OverviewData = {
  ...overviewData,
  totals: { ...overviewData.totals, costUSD: 1.234 },
  warnings: [],
};

export const tableData: TableData<"pass-rate" | "code-lines"> = {
  dimension: "agent",
  // 行顺序故意不按 passRate 排:组件必须按传入顺序渲染,不重排
  columns: [passRateColumn, codeLinesColumn],
  rows: [
    {
      key: "codex",
      cells: {
        "pass-rate": { value: 0.5, display: "50%", samples: 6, total: 6, refs: [] },
        // 全 null:一个有效样本都没有 → 缺数据文案,绝不画 0
        "code-lines": { value: null, display: "—", samples: 0, total: 6, refs: [] },
      },
    },
    {
      key: "bub",
      cells: {
        "pass-rate": {
          value: 0.87,
          display: "87%",
          samples: 6,
          total: 6,
          refs: [{ run: "run-a", result: 0 }],
        },
        // samples < total:有 attempt 测不了 → 覆盖率角标 5/6
        "code-lines": { value: 120, display: "120 lines", samples: 5, total: 6, refs: [] },
      },
    },
  ],
};

export const matrixData: MatrixData = {
  rows: "eval",
  columns: "agent",
  metric: passRateColumn,
  // 稀疏:geometry/angles × codex 没有样本,数据里不出现 → 格子空着
  cells: [
    {
      row: "algebra/quadratic",
      column: "bub",
      cell: {
        value: 1,
        display: "100%",
        samples: 2,
        total: 2,
        refs: [
          { run: "run-b", result: 3 },
          { run: "run-b", result: 7 },
        ],
      },
    },
    {
      row: "algebra/quadratic",
      column: "codex",
      cell: { value: 0, display: "0%", samples: 3, total: 3, refs: [] },
    },
    {
      row: "geometry/angles",
      column: "bub",
      cell: { value: 0.5, display: "50%", samples: 2, total: 2, refs: [] },
    },
  ],
};

export const scoreboardData: ScoreboardData = {
  dimension: "agent",
  fullMarks: 100,
  weights: [{ prefix: "algebra/", weight: 2 }],
  rows: [
    {
      key: "bub",
      total: { value: 78.5, display: "78.5" },
      subjects: [
        // missing 1:一题没跑、按 0 计——固定分母的如实注脚
        { key: "algebra", earned: 14, possible: 16, evals: 8, missing: 1 },
        { key: "geometry", earned: 3, possible: 4, evals: 4, missing: 0 },
      ],
    },
    {
      key: "codex",
      total: { value: 52, display: "52" },
      subjects: [
        { key: "algebra", earned: 9, possible: 16, evals: 8, missing: 0 },
        { key: "geometry", earned: 1.4, possible: 4, evals: 4, missing: 2 },
      ],
    },
  ],
};

export const scatterData: ScatterData = {
  points: "experiment",
  series: "agent",
  x: costColumn, // better: "lower" → 轴反向,便宜的一端在右
  y: passRateColumn,
  rows: [
    {
      key: "compare/bub-low",
      series: "bub",
      x: { value: 5, display: "$5.00", samples: 6, total: 6, refs: [] },
      y: { value: 0.5, display: "50%", samples: 6, total: 6, refs: [] },
    },
    {
      key: "compare/bub-high",
      series: "bub",
      x: { value: 10, display: "$10.00", samples: 6, total: 6, refs: [] },
      y: { value: 0.9, display: "90%", samples: 6, total: 6, refs: [] },
    },
    {
      key: "compare/codex-mid",
      series: "codex",
      x: { value: 7, display: "$7.00", samples: 6, total: 6, refs: [] },
      y: { value: 0.6, display: "60%", samples: 6, total: 6, refs: [] },
    },
    {
      // x 缺数据:这个点不画,注脚报 1 个点缺数据
      key: "compare/codex-broken",
      series: "codex",
      x: { value: null, display: "—", samples: 0, total: 6, refs: [] },
      y: { value: 0.7, display: "70%", samples: 6, total: 6, refs: [] },
    },
  ],
};

export const lineData: LineData = {
  x: { key: "latencyMs", label: "Simulated latency", unit: "ms" },
  series: "agents",
  y: passRateColumn,
  rows: [
    {
      key: "ultra/agents-1-lat-100",
      series: "1 agents",
      x: 100,
      xDisplay: "100ms",
      y: { value: 0.4, display: "40%", samples: 6, total: 6, refs: [] },
    },
    {
      key: "ultra/agents-1-lat-300",
      series: "1 agents",
      x: 300,
      xDisplay: "300ms",
      y: { value: 0.3, display: "30%", samples: 6, total: 6, refs: [] },
    },
    {
      key: "ultra/agents-16-lat-100",
      series: "16 agents",
      x: 100,
      xDisplay: "100ms",
      y: { value: 0.8, display: "80%", samples: 6, total: 6, refs: [] },
    },
    {
      key: "ultra/agents-16-lat-300",
      series: "16 agents",
      x: 300,
      xDisplay: "300ms",
      y: { value: 0.7, display: "70%", samples: 6, total: 6, refs: [] },
    },
    {
      // 未声明 flag 的 experiment:作轴不画点,注脚报数
      key: "ultra/legacy",
      series: "1 agents",
      x: null,
      xDisplay: "",
      y: { value: 0.5, display: "50%", samples: 6, total: 6, refs: [] },
    },
  ],
};

export const deltaData: DeltaData<"pass-rate" | "cost"> = {
  columns: [passRateColumn, costColumn],
  rows: [
    {
      key: "bub",
      a: { experimentId: "compare/bub" },
      b: { experimentId: "compare/bub--agents-md" },
      cells: {
        // 通过率 +12pp:better higher → 好(绿)
        "pass-rate": {
          a: { value: 0.5, display: "50%", samples: 6, total: 6, refs: [] },
          b: { value: 0.62, display: "62%", samples: 6, total: 6, refs: [] },
          delta: 0.12,
          display: "+12pp",
        },
        // 成本 +$0.15:better lower → 坏(红)
        cost: {
          a: { value: 0.2, display: "$0.20", samples: 6, total: 6, refs: [] },
          b: { value: 0.35, display: "$0.35", samples: 6, total: 6, refs: [] },
          delta: 0.15,
          display: "+$0.15",
        },
      },
    },
    {
      key: "codex",
      a: { experimentId: "compare/codex" },
      b: { experimentId: "compare/codex--agents-md" },
      cells: {
        "pass-rate": {
          a: { value: 0.4, display: "40%", samples: 6, total: 6, refs: [] },
          b: { value: 0.4, display: "40%", samples: 6, total: 6, refs: [] },
          delta: 0,
          display: "±0",
        },
        // A 侧缺数据 → delta null:显示缺,不硬算
        cost: {
          a: { value: null, display: "—", samples: 0, total: 6, refs: [] },
          b: { value: 0.3, display: "$0.30", samples: 6, total: 6, refs: [] },
          delta: null,
          display: "—",
        },
      },
    },
  ],
};

export const caseListData: CaseListData = {
  rows: [
    {
      eval: "algebra/quadratic",
      experimentId: "compare/bub",
      agent: "bub",
      verdict: "failed",
      failedAssertions: [
        {
          name: "roots-correct",
          score: 0,
          detail: "expected x=2, got x=3",
          evidence: "judge: sign flipped when substituting into the quadratic formula",
        },
      ],
      durationMs: 32_000,
      costUSD: 0.12,
      ref: { run: "run-a", result: 4 },
    },
    {
      eval: "geometry/angles",
      experimentId: "compare/codex",
      agent: "codex",
      verdict: "errored",
      error: "TypeError: cannot read properties of undefined (reading 'foo')",
      failedAssertions: [],
      durationMs: 4_500,
      ref: { run: "run-c", result: 1 },
    },
  ],
  truncated: 2,
};
