// 内建 page 的 Result -> ReportNode 纯呈现层。这里不读取 Sample / AttemptEvidence，
// 所有计算已经由 tasks.ts 完成。

import type { ReportTarget } from "../definition/report.ts";
import { defineComponent } from "../definition/tree.ts";
import {
  Callouts,
  Chart,
  Col,
  Conversation,
  CopyBlock,
  DiffView,
  Grid,
  Scatter,
  Series,
  SourceView,
  Stat,
  TableContentView,
  Text,
  Waterfall,
} from "../definition/primitives.tsx";
import { HeroCard } from "../components/site-components/index.tsx";
import { AttemptSummary } from "../components/attempt-detail/index.tsx";
import { experimentListContent } from "../components/entity-lists/content.ts";
import {
  attemptAssertionsContent,
  attemptConversationContent,
  attemptDiffContent,
  attemptFixPromptContent,
  attemptNoticesContent,
  projectedSourceContent,
  attemptTimelineContent,
} from "../components/attempt-detail/content.tsx";
import { stabilityMatrixContent } from "../slices/content.ts";
import {
  formatInstant,
  formatReportDateTimeRange,
} from "../model/format.ts";
import { DEFAULT_REPORT_LOCALE, localeText, type ReportLocale } from "../model/locale.ts";
import type { Dataset, UsageTableData } from "../model/types.ts";
import type { MetricValue } from "../model/calculation.ts";
import type {
  AttemptDetailsResult,
  StabilityResult,
  StandardOverviewPoint,
  StandardOverviewResult,
} from "../tasks.ts";

interface PassPoint {
  refs: readonly import("../../record/locator.ts").AttemptLocator[];
  experiment: string;
  series: string;
  costUSD: MetricValue;
  passRate: MetricValue;
}

interface ScorePoint {
  refs: readonly import("../../record/locator.ts").AttemptLocator[];
  experiment: string;
  series: string;
  costUSD: MetricValue;
  totalScore: MetricValue;
}

function experimentTarget(point: { key: string }): ReportTarget {
  return { page: "experiment", params: { experiment: point.key } };
}

function summaryView(result: StandardOverviewResult, locale: ReportLocale) {
  const snapshot = result.summary;
  const tally = snapshot.evalVerdicts;
  const formattedRange =
    snapshot.range.earliestStartedAt !== null && snapshot.range.latestStartedAt !== null
      ? formatReportDateTimeRange(
          snapshot.range.earliestStartedAt,
          snapshot.range.latestStartedAt,
          locale,
        )
      : null;
  return (
    <Col className="niceeval-sample-summary">
      <Grid>
        {snapshot.evaluationKindComposition !== "points" ? (
          <Stat
            label={localeText(locale, "scopeSummary.passRate")}
            value={{ kind: "metric", metric: snapshot.endToEndPassRate }}
          />
        ) : null}
        {snapshot.totalScore !== undefined ? (
          <Stat
            label={localeText(locale, "scopeSummary.totalScore")}
            value={{ kind: "metric", metric: snapshot.totalScore }}
          />
        ) : null}
        <Stat label={localeText(locale, "scopeSummary.experiments")} value={snapshot.experiments} />
        <Stat label={localeText(locale, "scopeSummary.evals")} value={snapshot.evals} />
        <Stat label={localeText(locale, "scopeSummary.attempts")} value={snapshot.attempts} />
        <Stat
          label={localeText(locale, "scopeSummary.votesEval")}
          value={{ kind: "verdict", counts: tally }}
        />
        <Stat
          label={localeText(locale, "scopeSummary.totalCost")}
          value={{ kind: "metric", metric: snapshot.totalCostUSD }}
          detail={
            snapshot.totalCostUSD.samples < snapshot.totalCostUSD.total
              ? localeText(locale, "scopeSummary.costCoverage", {
                  samples: snapshot.totalCostUSD.samples,
                  total: snapshot.totalCostUSD.total,
                })
              : undefined
          }
        />
      </Grid>
      {snapshot.range.latestStartedAt !== null ? (
        <Text className="niceeval-sample-summary-range">
          {snapshot.range.earliestStartedAt !== null &&
          snapshot.range.earliestStartedAt !== snapshot.range.latestStartedAt
            ? localeText(locale, "scopeSummary.runRange", {
                from: formattedRange!.from,
                to: formattedRange!.to,
              })
            : localeText(locale, "scopeSummary.lastRun", {
                time: formatInstant(snapshot.range.latestStartedAt, locale),
              })}
        </Text>
      ) : null}
    </Col>
  );
}

