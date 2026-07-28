// StabilityOverview:stability 视图的主体——读数格 + 稳定性散点 + 判定构成堆叠柱 + 矩阵。
// 全部区块来自 sources.measure.stability 的一次 resolve 与字面投影,不新增聚合口径
// (docs/feature/reports/components/summaries/stability-overview.md)。

import { defineComposition } from "../../source.ts";
import { Chart, Col, Grid, Series, Stat, Table } from "../../definition/primitives.tsx";
import type { Dataset, DimensionInput } from "../../model/types.ts";
import type { Sample } from "../../../record/types.ts";
import { formatPercent, formatPlainNumber } from "../../model/format.ts";
import { DEFAULT_REPORT_LOCALE, localeText, type ReportLocale } from "../../model/locale.ts";
import { sources } from "../../sources.ts";

export interface StabilityOverviewProps {
  input?: Sample;
  /** 条件维度;缺省 "experiment",与 show --stats 相同。 */
  columns?: DimensionInput;
  /** 聚合前收窄题集;透传给 sources.measure.stability。 */
  evals?: string | readonly string[];
  locale?: ReportLocale;
  className?: string;
}

export const StabilityOverview = defineComposition<StabilityOverviewProps, Sample>(async (props, ctx) => {
  const input: Sample = props.input ?? ctx.input;
  const locale = props.locale ?? DEFAULT_REPORT_LOCALE;
  const content = await ctx.resolve(
    sources.measure.stability({ by: props.columns ?? "experiment", evals: props.evals }),
    input,
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
          executions: { value: n, display: formatPlainNumber(n), samples: n, total: n, refs },
          passRatio: { value: ratio, display: formatPercent(ratio), samples: n, total: n, refs },
        },
      });
    }
    if (rowFlaky) flaky += 1;
  }
  const scatter: Dataset = {
    fields: [
      { name: "eval", kind: "dimension", valueType: "string" },
      { name: "condition", kind: "dimension", valueType: "string" },
      { name: "executions", kind: "measure", valueType: "number" },
      { name: "passRatio", kind: "measure", valueType: "number", better: "higher", bounds: { min: 0, max: 1 } },
    ],
    rows: points,
  };

  // 堆叠柱:一条件一柱,passed / failed / errored 三段与矩阵合计行同值。
  const bars: Dataset = {
    fields: [
      { name: "condition", kind: "dimension", valueType: "string" },
      { name: "passed", kind: "measure", valueType: "number" },
      { name: "failed", kind: "measure", valueType: "number" },
      { name: "errored", kind: "measure", valueType: "number" },
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
      <Grid variant="boxed">
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
      <Table data={content} locale={props.locale} />
    </Col>
  );
});
StabilityOverview.displayName = "StabilityOverview";
