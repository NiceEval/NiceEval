// 手工 fixture:模拟计算函数(metricTableData / metricMatrixData / …)的产物。
// 仅供 scripts/report-react-demo.tsx 使用,不从入口导出。
// 数字刻意覆盖诚实细节:coverage 角标(samples<total)、全 null 格子、
// 稀疏矩阵、缺数据的散点、delta 的 null 不硬算、truncated 计数。

import type {
  AttemptListItem,
  DeltaData,
  ExperimentListItem,
  LineData,
  MatrixData,
  MetricColumn,
  ScatterData,
  ScopeSummaryData,
  ScoreboardData,
  TableData,
} from "../model/types.ts";
import type { AttemptLocator } from "../../record/locator.ts";

const locator = (s: string): AttemptLocator => s as AttemptLocator;

export const passRateColumn: MetricColumn = { key: "task-pass-rate", label: "pass rate", unit: "%", better: "higher" };
export const codeLinesColumn: MetricColumn = { key: "code-lines", label: "code lines", unit: "lines", better: "lower" };
export const costColumn: MetricColumn = { key: "cost", label: "cost", unit: "$", better: "lower" };

/** scopeSummaryData 的产物形态:两级计票恒随行,通过率与总成本是官方 MetricCell。 */
export const scopeSummaryData: ScopeSummaryData = {
  range: { earliestStartedAt: "2026-07-01T10:00:00Z", latestStartedAt: "2026-07-01T11:30:00Z" },
  experiments: 2,
  evals: 6,
  attempts: 9,
  evalVerdicts: { passed: 3, failed: 1, errored: 1, unreadable: 1 },
  attemptVerdicts: { passed: 4, failed: 3, errored: 1, unreadable: 1 },
  // 两级聚合口径,刻意不等于任一计票的比例:组件必须原样渲染,不重算
  endToEndPassRate: { value: 0.6, basis: "eval", samples: 8, total: 9, refs: [] },
  scoringComposition: "pass",
  totalCostUSD: { value: 1.5, basis: "eval", samples: 8, total: 9, refs: [] },
};

export const tableData: TableData = {
  rowDimension: "agent",
  // 行顺序故意不按 passRate 排:组件必须按传入顺序渲染,不重排
  columns: [passRateColumn, codeLinesColumn],
  rows: [
    {
      key: "codex",
      cells: {
        "task-pass-rate": { value: 0.5, basis: "eval", samples: 6, total: 6, refs: [] },
        // 全 null:一个有效样本都没有 → 缺数据文案,绝不画 0
        "code-lines": { value: null, basis: "eval", samples: 0, total: 6, refs: [] },
      },
    },
    {
      key: "bub",
      cells: {
        "task-pass-rate": {
          value: 0.87,
          basis: "eval", samples: 6,
          total: 6,
          refs: [locator("@1a0a0a0a")],
        },
        // samples < total:有 attempt 测不了 → 覆盖率角标 5/6
        "code-lines": { value: 120, basis: "eval", samples: 5, total: 6, refs: [] },
      },
    },
  ],
};

export const matrixData: MatrixData = {
  rowDimension: "eval",
  columnDimension: "agent",
  metric: passRateColumn,
  // 稀疏:geometry/angles × codex 没有样本,数据里不出现 → 格子空着
  cells: [
    {
      row: "algebra/quadratic",
      column: "bub",
      cell: {
        value: 1,
        basis: "eval", samples: 2,
        total: 2,
        refs: [locator("@1b3b3b3b"), locator("@1b7b7b7b")],
      },
    },
    {
      row: "algebra/quadratic",
      column: "codex",
      cell: { value: 0, basis: "eval", samples: 3, total: 3, refs: [] },
    },
    {
      row: "geometry/angles",
      column: "bub",
      cell: { value: 0.5, basis: "eval", samples: 2, total: 2, refs: [] },
    },
  ],
};