export const StandardOverviewResultView = defineComponent<{
  result: StandardOverviewResult;
}>(async ({ result }, ctx) => {
  const table = experimentListContent(result.experiments);
  const hasPassRate = table.columns.some((column) => column.key === "passRate");
  const hasTotalScore = table.columns.some((column) => column.key === "totalScore");
  const defaultSort = hasPassRate === hasTotalScore
    ? undefined
    : hasPassRate
      ? "passRate"
      : "totalScore";
  return (
    <Col>
      <HeroCard title={ctx.report.title} data={result.hero} />
      <Callouts items={result.notices} />
      <Callouts items={result.diagnostics} />
      <CopyBlock content={result.fixPrompt} />
      {summaryView(result, DEFAULT_REPORT_LOCALE)}
      <Col>
        {result.charts.map((chart) =>
          chart.y === "passRate" ? (
            <Scatter
              key={chart.y}
              points={chart.points as readonly PassPoint[]}
              x="costUSD"
              y="passRate"
              point="experiment"
              series="series"
              connect={chart.connect}
              pointTarget={experimentTarget}
              legend
            />
          ) : (
            <Scatter
              key={chart.y}
              points={chart.points as readonly ScorePoint[]}
              x="costUSD"
              y="totalScore"
              point="experiment"
              series="series"
              connect={chart.connect}
              pointTarget={experimentTarget}
              legend
            />
          ),
        )}
      </Col>
      <TableContentView data={table} sort={defaultSort} searchable />
    </Col>
  );
});
StandardOverviewResultView.displayName = "StandardOverviewResultView";

