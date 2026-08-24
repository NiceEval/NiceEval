/** Official summary components over a fixed Sample and closed Analysis rows. */

import type { ExperimentComparisonScope, ExperimentId, MetricValue, Sample } from "../../../analysis/index.ts";
import { sampleForExperimentComparisonScope } from "../../../analysis/experiment-groups.ts";
import { defineComponent } from "../../definition/tree.ts";
import {
  Chart,
  Col,
  Grid,
  Scatter,
  Series,
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
  type ExperimentScatterPoint,
  type SummarySeries,
} from "./compute.ts";
import { experimentListData } from "../entity-lists/compute.ts";
import type { Dataset, DatasetField } from "../../model/types.ts";

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
  readonly comparison: ExperimentComparisonScope;
  /** The closed Run-context dimension used to split experiment points. */
  readonly series?: SummarySeries;
  /** Connect points from the same series; defaults on for the conventional `line` label. */
  readonly connect?: boolean;
  /** Overrides the library's default Experiment detail target for each point. */
  readonly pointTarget?: (point: ChartTargetPoint) => ReportTarget | undefined;
  readonly locale?: ReportLocale;
  readonly className?: string;
}

/**
 * An Experiment comparison whose primary y axis follows the evaluation kind.
 * Pass-only Experiments use pass rate and Score Experiments use total earned
 * score. Historical mixed Samples remain readable with separate units.
 */
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
  const sample = sampleForExperimentComparisonScope(props.comparison);
  const experiments = await experimentListData(sample, pricing);
  const data = await experimentScatterData(sample, {
    series: props.series,
    connect: props.connect,
    experiments,
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
  const passPoints = data.points.filter((point) => point.evaluationKind === "pass");
  const scorePoints = data.points.filter((point) => point.evaluationKind !== "pass");
  const scoreConnect = props.connect === true && data.connect;
  const pointTarget = props.pointTarget ?? defaultExperimentPointTarget;
  return (
    <Col className={props.className}>
      {passPoints.length === 0 ? null : (
        <Scatter
          points={passPoints}
          x="costUSD"
          y="passRate"
          point="experiment"
          series="series"
          connect={data.connect}
          pointTarget={pointTarget}
          locale={props.locale}
          legend
        />
      )}
      {scorePoints.length === 0 ? null : (
        <Chart
          data={scoreScatterDataset(scorePoints)}
          x="costUSD"
          y="totalScore"
          pointTarget={pointTarget}
          locale={props.locale}
          legend
        >
          <Series
            id="score"
            mark="scatter"
            points="experiment"
            by="series"
            connect={scoreConnect}
          />
        </Chart>
      )}
    </Col>
  );
});
ExperimentScatter.displayName = "ExperimentScatter";

export interface SampleOverviewProps extends ExperimentScatterProps {}

/** The conventional summary + comparison composition. */
export const SampleOverview = defineComponent<SampleOverviewProps>((props) => (
  <Col className={props.className}>
    <SampleSummary input={sampleForExperimentComparisonScope(props.comparison)} locale={props.locale} />
    <ExperimentScatter
      comparison={props.comparison}
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

function scoreScatterDataset(points: readonly ExperimentScatterPoint[]): Dataset {
  const cost = points[0]?.costUSD;
  const costField: DatasetField = Object.freeze({
    name: "costUSD",
    kind: "metric",
    valueType: "number",
    ...(cost?.unit === undefined ? {} : { unit: cost.unit }),
    ...(cost?.format === undefined ? {} : { format: cost.format }),
    ...(cost?.better === undefined ? {} : { better: cost.better }),
    ...(cost?.bounds === undefined ? {} : { bounds: cost.bounds }),
  });
  return Object.freeze({
    fields: Object.freeze([
      { name: "experiment", kind: "dimension", valueType: "string" },
      { name: "series", kind: "dimension", valueType: "string" },
      costField,
      { name: "totalScore", kind: "metric", valueType: "number", better: "higher", bounds: { min: 0 } },
    ] satisfies readonly DatasetField[]),
    rows: Object.freeze(points.map((point) => Object.freeze({
      // Match Scatter's point="experiment" route identity on the pass branch.
      key: point.experiment,
      values: Object.freeze({
        experiment: point.experiment,
        series: point.series,
        costUSD: point.costUSD,
        totalScore: point.totalScore ?? null,
      }),
    }))),
  });
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
