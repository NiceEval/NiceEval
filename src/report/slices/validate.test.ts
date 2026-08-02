// cases: docs/engineering/testing/unit/reports.md
// "validate*Data 递归覆盖到嵌套字段" 行:metric-views 六个 validate*Data 的表驱动字段突变覆盖,每个校验函数先证明合规 literal 通过,
// 再对嵌套字段(MetricColumn / MetricCell / tally)逐个突变,证明报错文案定位到具体坏字段
// 路径而不是笼统的整份 data 报错。不复制 compute.ts 的聚合逻辑——fixture 是手写的合规
// literal,不经由真实计算产出。

import { describe, expect, it } from "vitest";
import {
  validateDeltaData,
  validateLineData,
  validateMatrixData,
  validateScoreboardData,
  validateStabilityMatrixData,
} from "./validate.ts";

const validCell = { value: 1, basis: "eval", samples: 1, total: 1, refs: ["@1abcdef2"] };
const validColumn = { key: "costUSD", label: "Cost" };

describe("validateMatrixData", () => {
  const valid = {
    rowDimension: "agent",
    columnDimension: "eval",
    metric: validColumn,
    cells: [{ row: "agent-x", column: "q1", cell: validCell }],
  };

  it("合规 literal 通过", () => {
    expect(validateMatrixData(valid)).toBeNull();
  });

  it("metric 缺 label 报错", () => {
    expect(validateMatrixData({ ...valid, metric: { key: "costUSD" } })).toMatch(/"metric\.label"/);
  });

  it("cells[i].cell 结构错误定位到该格", () => {
    const bad = { ...valid, cells: [{ row: "agent-x", column: "q1", cell: { value: 1 } }] };
    expect(validateMatrixData(bad)).toMatch(/"cells\[0\]\.cell/);
  });

  it("cells[i].column 非字符串报错", () => {
    const bad = { ...valid, cells: [{ row: "agent-x", column: 1, cell: validCell }] };
    expect(validateMatrixData(bad)).toMatch(/"cells\[0\]\.column"/);
  });
});

describe("validateLineData", () => {
  const valid = {
    x: { key: "turn", label: "Turn" },
    y: validColumn,
    rows: [{ key: "1", x: 1, y: validCell, xDisplay: "1" }],
  };

  it("合规 literal 通过", () => {
    expect(validateLineData(valid)).toBeNull();
  });

  it("x 轴缺 label 报错", () => {
    expect(validateLineData({ ...valid, x: { key: "turn" } })).toMatch(/"x" must be an axis descriptor/);
  });

  it("rows[i].x 类型错误(非 number|null)报错", () => {
    const bad = { ...valid, rows: [{ key: "1", x: "1", y: validCell, xDisplay: "1" }] };
    expect(validateLineData(bad)).toMatch(/"rows\[0\]\.x"/);
  });

  it("rows[i].y 缺失报错定位到嵌套 MetricCell", () => {
    const bad = { ...valid, rows: [{ key: "1", x: 1, xDisplay: "1" }] };
    expect(validateLineData(bad)).toMatch(/"rows\[0\]\.y"/);
  });
});

describe("validateScoreboardData", () => {
  const validSubject = {
    key: "security",
    earned: 1,
    possible: 1,
    questions: 1,
    notRun: 0,
    unscorable: 0,
    display: "100%",
    refs: [],
  };
  const valid = {
    rowDimension: "agent",
    questions: ["q1"],
    fullMarks: 100,
    ignoredEvals: 0,
    rows: [
      {
        key: "agent-x",
        total: { value: 100, display: "100%", notRun: 0, unscorable: 0, refs: [] },
        subjects: [validSubject],
      },
    ],
  };

  it("合规 literal 通过", () => {
    expect(validateScoreboardData(valid)).toBeNull();
  });

  it("rows[i].total 缺 notRun 报错", () => {
    const bad = {
      ...valid,
      rows: [{ ...valid.rows[0], total: { value: 100, display: "100%", unscorable: 0, refs: [] } }],
    };
    expect(validateScoreboardData(bad)).toMatch(/"rows\[0\]\.total\.notRun"/);
  });

  it("rows[i].subjects[j] 缺 possible 报错定位到该 subject 下标", () => {
    const bad = {
      ...valid,
      rows: [{ ...valid.rows[0], subjects: [{ ...validSubject, possible: undefined }] }],
    };
    expect(validateScoreboardData(bad)).toMatch(/"rows\[0\]\.subjects\[0\]\.possible"/);
  });
});

describe("validateDeltaData", () => {
  const validDeltaCell = {
    evaluationKind: "pass",
    verdict: "passed",
    attempts: ["@1abcdef2"],
    totalTokens: 1000,
    totalCostUSD: 0.1,
    historical: false,
  };
  const valid = {
    byDimension: "experiment",
    conditions: ["baseline", "agents-md"],
    rows: [
      {
        key: "coding/a",
        flipped: false,
        cells: { baseline: validDeltaCell, "agents-md": validDeltaCell },
        delta: { "agents-md": { tokens: 0, costUSD: 0 } },
      },
    ],
    totals: { baseline: { evaluationKindComposition: "pass", passed: 1, denominator: 1 } },
    pairedDelta: { "agents-md": { commonEvalIds: ["coding/a"], pass: { knownEvalIds: ["coding/a"], passRatePoints: 0 } } },
  };

  it("合规 literal 通过", () => {
    expect(validateDeltaData(valid)).toBeNull();
  });

  it("cells.<condition>.verdict 不在枚举内报错", () => {
    const bad = {
      ...valid,
      rows: [{ ...valid.rows[0], cells: { ...valid.rows[0].cells, baseline: { ...validDeltaCell, verdict: "flaky" } } }],
    };
    expect(validateDeltaData(bad)).toMatch(/"rows\[0\]\.cells\.baseline\.verdict"/);
  });

  it("cells.<condition>.attempts 结构错误定位到该条件", () => {
    const bad = {
      ...valid,
      rows: [{ ...valid.rows[0], cells: { ...valid.rows[0].cells, baseline: { ...validDeltaCell, attempts: "@1abcdef2" } } }],
    };
    expect(validateDeltaData(bad)).toMatch(/"rows\[0\]\.cells\.baseline\.attempts"/);
  });

  it("rows[i].flipped 缺失报错", () => {
    const bad = { ...valid, rows: [{ key: "coding/a", cells: valid.rows[0].cells }] };
    expect(validateDeltaData(bad)).toMatch(/"rows\[0\]\.flipped"/);
  });

  it("totals.<condition>.evaluationKindComposition 不在三态内报错", () => {
    const bad = { ...valid, totals: { baseline: { evaluationKindComposition: "half" } } };
    expect(validateDeltaData(bad)).toMatch(/"totals\.baseline\.evaluationKindComposition"/);
  });

  it("pairedDelta.<condition>.commonEvalIds 非字符串数组报错", () => {
    const bad = { ...valid, pairedDelta: { "agents-md": { commonEvalIds: "coding/a" } } };
    expect(validateDeltaData(bad)).toMatch(/"pairedDelta\.agents-md\.commonEvalIds"/);
  });
});

describe("validateStabilityMatrixData", () => {
  const validStabilityCell = { passed: 1, failed: 0, errored: 0, executions: 1 };
  const valid = {
    rowDimension: "eval",
    columnDimension: "experiment",
    rows: [{ evalId: "coding/a", neverPassed: false }],
    columns: ["exp-a"],
    cells: [{ row: "coding/a", column: "exp-a", cell: validStabilityCell }],
    totals: { "exp-a": validStabilityCell },
  };

  it("合规 literal 通过", () => {
    expect(validateStabilityMatrixData(valid)).toBeNull();
  });

  it("rows[i].neverPassed 非布尔报错", () => {
    const bad = { ...valid, rows: [{ evalId: "coding/a", neverPassed: "no" }] };
    expect(validateStabilityMatrixData(bad)).toMatch(/"rows\[0\]\.neverPassed"/);
  });

  it("cells[i].cell 结构错误定位到该格", () => {
    const bad = { ...valid, cells: [{ row: "coding/a", column: "exp-a", cell: { passed: 1 } }] };
    expect(validateStabilityMatrixData(bad)).toMatch(/"cells\[0\]\.cell/);
  });

  it("totals.<column> 缺字段报错", () => {
    const bad = { ...valid, totals: { "exp-a": { passed: 1, failed: 0, errored: 0 } } };
    expect(validateStabilityMatrixData(bad)).toMatch(/"totals\.exp-a\.executions"/);
  });
});
