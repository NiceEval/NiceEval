// cases: docs/engineering/testing/unit/reports.md
// 「Chart 呈现覆盖」「维度绑定的三件通用能力」——Chart 条目。

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import type { Dataset, MetricValue } from "../model/types.ts";
import {
  collectPageDimensions,
  createTextContext,
  renderNodeToText,
  resolveReportTree,
  runWithWebContext,
  validateReportTree,
  withPageDimensions,
  ResolveMemo,
  type ReportElement,
  type WebContext,
} from "./tree.ts";
import { buildReportMeta, defineReport } from "./report.ts";
import { Chart, Series } from "./primitives/chart.tsx";
import { emptyScopeAndResults, scopeOf } from "../components/scope.harness.ts";
import { UndeclaredDimensionValueError } from "../presentation.ts";

function cell(value: number | null): MetricValue {
  return {
    value,
    samples: value === null ? 0 : 1,
    total: 1,
    basis: "eval",
    refs: [],
  };
}

const dataset: Dataset = {
  fields: [
    { name: "experiment", kind: "dimension", valueType: "string" },
    { name: "agent", kind: "dimension", valueType: "string" },
    { name: "costUSD", kind: "metric", valueType: "number", unit: "$", better: "lower" },
    { name: "passRate", kind: "metric", valueType: "number", unit: "%", better: "higher", bounds: { min: 0, max: 1 } },
  ],
  rows: [
    {
      key: "proj/a",
      values: {
        experiment: "proj/a",
        agent: "codex",
        costUSD: cell(0.4),
        passRate: cell(0.9),
      },
    },
    {
      key: "proj/b",
      values: {
        experiment: "proj/b",
        agent: "claude",
        costUSD: cell(null),
        passRate: cell(0.5),
      },
    },
  ],
};

async function resolve(node: React.ReactNode) {
  const scope = scopeOf([]);
  const { results } = emptyScopeAndResults();
  const definition = defineReport(() => node as never);
  const resolved = await resolveReportTree(node as never, {
    scope,
    results,
    report: buildReportMeta(definition, scope),
    page: { id: "main", input: "sample" },
    memo: new ResolveMemo(),
  });
  validateReportTree(resolved);
  return resolved as ReportElement;
}

function chartTree(overrides: Record<string, unknown> = {}) {
  return (
    <Chart data={dataset} x="costUSD" y="passRate" legend {...overrides}>
      <Series id="frontier" mark="scatter" points="experiment" by="agent" />
    </Chart>
  );
}

function renderWeb(tree: ReportElement): string {
  const plan = collectPageDimensions(tree, {}, "web");
  const webCtx = withPageDimensions({ locale: "en" } as WebContext, plan);
  return runWithWebContext(webCtx, () => renderToStaticMarkup(tree as never));
}

describe("Chart", () => {
  it("两面投影:散点图、坐标表与缺数据注脚", async () => {
    const tree = await resolve(chartTree());
    const text = renderNodeToText(tree, createTextContext({ width: 80 }));
    expect(text).toContain("costUSD");
    expect(text).toContain("passRate");
    expect(text).toContain("proj/a");
    expect(text).not.toContain("proj/b");
    expect(text).toMatch(/1 point/i);

    const html = renderWeb(tree);
    expect(html).toContain("niceeval-chart");
    expect(html).toContain("niceeval-chart-svg");
    expect(html).toContain("niceeval-chart-legend");
    expect(html).not.toContain("proj/b");
  });

  it("Chart.series 未知 key 给出完整用户反馈", async () => {
    const tree = await resolve(
      <Chart data={dataset} x="costUSD" y="passRate" series={{ ghost: { hidden: true } }}>
        <Series id="frontier" mark="scatter" points="experiment" by="agent" />
      </Chart>,
    );
    expect(() => renderNodeToText(tree, createTextContext({ width: 80 }))).toThrow(/unknown series id.*ghost/i);
  });

  it("dimensions 声明 agent 系列;查询未声明句柄失败", async () => {
    const tree = await resolve(chartTree());
    const plan = collectPageDimensions(tree, {}, "web");
    expect(plan.dimension(tree.props, "agent").at(0).value).toBe("codex");
    expect(() => plan.dimension(tree.props, "missing")).toThrow(UndeclaredDimensionValueError);
  });

  it("null measure 不画点", async () => {
    const tree = await resolve(chartTree());
    const text = renderNodeToText(tree, createTextContext({ width: 80 }));
    expect(text).not.toContain("proj/b");
    const onlyA = dataset.rows.filter((r) => r.values.costUSD && (r.values.costUSD as MetricValue).value !== null);
    expect(onlyA).toHaveLength(1);
  });


});
