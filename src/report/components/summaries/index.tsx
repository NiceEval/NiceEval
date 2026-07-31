// 概览组合件:SampleSummary / SampleOverview 用 defineComponent(compose) + 公开计算。

import type { Sample, Run } from "../../../record/types.ts";
import { defineComponent } from "../../definition/tree.ts";
import { Col, Grid, Scatter, Stat, Text } from "../../definition/primitives.tsx";
import type { ChartTargetPoint } from "../../definition/primitives/chart.tsx";
import type { ReportTarget } from "../../definition/report.ts";
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
import { formatInstant, formatReportDateTimeRange } from "../../model/format.ts";
import type { ChromeProps } from "../shared.ts";
import { toSummaryItems } from "../../model/conversions.ts";
import { ExperimentTable } from "../entity-lists/index.tsx";

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
                time: formatInstant(snapshot.range.latestStartedAt, locale),
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

export type ExperimentScatterProps = ComparisonChrome & {
  input?: Sample;
  series?: SeriesInput;
  /**
   * 点该指向谁(components/summaries/experiment-scatter.md「默认点目标」)。省略时落到
   * `defaultExperimentPointTarget`——点身份恒为 experiment id(`point="experiment"`),
   * 目标是 experiment 详情页;报告没有声明该 id 的页时 `ctx.href` 自然给不出链接,
   * 点退化成纯图形,不是这里判断"页存不存在"。
   */
  pointTarget?: (point: ChartTargetPoint) => ReportTarget | undefined;
};

/**
 * `ExperimentScatter` 的默认点目标:点身份键固定是 experiment id(`scatterBlock` 恒传
 * `point="experiment"`),`Chart` 内核把它原样落成该点的 Dataset 行 key——不需要反查
 * 证据即可拿到这个点是哪个 experiment。
 */
function defaultExperimentPointTarget(point: ChartTargetPoint): ReportTarget {
  return { page: "experiment", params: { experiment: point.key } };
}

export type SampleOverviewProps = ExperimentScatterProps;

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

async function scatterBlock(
  input: Sample,
  options: {
    series: SeriesInput;
    connect: boolean;
    y: "passRate" | "totalScore";
    pointTarget: (point: ChartTargetPoint) => ReportTarget | undefined;
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
    <Scatter
      points={points}
      x="costUSD"
      y={options.y}
      point="experiment"
      series={group.key}
      connect={options.connect}
      pointTarget={options.pointTarget}
      locale={options.locale}
      legend
    />
  );
}

export const ExperimentScatter = defineComponent<ExperimentScatterProps>(async (props, ctx) => {
  const input: Sample = props.input ?? ctx.scope;
  const { series, connect } = resolveComparisonSeries(input, props);
  const composition = await scoringComposition(input);
  const pointTarget = props.pointTarget ?? defaultExperimentPointTarget;

  if (composition !== "mixed") {
    const primary = composition === "points" ? "totalScore" : "passRate";
    return (
      <Col className={props.className}>
        {await scatterBlock(input, { series, connect, y: primary, pointTarget, locale: props.locale })}
      </Col>
    );
  }

  const passInput = filterInputBySnapshot(input, (run) => snapshotScoring(run) === "pass");
  const pointsInput = filterInputBySnapshot(input, (run) => snapshotScoring(run) === "points");
  return (
    <Col className={props.className}>
      {await scatterBlock(passInput, { series, connect, y: "passRate", pointTarget, locale: props.locale })}
      {await scatterBlock(pointsInput, { series, connect, y: "totalScore", pointTarget, locale: props.locale })}
    </Col>
  );
});
ExperimentScatter.displayName = "ExperimentScatter";

export const SampleOverview = defineComponent<SampleOverviewProps>((props) => (
  <Col className={props.className}>
    <SampleSummary input={props.input} locale={props.locale} />
    <ExperimentScatter
      input={props.input}
      series={props.series}
      connect={props.connect}
      pointTarget={props.pointTarget}
      locale={props.locale}
    />
    <ExperimentTable input={props.input} locale={props.locale} />
  </Col>
));
SampleOverview.displayName = "SampleOverview";
