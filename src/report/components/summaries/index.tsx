// 概览组合件:SampleSummary / SampleOverview 用 defineComposition + 原语 + sources。

import type { Sample, Run } from "../../../record/types.ts";
import { defineComposition } from "../../source.ts";
import { Chart, Col, Grid, Series, Stat, Table, Text } from "../../definition/primitives.tsx";
import type { Measure, SeriesInput } from "../../model/types.ts";
import { resolveInput, seriesName } from "../../model/aggregate.ts";
import { label } from "../../model/flag.ts";
import { costUSD, passRate, totalScore } from "../../model/metrics.ts";
import { scoringComposition } from "../../model/scoring.ts";
import { DEFAULT_REPORT_LOCALE, localeText, type ReportLocale } from "../../model/locale.ts";
import { formatReportDateTime, formatReportDateTimeRange } from "../../model/format.ts";
import type { ChromeProps } from "../shared.ts";
import { sources } from "../../sources.ts";

export { validateSampleSummaryContent } from "./validate.ts";
export { StabilityOverview, type StabilityOverviewProps } from "./stability-overview.tsx";

export type SampleSummaryProps = ChromeProps & {
  input?: Sample;
  votes?: "eval" | "attempt";
};

export const SampleSummary = defineComposition<SampleSummaryProps, Sample>(async (props, ctx) => {
  const input: Sample = props.input ?? ctx.input;
  const snapshot = await ctx.resolve(sources.sample.snapshot, input);
  const locale = props.locale ?? DEFAULT_REPORT_LOCALE;
  const votes = props.votes ?? "eval";
  const tally = votes === "attempt" ? snapshot.attemptVerdicts : snapshot.evalVerdicts;
  const formattedRange =
    snapshot.range.earliestStartedAt !== null && snapshot.range.latestStartedAt !== null
      ? formatReportDateTimeRange(snapshot.range.earliestStartedAt, snapshot.range.latestStartedAt, locale)
      : null;

  return (
    <Col className={["niceeval-sample-summary", props.className].filter(Boolean).join(" ")}>
      <Grid>
        {snapshot.scoringComposition !== "points" ? (
          <Stat label={localeText(locale, "scopeSummary.passRate")} value={{ kind: "measure", measure: snapshot.endToEndPassRate }} />
        ) : null}
        {snapshot.totalScore !== undefined ? (
          <Stat label={localeText(locale, "scopeSummary.totalScore")} value={{ kind: "measure", measure: snapshot.totalScore }} />
        ) : null}
        <Stat label={localeText(locale, "scopeSummary.experiments")} value={snapshot.experiments} />
        <Stat label={localeText(locale, "scopeSummary.evals")} value={snapshot.evals} />
        <Stat label={localeText(locale, "scopeSummary.attempts")} value={snapshot.attempts} />
        <Stat
          label={localeText(locale, votes === "attempt" ? "scopeSummary.votesAttempt" : "scopeSummary.votesEval")}
          value={{
            kind: "verdict",
            counts: {
              passed: tally.passed,
              failed: tally.failed,
              errored: tally.errored,
              skipped: tally.unreadable,
            },
          }}
        />
        <Stat
          label={localeText(locale, "scopeSummary.totalCost")}
          value={{ kind: "measure", measure: snapshot.totalCostUSD }}
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
          {snapshot.range.earliestStartedAt !== null && snapshot.range.earliestStartedAt !== snapshot.range.latestStartedAt
            ? localeText(locale, "scopeSummary.runRange", {
                from: formattedRange!.from,
                to: formattedRange!.to,
              })
            : localeText(locale, "scopeSummary.lastRun", {
                time: formatReportDateTime(snapshot.range.latestStartedAt, locale),
              })}
        </Text>
      ) : null}
    </Col>
  );
});
SampleSummary.displayName = "SampleSummary";

type ComparisonChrome = ChromeProps & {
  connect?: boolean;
};

export type SampleOverviewProps = ComparisonChrome & {
  input?: Sample;
  series?: SeriesInput;
};

const LINE_LABEL_KEY = "line";

function resolveComparisonSeries(
  input: Sample,
  props: { series?: SeriesInput; connect?: boolean },
): { series: SeriesInput; connect: boolean } {
  const hasLine = resolveInput(input).runs.some((s) => s.experiment?.labels?.[LINE_LABEL_KEY] !== undefined);
  const series = props.series ?? (hasLine ? label(LINE_LABEL_KEY) : "agent");
  return { series, connect: props.connect ?? seriesName(series) === LINE_LABEL_KEY };
}

function snapshotScoring(run: Run): "pass" | "points" {
  return run.attempts.some((a) => a.result.scoring === "points") ? "points" : "pass";
}

function filterInputBySnapshot(input: Sample, predicate: (run: Run) => boolean): Sample {
  return input.filter((attempt) => predicate(attempt.run));
}

function comparisonChart(
  input: Sample,
  options: { series: SeriesInput; connect: boolean; y: Measure; locale?: ReportLocale; className?: string },
) {
  const by = seriesName(options.series);
  return (
    <Chart
      input={input}
      source={sources.measure.chart({ points: "experiment", series: options.series, x: costUSD, y: options.y })}
      x={costUSD.name}
      y={options.y.name}
      locale={options.locale}
      className={options.className}
      legend
    >
      <Series id="comparison" mark="scatter" points="experiment" by={by} connect={options.connect} />
    </Chart>
  );
}

export const SampleOverview = defineComposition<SampleOverviewProps, Sample>(async (props, ctx) => {
  const input: Sample = props.input ?? ctx.input;
  const { series, connect } = resolveComparisonSeries(input, props);
  const composition = await scoringComposition(input);

  if (composition !== "mixed") {
    const primary = composition === "points" ? totalScore : passRate;
    return (
      <Col className={props.className}>
        <SampleSummary input={input} locale={props.locale} />
        {comparisonChart(input, { series, connect, y: primary, locale: props.locale })}
        <Table input={input} source={sources.entity.experiments} sort={primary.name} filter locale={props.locale} />
      </Col>
    );
  }

  const passInput = filterInputBySnapshot(input, (run) => snapshotScoring(run) === "pass");
  const pointsInput = filterInputBySnapshot(input, (run) => snapshotScoring(run) === "points");
  return (
    <Col className={props.className}>
      <SampleSummary input={input} locale={props.locale} />
      <Col>
        {comparisonChart(passInput, { series, connect, y: passRate, locale: props.locale })}
        <Table input={passInput} source={sources.entity.experiments} sort={passRate.name} filter locale={props.locale} />
      </Col>
      <Col>
        {comparisonChart(pointsInput, { series, connect, y: totalScore, locale: props.locale })}
        <Table input={pointsInput} source={sources.entity.experiments} sort={totalScore.name} filter locale={props.locale} />
      </Col>
    </Col>
  );
});
SampleOverview.displayName = "SampleOverview";
