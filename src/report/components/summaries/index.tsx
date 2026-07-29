// 概览组合件:SampleSummary / SampleOverview 用 defineComponent(compose) + 公开计算。

import type { Sample, Run } from "../../../record/types.ts";
import { defineComponent } from "../../definition/tree.ts";
import { Col, Grid, Scatter, Stat, Table, Text } from "../../definition/primitives.tsx";
import type { SeriesInput } from "../../model/types.ts";
import { resolveInput, seriesName } from "../../model/aggregate.ts";
import { label } from "../../model/flag.ts";
import {
  agent,
  aggregate,
  costUSD,
  experiment,
  model,
  passRate,
  totalScore,
  type GroupFunction,
} from "../../model/calculation.ts";
import { scoringComposition } from "../../model/scoring.ts";
import { DEFAULT_REPORT_LOCALE, localeText, type ReportLocale } from "../../model/locale.ts";
import { formatReportDateTime, formatReportDateTimeRange } from "../../model/format.ts";
import type { ChromeProps } from "../shared.ts";
import { toSummaryItems } from "../../model/conversions.ts";

export { validateSampleSummaryContent } from "./validate.ts";
export { StabilityOverview, type StabilityOverviewProps } from "./stability-overview.tsx";

export type SampleSummaryProps = ChromeProps & {
  input?: Sample;
  votes?: "eval" | "attempt";
};

export const SampleSummary = defineComponent<SampleSummaryProps>(async (props, ctx) => {
  const input: Sample = props.input ?? ctx.scope;
  const snapshot = await toSummaryItems(input);
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
          <Stat label={localeText(locale, "scopeSummary.passRate")} value={{ kind: "metric", metric: snapshot.endToEndPassRate }} />
        ) : null}
        {snapshot.totalScore !== undefined ? (
          <Stat label={localeText(locale, "scopeSummary.totalScore")} value={{ kind: "metric", metric: snapshot.totalScore }} />
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

function seriesGroup(series: SeriesInput): { key: string; fn: GroupFunction } {
  if (typeof series === "string") {
    if (series === "agent") return { key: "agent", fn: agent };
    if (series === "model") return { key: "model", fn: model };
    if (series === "experiment") return { key: "experiment", fn: experiment };
    throw new Error(
      `SampleOverview series "${series}" is not a built-in group — use "agent" | "model" | "experiment", or label()/flag().`,
    );
  }
  if (Array.isArray(series)) {
    throw new Error("SampleOverview does not accept composite series arrays; pass a single dimension.");
  }
  if ("kind" in series && (series.kind === "label" || series.kind === "flag")) {
    const name = series.name;
    const kind = series.kind;
    const fn: GroupFunction = (subject) => {
      const bag = kind === "label" ? subject.run.experiment?.labels : subject.run.experiment?.flags;
      const value = bag?.[name];
      return value === undefined || value === null ? "(missing)" : String(value);
    };
    Object.defineProperty(fn, "name", { value: `${kind}:${name}` });
    return { key: name, fn };
  }
  if ("of" in series && typeof series.of === "function") {
    throw new Error(
      `SampleOverview cannot use CustomDimension "${series.name}" with aggregate() — CustomDimension reads AttemptHandle; write a GroupFunction over AggregationSubject instead.`,
    );
  }
  throw new Error(
    `SampleOverview series kind "${(series as { kind?: string }).kind ?? "unknown"}" is not supported for aggregate grouping yet.`,
  );
}

async function comparisonBlock(
  input: Sample,
  options: {
    series: SeriesInput;
    connect: boolean;
    y: "passRate" | "totalScore";
    locale?: ReportLocale;
    className?: string;
  },
) {
  const group = seriesGroup(options.series);
  const yCalc = options.y === "totalScore" ? totalScore : passRate;
  const points = await aggregate(input, {
    by: {
      experiment,
      [group.key]: group.fn,
    },
    values: {
      costUSD,
      [options.y]: yCalc,
    },
  });
  return (
    <Col className={options.className}>
      <Scatter
        points={points}
        x="costUSD"
        y={options.y}
        point="experiment"
        series={group.key}
        connect={options.connect}
        locale={options.locale}
        legend
      />
      <Table
        rows={points}
        columns={["experiment", group.key, "costUSD", options.y]}
        sort={options.y}
        searchable
        locale={options.locale}
      />
    </Col>
  );
}

export const SampleOverview = defineComponent<SampleOverviewProps>(async (props, ctx) => {
  const input: Sample = props.input ?? ctx.scope;
  const { series, connect } = resolveComparisonSeries(input, props);
  const composition = await scoringComposition(input);

  if (composition !== "mixed") {
    const primary = composition === "points" ? "totalScore" : "passRate";
    return (
      <Col className={props.className}>
        <SampleSummary input={input} locale={props.locale} />
        {await comparisonBlock(input, { series, connect, y: primary, locale: props.locale })}
      </Col>
    );
  }

  const passInput = filterInputBySnapshot(input, (run) => snapshotScoring(run) === "pass");
  const pointsInput = filterInputBySnapshot(input, (run) => snapshotScoring(run) === "points");
  return (
    <Col className={props.className}>
      <SampleSummary input={input} locale={props.locale} />
      {await comparisonBlock(passInput, { series, connect, y: "passRate", locale: props.locale })}
      {await comparisonBlock(pointsInput, { series, connect, y: "totalScore", locale: props.locale })}
    </Col>
  );
});
SampleOverview.displayName = "SampleOverview";