function stabilityPresentation(result: StabilityResult): {
  executions: number;
  neverPassed: number;
  flaky: number;
  scatter: Dataset;
  bars: Dataset;
} {
  const content = stabilityMatrixContent(result);
  const conditions = content.columns
    .map((column) => column.key)
    .filter((key) => key !== "eval" && key !== "total");
  const points: Dataset["rows"][number][] = [];
  let flaky = 0;
  for (const row of content.rows) {
    let rowFlaky = false;
    for (const condition of conditions) {
      const cell = row.cells[condition];
      if (cell?.kind !== "verdict" || !cell.counts) continue;
      const executions = cell.counts.passed + cell.counts.failed + cell.counts.errored;
      if (executions === 0) continue;
      if (cell.counts.passed > 0 && cell.counts.passed < executions) rowFlaky = true;
      const refs = [...(cell.refs ?? [])];
      points.push({
        key: `${row.evalId} · ${condition}`,
        values: {
          eval: row.evalId,
          condition,
          executions: { value: executions, basis: "eval", samples: executions, total: executions, refs },
          passRatio: {
            value: cell.counts.passed / executions,
            unit: "%",
            better: "higher",
            bounds: { min: 0, max: 1 },
            basis: "eval",
            samples: executions,
            total: executions,
            refs,
          },
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
      {
        name: "passRatio",
        kind: "metric",
        valueType: "number",
        better: "higher",
        bounds: { min: 0, max: 1 },
      },
    ],
    rows: points,
  };
  const bars: Dataset = {
    fields: [
      { name: "condition", kind: "dimension", valueType: "string" },
      { name: "passed", kind: "metric", valueType: "number" },
      { name: "failed", kind: "metric", valueType: "number" },
      { name: "errored", kind: "metric", valueType: "number" },
    ],
    rows: Object.entries(content.totals).map(([condition, totals]) => ({
      key: condition,
      values: {
        condition,
        passed: totals.passed,
        failed: totals.failed,
        errored: totals.errored,
      },
    })),
  };
  return {
    executions: Object.values(content.totals).reduce((sum, totals) => sum + totals.executions, 0),
    neverPassed: content.rows.filter((row) => row.neverPassed).length,
    flaky,
    scatter,
    bars,
  };
}

export const StabilityResultView = defineComponent<{ result: StabilityResult }>(
  ({ result }, ctx) => {
    const content = stabilityMatrixContent(result);
    const view = stabilityPresentation(result);
    return (
      <Col>
        <Grid>
          <Stat label={localeText(DEFAULT_REPORT_LOCALE, "stabilityOverview.executions")} value={view.executions} />
          <Stat label={localeText(DEFAULT_REPORT_LOCALE, "stabilityOverview.neverPassed")} value={view.neverPassed} />
          <Stat label={localeText(DEFAULT_REPORT_LOCALE, "stabilityOverview.flaky")} value={view.flaky} />
        </Grid>
        <Chart data={view.scatter} x="executions" y="passRatio" legend tooltip>
          <Series id="stability" mark="scatter" points="eval" by="condition" />
        </Chart>
        <Chart data={view.bars} x="condition" y="passed" legend tooltip>
          <Series id="passed" mark="bar" y="passed" stack="verdicts" />
          <Series id="failed" mark="bar" y="failed" stack="verdicts" />
          <Series id="errored" mark="bar" y="errored" stack="verdicts" />
        </Chart>
        <TableContentView data={content} />
      </Col>
    );
  },
);
StabilityResultView.displayName = "StabilityResultView";

const TaskUsageResultView = defineComponent<{ data: UsageTableData }>(({ data }) => {
  const rows: Array<[string, string]> = [];
  if (data.turns !== undefined) rows.push(["turns", String(data.turns)]);
  if (data.toolCalls !== undefined) rows.push(["tool calls", String(data.toolCalls)]);
  if (data.usage?.inputTokens !== undefined) {
    rows.push([
      data.usage.cacheReadTokens !== undefined ? "uncached in" : "in",
      data.usage.inputTokens.toLocaleString(),
    ]);
  }
  if (data.usage?.cacheReadTokens !== undefined) {
    rows.push(["cache read", data.usage.cacheReadTokens.toLocaleString()]);
  }
  if (data.usage?.outputTokens !== undefined) {
    rows.push(["out", data.usage.outputTokens.toLocaleString()]);
  }
  if (data.usage?.requests !== undefined) rows.push(["requests", String(data.usage.requests)]);
  if (data.estimatedCostUSD !== undefined) rows.push(["cost", `$${data.estimatedCostUSD.toFixed(4)}`]);
  if (rows.length === 0) return null;
  return (
    <Grid className="niceeval-usage-table">
      {rows.map(([label, value]) => (
        <div key={label} className="niceeval-kpi">
          <span className="niceeval-kpi-label">{label}</span>
          <span className="niceeval-kpi-value">{value}</span>
        </div>
      ))}
    </Grid>
  );
});
TaskUsageResultView.displayName = "TaskUsageResultView";

export const AttemptDetailsResultView = defineComponent<{
  result: AttemptDetailsResult;
}>(({ result }) => {
  const notices = attemptNoticesContent(result.error, result.diagnostics) ?? [];
  const source = projectedSourceContent(result.source.source, result.source.locator);
  const assertions = result.source.source === null
    ? attemptAssertionsContent(result.assertions)
    : null;
  const timeline = attemptTimelineContent({
    locator: result.timing.locator,
    phases: [...result.timing.phases],
    trace: result.timing.trace === null ? null : [...result.timing.trace],
    ...(result.timing.error?.code === "timeout" ? { timedOut: true as const } : {}),
  });
  const conversation = result.source.source === null
    ? attemptConversationContent(result.conversation.conversation)
    : null;
  const files = attemptDiffContent(result.diff);
  return (
    <Col>
      <AttemptSummary data={result.summary} />
      <Callouts items={notices} />
      {source !== null ? (
        <SourceView data={source} />
      ) : assertions !== null && assertions.rows.length > 0 ? (
        <TableContentView data={assertions} />
      ) : null}
      <CopyBlock content={attemptFixPromptContent(result.fixPrompt)} />
      <Waterfall nodes={timeline ?? []} title={{ en: "Execution timeline", "zh-CN": "执行时间轴" }} />
      <TaskUsageResultView data={result.usage} />
      {conversation !== null ? <Conversation data={conversation} /> : null}
      <DiffView files={files} />
    </Col>
  );
});
AttemptDetailsResultView.displayName = "AttemptDetailsResultView";
