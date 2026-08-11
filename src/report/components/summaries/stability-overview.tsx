// StabilityOverview:stability 视图的主体——读数格 + 稳定性散点 + 判定构成堆叠柱 + 矩阵。
// 全部区块来自 stabilityMatrix 一次计算与字面投影,不新增聚合口径
// (docs/feature/reports/README.md)。

import { defineComponent } from "../../definition/tree.ts";
import { Chart, Col, Grid, Series, Stat, TableContentView } from "../../definition/primitives.tsx";
import type { Dataset, DimensionInput } from "../../model/types.ts";
import type { Sample } from "../../../record/types.ts";
import { DEFAULT_REPORT_LOCALE, localeText, type ReportLocale } from "../../model/locale.ts";
import { stabilityMatrixData } from "../../slices/compute.ts";
import { stabilityMatrixContent } from "../../slices/content.ts";

export interface StabilityOverviewProps {
  input?: Sample;
  /** 条件维度;缺省 "experiment",与 show --stats 相同。 */
  columns?: DimensionInput;
  /** 聚合前收窄题集。 */
  evals?: string | readonly string[];
  locale?: ReportLocale;
  className?: string;
}

export const StabilityOverview = defineComponent<StabilityOverviewProps>(async (props, ctx) => {
  const input: Sample = props.input ?? ctx.scope;
  const locale = props.locale ?? DEFAULT_REPORT_LOCALE;
  const content = stabilityMatrixContent(
    await stabilityMatrixData(input, { by: props.columns ?? "experiment", evals: props.evals }),
  );
  const conditions = content.columns
    .map((column) => column.key)
    .filter((key) => key !== "eval" && key !== "total");

  // 散点:一点一格(eval × 条件),x = 执行次数,y = 历史通过率;y=0 一排即零通过题,
  // 0 与 1 之间即闪烁。闪烁判据:任一条件格 0 < passed < executions,全过与全挂都不算。
  const points: Dataset["rows"][number][] = [];
  let flaky = 0;
  for (const row of content.rows) {
    let rowFlaky = false;
    for (const condition of conditions) {
      const cell = row.cells[condition];
      if (cell?.kind !== "verdict" || !cell.counts) continue;
      const n = cell.counts.passed + cell.counts.failed + cell.counts.errored;
      if (n === 0) continue;
      if (cell.counts.passed > 0 && cell.counts.passed < n) rowFlaky = true;
      const refs = [...(cell.refs ?? [])];
      const ratio = cell.counts.passed / n;
      points.push({
        key: `${row.evalId} · ${condition}`,
        values: {
          eval: row.evalId,
          condition,
          executions: { value: n, basis: "eval", samples: n, total: n, refs },
          passRatio: { value: ratio, unit: "%", better: "higher", bounds: { min: 0, max: 1 }, basis: "eval", samples: n, total: n, refs },
        },
      });
    }
    if (rowFlaky) flaky += 1;
  }
  const scatter: Dataset = {
    fields: [
      { name: "eval", kind: "dimension", valueType: "string" },
      { name: "condition", kind: "dimension", valueType: "string" },
      { name: "executions", kind: "metric", valueType: "number" },
      { name: "passRatio", kind: "metric", valueType: "number", better: "higher", bounds: { min: 0, max: 1 } },
    ],
    rows: points,
  };

  // 堆叠柱:一条件一柱,passed / failed / errored 三段与矩阵合计行同值。
  const bars: Dataset = {
    fields: [
      { name: "condition", kind: "dimension", valueType: "string" },
      { name: "passed", kind: "metric", valueType: "number" },
      { name: "failed", kind: "metric", valueType: "number" },
      { name: "errored", kind: "metric", valueType: "number" },
    ],
    rows: Object.entries(content.totals).map(([condition, totals]) => ({
      key: condition,
      values: { condition, passed: totals.passed, failed: totals.failed, errored: totals.errored },
    })),
  };

  const executions = Object.values(content.totals).reduce((sum, totals) => sum + totals.executions, 0);
  const neverPassed = content.rows.filter((row) => row.neverPassed).length;

  return (
    <Col className={props.className}>
      <Grid>
        <Stat label={localeText(locale, "stabilityOverview.executions")} value={executions} />
        <Stat label={localeText(locale, "stabilityOverview.neverPassed")} value={neverPassed} />
        <Stat label={localeText(locale, "stabilityOverview.flaky")} value={flaky} />
      </Grid>
      <Chart data={scatter} x="executions" y="passRatio" legend tooltip locale={props.locale}>
        <Series id="stability" mark="scatter" points="eval" by="condition" />
      </Chart>
      <Chart data={bars} x="condition" y="passed" legend tooltip locale={props.locale}>
        <Series id="passed" mark="bar" y="passed" stack="verdicts" />
        <Series id="failed" mark="bar" y="failed" stack="verdicts" />
        <Series id="errored" mark="bar" y="errored" stack="verdicts" />
      </Chart>
      <TableContentView data={content} locale={props.locale} />
    </Col>
  );
});
StabilityOverview.displayName = "StabilityOverview";