export const scoreboardData: ScoreboardData = {
  rowDimension: "agent",
  questions: [
    "algebra/quadratic",
    "algebra/simple",
    "geometry/angles",
    "geometry/area",
  ],
  fullMarks: 100,
  weights: [{ prefix: "algebra/", weight: 2 }],
  ignoredEvals: 1,
  rows: [
    {
      key: "bub",
      // notRun 1:一题没跑、按 0 计;unscorable 0 —— 两种 0 分分开计数
      total: { value: 78.5, display: "78.5", notRun: 1, unscorable: 0, refs: [locator("@1a0a0a0a")] },
      subjects: [
        { key: "algebra", earned: 14, possible: 16, questions: 8, notRun: 1, unscorable: 0, display: "14/16 (87.5%)", refs: [] },
        { key: "geometry", earned: 3, possible: 4, questions: 4, notRun: 0, unscorable: 0, display: "3/4 (75%)", refs: [] },
      ],
    },
    {
      key: "codex",
      total: { value: 52, display: "52", notRun: 0, unscorable: 2, refs: [] },
      subjects: [
        { key: "algebra", earned: 9, possible: 16, questions: 8, notRun: 0, unscorable: 0, display: "9/16 (56.3%)", refs: [] },
        { key: "geometry", earned: 1.4, possible: 4, questions: 4, notRun: 0, unscorable: 2, display: "1.4/4 (35%)", refs: [] },
      ],
    },
  ],
};

export const scatterData: ScatterData = {
  pointDimension: "experiment",
  seriesDimension: "agent",
  x: costColumn, // better: "lower" → 轴反向(贵在左、便宜在右);两轴都有 better → 提示「越靠右上越好」
  y: passRateColumn,
  rows: [
    {
      key: "compare/bub-low",
      series: "bub",
      x: { value: 5, basis: "eval", samples: 6, total: 6, refs: [] },
      y: { value: 0.5, basis: "eval", samples: 6, total: 6, refs: [] },
    },
    {
      key: "compare/bub-high",
      series: "bub",
      x: { value: 10, basis: "eval", samples: 6, total: 6, refs: [] },
      y: { value: 0.9, basis: "eval", samples: 6, total: 6, refs: [] },
    },
    {
      key: "compare/codex-mid",
      series: "codex",
      x: { value: 7, basis: "eval", samples: 6, total: 6, refs: [] },
      y: { value: 0.6, basis: "eval", samples: 6, total: 6, refs: [] },
    },
    {
      // x 缺数据:这个点不画,注脚报 1 个点缺数据
      key: "compare/codex-broken",
      series: "codex",
      x: { value: null, basis: "eval", samples: 0, total: 6, refs: [] },
      y: { value: 0.7, basis: "eval", samples: 6, total: 6, refs: [] },
    },
  ],
};

export const lineData: LineData = {
  x: { key: "latencyMs", label: "Simulated latency", unit: "ms" },
  seriesDimension: "agents",
  y: passRateColumn,
  rows: [
    {
      key: "100",
      series: "1 agents",
      x: 100,
      xDisplay: "100ms",
      y: { value: 0.4, basis: "eval", samples: 6, total: 6, refs: [] },
    },
    {
      key: "300",
      series: "1 agents",
      x: 300,
      xDisplay: "300ms",
      y: { value: 0.3, basis: "eval", samples: 6, total: 6, refs: [] },
    },
    {
      key: "100",
      series: "16 agents",
      x: 100,
      xDisplay: "100ms",
      y: { value: 0.8, basis: "eval", samples: 6, total: 6, refs: [] },
    },
    {
      key: "300",
      series: "16 agents",
      x: 300,
      xDisplay: "300ms",
      y: { value: 0.7, basis: "eval", samples: 6, total: 6, refs: [] },
    },
    {
      // 未声明数值 flag 的 attempt:不伪造 x 值,注脚报数
      key: "null",
      series: "1 agents",
      x: null,
      xDisplay: "—",
      y: { value: 0.5, basis: "eval", samples: 6, total: 6, refs: [] },
    },
  ],
};

