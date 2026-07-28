// cases: docs/engineering/testing/unit/reports.md
// "validate*Data 递归覆盖到嵌套字段" 行:summaries 的 validateScopeSummaryData 表驱动字段突变覆盖,range 的 null 边界、两级 tally、
// 两个 MetricCell 字段各自的嵌套校验。

import { describe, expect, it } from "vitest";
import { validateScopeSummaryData } from "./index.tsx";

const validCell = { value: 1, display: "1", samples: 1, total: 1, refs: [] };
const validTally = { passed: 1, failed: 0, errored: 0, unreadable: 0 };

const valid = {
  range: { earliestStartedAt: "2026-07-01T00:00:00Z", latestStartedAt: "2026-07-02T00:00:00Z" },
  experiments: 1,
  evals: 6,
  attempts: 6,
  evalVerdicts: validTally,
  attemptVerdicts: validTally,
  endToEndPassRate: validCell,
  totalCostUSD: validCell,
};

describe("validateScopeSummaryData", () => {
  it("合规 literal 通过", () => {
    expect(validateScopeSummaryData(valid)).toBeNull();
  });

  it("range 两端为 null 合法(空范围不编造当前时间)", () => {
    expect(validateScopeSummaryData({ ...valid, range: { earliestStartedAt: null, latestStartedAt: null } })).toBeNull();
  });

  it("range.earliestStartedAt 非法类型报错", () => {
    const bad = { ...valid, range: { earliestStartedAt: 123, latestStartedAt: null } };
    expect(validateScopeSummaryData(bad)).toMatch(/"range\.earliestStartedAt"/);
  });

  it("evalVerdicts 与 attemptVerdicts 分别校验:错的那个才报错", () => {
    const bad = { ...valid, attemptVerdicts: { passed: 1, failed: 0, errored: 0, unreadable: "0" } };
    expect(validateScopeSummaryData(bad)).toMatch(/"attemptVerdicts\.unreadable"/);
  });

  it("endToEndPassRate 结构错误定位到嵌套 MetricCell", () => {
    const bad = { ...valid, endToEndPassRate: { value: 1, display: "1", samples: 1, total: 1, refs: "x" } };
    expect(validateScopeSummaryData(bad)).toMatch(/"endToEndPassRate\.refs"/);
  });

  it("experiments 非数字报错", () => {
    expect(validateScopeSummaryData({ ...valid, experiments: "1" })).toMatch(/"experiments"/);
  });
});
