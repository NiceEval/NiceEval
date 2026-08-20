/** Official summary components over a fixed Sample and closed Analysis rows. */

import type { ExperimentId, MetricValue, Sample } from "../../../analysis/index.ts";
import { defineComponent } from "../../definition/tree.ts";
import {
  Col,
  Grid,
  Scatter,
  Stat,
  Text,
} from "../../definition/primitives.tsx";
import type { Cell } from "../../definition/cell.tsx";
import type { ChartTargetPoint } from "../../definition/primitives/chart.tsx";
import type { ReportTarget } from "../../definition/report.ts";
import { experimentDetailTarget } from "../../library/details.ts";
import {
  formatInstant,
  formatReportDateTimeRange,
} from "../../model/format.ts";
import {
  DEFAULT_REPORT_LOCALE,
  localeText,
  resolveLocalizedText,
  type ReportLocale,
} from "../../model/locale.ts";
import {
  COST_SCATTER_NO_PROFILE_TEXT,
  COST_SUMMARY_NO_PROFILE_TEXT,
} from "../../model/pricing.ts";
import {
  experimentScatterData,
  sampleSummaryData,
  type SummarySeries,
} from "./compute.ts";

export { StabilityOverview } from "./stability-overview.tsx";
export type { StabilityOverviewProps } from "./stability-overview.tsx";

export interface SampleSummaryProps {
  /** Explicit fixed Sample; omitted means the resolving component's `ctx.scope`. */
  readonly input?: Sample;
  /** Which closed evidence identity gets one verdict count. */
  readonly votes?: "eval" | "attempt";
  readonly locale?: ReportLocale;
  readonly className?: string;
}

/**
 * The zero-config scope summary.  Its values are either Sample identity facts
 * or untouched Analysis MetricValues; Grid/Stat supply both text and web
 * presentation from the single resolved tree.  The cost KPI shows the full
 * projection (state/basis/profile/coverage/reasons), or the adjudicated
 * bilingual text when the Report declares no PricingProfile.
 */
export const SampleSummary = defineComponent<SampleSummaryProps>(async (props, ctx) => {
  const locale = props.locale ?? DEFAULT_REPORT_LOCALE;
  const votes = props.votes ?? "eval";
  const pricing = ctx.report.pricing;
  const data = await sampleSummaryData(props.input ?? ctx.scope, votes, pricing);
  const range = rangeText(data.earliestStartedAt, data.latestStartedAt, locale);

  return (
    <Col className={joinClassNames("niceeval-sample-summary", props.className)}>
      <Grid>
        <Stat label={localeText(locale, "scopeSummary.passRate")} value={metricCell(data.passRate)} />
        <Stat label={localeText(locale, "scopeSummary.experiments")} value={data.experiments} />
        <Stat label={localeText(locale, "scopeSummary.evals")} value={data.evals} />
        <Stat label={localeText(locale, "scopeSummary.attempts")} value={data.attempts} />
        <Stat
          label={localeText(locale, votes === "attempt" ? "scopeSummary.votesAttempt" : "scopeSummary.votesEval")}
          value={{ kind: "verdict", counts: data.verdicts }}
        />
        {pricing === null ? (
          <Stat
            label={localeText(locale, "scopeSummary.totalCost")}
            value={resolveLocalizedText(COST_SUMMARY_NO_PROFILE_TEXT, locale)}
          />
        ) : (
          <Stat
            label={localeText(locale, "scopeSummary.totalCost")}
            value={data.totalCostUSD === null ? localeText(locale, "cell.missing") : metricCell(data.totalCostUSD)}
          />
        )}
      </Grid>
      {range === null ? null : <Text className="niceeval-sample-summary-range">{range}</Text>}
    </Col>
  );
});
SampleSummary.displayName = "SampleSummary";

export interface ExperimentScatterProps {
  /** Explicit fixed Sample; omitted means the resolving component's `ctx.scope`. */
  readonly input?: Sample;
  /** The closed Run-context dimension used to split experiment points. */
  readonly series?: SummarySeries;
  /** Connect points from the same series; defaults on for the conventional `line` label. */
  readonly connect?: boolean;
  /** Overrides the library's default Experiment detail target for each point. */
  readonly pointTarget?: (point: ChartTargetPoint) => ReportTarget | undefined;
  readonly locale?: ReportLocale;
  readonly className?: string;
}

/** An Analysis-backed experiment cost × pass-rate comparison. */
export const ExperimentScatter = defineComponent<ExperimentScatterProps>(async (props, ctx) => {
  const locale = props.locale ?? DEFAULT_REPORT_LOCALE;
  const pricing = ctx.report.pricing;
  if (pricing === null) {
    return (
      <Col className={joinClassNames("niceeval-experiment-scatter", props.className)}>
        <Text className="niceeval-experiment-scatter-note">
          {resolveLocalizedText(COST_SCATTER_NO_PROFILE_TEXT, locale)}
        </Text>
      </Col>
    );
  }
  const data = await experimentScatterData(props.input ?? ctx.scope, {
    series: props.series,
    connect: props.connect,
  }, pricing);
  if (data.points.length > 0 && data.points.every((point) => point.costUSD.state === "migration-required")) {
    return (
      <Col className={joinClassNames("niceeval-experiment-scatter", props.className)}>
        <Text className="niceeval-experiment-scatter-note">
          {localeText(locale, "costProjection.migrationRequired")}
        </Text>
      </Col>
    );
  }
  return (
    <Col className={props.className}>
      <Scatter
        points={data.points}
        x="costUSD"
        y="passRate"
        point="experiment"
        series="series"
        connect={data.connect}
        pointTarget={props.pointTarget ?? defaultExperimentPointTarget}
        locale={props.locale}
        legend
      />
    </Col>
  );
});
ExperimentScatter.displayName = "ExperimentScatter";

export interface SampleOverviewProps extends ExperimentScatterProps {}

/** The conventional summary + comparison composition. */
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
  </Col>
));
SampleOverview.displayName = "SampleOverview";

function metricCell(metric: MetricValue<number> | null): Cell | null {
  return metric === null ? null : { kind: "metric", metric };
}

function defaultExperimentPointTarget(point: ChartTargetPoint): ReportTarget {
  return {
    page: "experiment",
    params: experimentDetailTarget(point.key as ExperimentId),
  };
}

function rangeText(
  earliest: string | null,
  latest: string | null,
  locale: ReportLocale,
): string | null {
  if (latest === null) return null;
  if (earliest === null || earliest === latest) {
    return localeText(locale, "scopeSummary.lastRun", { time: formatInstant(latest, locale) });
  }
  const range = formatReportDateTimeRange(earliest, latest, locale);
  return localeText(locale, "scopeSummary.runRange", range);
}

function joinClassNames(...parts: readonly (string | undefined)[]): string {
  return parts.filter((part): part is string => part !== undefined && part.length > 0).join(" ");
}