export const deltaData: DeltaData = {
  byDimension: "experiment",
  conditions: ["compare/baseline", "compare/agents-md"],
  rows: [
    {
      // 两条件判定一致:通过、tokens/成本下降(改善)
      key: "algebra/quadratic",
      flipped: false,
      cells: {
        "compare/baseline": {
          scoring: "pass",
          verdict: "passed",
          attempts: [locator("@1abcdef2")],
          totalTokens: 512300,
          totalCostUSD: 0.71,
          historical: false,
        },
        "compare/agents-md": {
          scoring: "pass",
          verdict: "passed",
          attempts: [locator("@1abcdef3")],
          totalTokens: 305100,
          totalCostUSD: 0.44,
          historical: false,
        },
      },
      delta: { "compare/agents-md": { tokens: -207200, costUSD: -0.27 } },
    },
    {
      // 翻转:baseline 失败、agents-md 通过
      key: "algebra/systems",
      flipped: true,
      cells: {
        "compare/baseline": {
          scoring: "pass",
          verdict: "failed",
          attempts: [locator("@2abcdef2")],
          totalTokens: 621000,
          totalCostUSD: 0.83,
          historical: false,
        },
        "compare/agents-md": {
          scoring: "pass",
          verdict: "passed",
          attempts: [locator("@2abcdef3")],
          totalTokens: 298400,
          totalCostUSD: 0.41,
          historical: false,
        },
      },
      delta: { "compare/agents-md": { tokens: -322600, costUSD: -0.42 } },
    },
    {
      // 只有 agents-md 有结果:baseline 侧缺数据,delta 不硬算成 0(整行没有 delta 键)
      key: "algebra/uv-lock",
      flipped: false,
      cells: {
        "compare/agents-md": {
          scoring: "pass",
          verdict: "passed",
          attempts: [locator("@3abcdef3")],
          totalTokens: 511800,
          totalCostUSD: 0.7,
          historical: false,
        },
      },
    },
  ],
  totals: {
    "compare/baseline": { scoringComposition: "pass", passed: 1, denominator: 2, totalTokens: 1133300, totalCostUSD: 1.54 },
    "compare/agents-md": { scoringComposition: "pass", passed: 3, denominator: 3, totalTokens: 1115300, totalCostUSD: 1.55 },
  },
  pairedDelta: {
    "compare/agents-md": {
      commonEvalIds: ["algebra/quadratic", "algebra/systems"],
      pass: { knownEvalIds: ["algebra/quadratic", "algebra/systems"], passRatePoints: 50 },
      tokens: -529800,
      costUSD: -0.69,
    },
  },
};

// ───────────────────────── 实体列表(ExperimentList / AttemptList)─────────────────────────

/** algebra/quadratic 在 compare/bub 上失败的那次 attempt——两条子失败夹具共用同一条。 */
const failedAttempt: AttemptListItem = {
  experimentId: "compare/bub",
  evalId: "algebra/quadratic",
  attempt: 3,
  agent: "bub",
  verdict: "failed",
  // 已按 Scoring display 契约折好的单行摘要;渲染面只做宽度截断,不重算
  failureSummary: "gate: roots-correct · expected x=2 · received x=3",
  moreFailures: 1,
  examScore: { value: 0, basis: "eval", samples: 1, total: 1, refs: [locator("@1a4a4a4a")] },
  // 通过制 eval:totalScore 不适用,null cell(与 examScore 并存不互斥)
  totalScore: { value: null, basis: "eval", samples: 0, total: 1, refs: [locator("@1a4a4a4a")] },
  durationMs: 32_000,
  costUSD: 0.12,
  startedAt: "2026-07-01T09:58:00Z",
  historical: false,
  locator: locator("@1a4a4a4a"),
};

const erroredAttempt: AttemptListItem = {
  experimentId: "compare/codex",
  evalId: "geometry/angles",
  attempt: 0,
  agent: "codex",
  verdict: "errored",
  // errored:结构化 error 的一层摘要(phase · code · message)
  failureSummary: "eval.run · unexpected-error · TypeError: cannot read properties of undefined (reading 'foo')",
  moreFailures: 0,
  examScore: { value: 0, basis: "eval", samples: 1, total: 1, refs: [locator("@1c1c1c1c")] },
  totalScore: { value: null, basis: "eval", samples: 0, total: 1, refs: [locator("@1c1c1c1c")] },
  durationMs: 4_500,
  costUSD: null,
  startedAt: "2026-07-01T11:29:00Z",
  historical: false,
  locator: locator("@1c1c1c1c"),
};

const failedRetryAttempt: AttemptListItem = {
  ...failedAttempt,
  attempt: 4,
  durationMs: 35_000,
  locator: locator("@1b5b5b5b"),
};

const passedAttempt: AttemptListItem = {
  experimentId: "compare/bub",
  evalId: "algebra/simple",
  attempt: 0,
  agent: "bub",
  verdict: "passed",
  failureSummary: null,
  moreFailures: 0,
  examScore: { value: 1, basis: "eval", samples: 1, total: 1, refs: [locator("@1d2d2d2d")] },
  totalScore: { value: null, basis: "eval", samples: 0, total: 1, refs: [locator("@1d2d2d2d")] },
  durationMs: 5_000,
  costUSD: 0.02,
  startedAt: "2026-07-01T09:59:00Z",
  historical: false,
  locator: locator("@1d2d2d2d"),
};

export const attemptListItems: AttemptListItem[] = [failedAttempt, erroredAttempt];

export const experimentListItems: ExperimentListItem[] = [
  {
    experimentId: "compare/bub",
    agent: "bub",
    model: "gpt-5.4",
    flags: { memory: true },
    scoring: "pass",
    evalVerdicts: { passed: 1, failed: 1, errored: 0, unreadable: 0 },
    endToEndPassRate: { value: 0.5, basis: "eval", samples: 2, total: 2, refs: [] },
    totalScore: { value: null, basis: "eval", samples: 0, total: 2, refs: [] },
    costUSD: { value: 0.12, basis: "eval", samples: 1, total: 2, refs: [failedAttempt.locator] },
    durationMs: { value: 32_000, basis: "eval", samples: 2, total: 2, refs: [] },
    tokens: { value: null, basis: "eval", samples: 0, total: 2, refs: [] },
    evals: 2,
    attempts: 3,
    historicalAttempts: 0,
    missingEvalIds: [],
    lastRunAt: "2026-07-01T10:00:00Z",
    evalRows: [
      {
        evalId: "algebra/quadratic",
        verdict: "failed",
        totalScore: { value: null, basis: "eval", samples: 0, total: 1, refs: [failedAttempt.locator] },
        durationMs: { value: 32_000, basis: "eval", samples: 1, total: 1, refs: [failedAttempt.locator] },
        costUSD: { value: 0.12, basis: "eval", samples: 1, total: 1, refs: [failedAttempt.locator] },
        tokens: { value: null, basis: "eval", samples: 0, total: 1, refs: [failedAttempt.locator] },
        attempts: [failedAttempt, failedRetryAttempt],
      },
      {
        evalId: "algebra/simple",
        verdict: "passed",
        totalScore: { value: null, basis: "eval", samples: 0, total: 1, refs: [] },
        durationMs: { value: 5_000, basis: "eval", samples: 1, total: 1, refs: [] },
        costUSD: { value: 0.02, basis: "eval", samples: 1, total: 1, refs: [] },
        tokens: { value: null, basis: "eval", samples: 0, total: 1, refs: [] },
        attempts: [passedAttempt],
      },
    ],
  },
  {
    experimentId: "compare/codex",
    agent: "codex",
    scoring: "pass",
    evalVerdicts: { passed: 0, failed: 0, errored: 1, unreadable: 0 },
    endToEndPassRate: { value: 0, basis: "eval", samples: 1, total: 1, refs: [] },
    totalScore: { value: null, basis: "eval", samples: 0, total: 1, refs: [] },
    costUSD: { value: null, basis: "eval", samples: 0, total: 1, refs: [] },
    durationMs: { value: 4_500, basis: "eval", samples: 1, total: 1, refs: [] },
    tokens: { value: null, basis: "eval", samples: 0, total: 1, refs: [] },
    evals: 1,
    attempts: 1,
    historicalAttempts: 0,
    missingEvalIds: [],
    lastRunAt: "2026-07-01T11:30:00Z",
    evalRows: [
      {
        evalId: "geometry/angles",
        verdict: "errored",
        totalScore: { value: null, basis: "eval", samples: 0, total: 1, refs: [] },
        durationMs: { value: 4_500, basis: "eval", samples: 1, total: 1, refs: [erroredAttempt.locator] },
        costUSD: { value: null, basis: "eval", samples: 0, total: 1, refs: [] },
        tokens: { value: null, basis: "eval", samples: 0, total: 1, refs: [erroredAttempt.locator] },
        attempts: [erroredAttempt],
      },
    ],
  },
];
