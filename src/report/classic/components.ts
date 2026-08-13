import {
  costUSD,
  foldEvalVerdict,
  passRate,
  totalAttempts,
} from "./aggregate.ts";
import {
  coverageFromMetric,
  formatInstant,
  formatMetricDisplay,
  formatRatio,
} from "./format.ts";
import { experimentTableContent } from "./experiment-table.ts";
import { defineComponent, evaluateClassicTree, Fragment, jsx } from "./jsx.ts";
import { resolveLocalizedText, type LocalizedText } from "./localize.ts";
import { isMetricValue, metricNumeric, type MetricValue } from "./metric.ts";
import { classicExperimentTarget } from "./routes.ts";
import type { ClassicEvalUnit, Sample } from "./sample.ts";
import {
  reportCellTable,
  reportCodeBlock,
  reportGrid,
  reportHero,
  reportParagraph,
  reportRankedBars,
  reportScatter,
  reportSection,
  reportStat,
  reportText,
  type ReportBlock,
} from "../semantic/document.ts";
import { cellFromUnknown, formatCellText, isCell, type Cell } from "./cell.ts";
import type { AttemptEvidence, AttemptSummaryData, CopyBlockContent } from "./attempt.ts";
import { copyBlockText } from "./attempt.ts";

export interface ClassicHeroLogo {
  readonly src: string;
  readonly alt: LocalizedText;
}

export interface ClassicHeroProps {
  readonly title?: LocalizedText;
  readonly logo?: ClassicHeroLogo;
  readonly description?: LocalizedText;
  readonly links?: readonly {
    readonly label: LocalizedText;
    readonly href: string;
  }[];
}

export interface ClassicSectionProps {
  readonly title: LocalizedText;
  readonly meta?: LocalizedText;
  readonly children?: unknown;
}

export type ClassicAggregatePoint = Readonly<Record<string, string | MetricValue>>;

export interface ClassicBarsProps {
  readonly points: readonly ClassicAggregatePoint[];
  readonly x: string;
  readonly y: string;
  readonly color?: string;
  readonly point?: string;
  readonly sort?: {
    readonly field: string;
    readonly direction: "asc" | "desc";
  };
  /** The classic dashboard currently has one honest bar layout. */
  readonly layout?: "horizontal";
}

export interface ClassicColProps {
  readonly children?: unknown;
}

export const Col = defineComponent<ClassicColProps>((props) =>
  jsx(Fragment, { children: props.children })
);
Col.displayName = "Col";

export const Hero = defineComponent<ClassicHeroProps>((props, ctx) => {
  const links = (props.links ?? []).map((link) => {
    if (!isAbsoluteHttps(link.href)) {
      throw new TypeError("Hero links must use an absolute https URL");
    }
    return Object.freeze({
      label: resolveLocalizedText(link.label, ctx.scope.locale),
      target: Object.freeze({ kind: "external" as const, href: link.href }),
    });
  });
  const title = props.title === undefined
    ? undefined
    : resolveLocalizedText(props.title, ctx.scope.locale);
  const logo = props.logo === undefined
    ? undefined
    : Object.freeze({
      src: requireLogoSrc(props.logo.src),
      alt: resolveLocalizedText(props.logo.alt, ctx.scope.locale),
    });
  return reportHero({
    ...(title === undefined ? {} : { title }),
    ...(logo === undefined ? {} : { logo }),
    description: props.description === undefined
      ? ""
      : resolveLocalizedText(props.description, ctx.scope.locale),
    links,
    lastRunAt: ctx.scope.latestRunAt,
    runCount: ctx.scope.runCount,
  });
});
Hero.displayName = "Hero";

export const Section = defineComponent<ClassicSectionProps>(async (props, ctx) => {
  const children = await evaluateClassicTree(props.children, ctx);
  return reportSection({
    heading: resolveLocalizedText(props.title, ctx.scope.locale),
    ...(props.meta === undefined ? {} : { meta: resolveLocalizedText(props.meta, ctx.scope.locale) }),
    children,
  });
});
Section.displayName = "Section";

export interface ClassicGridProps {
  readonly children?: unknown;
}

export const Grid = defineComponent<ClassicGridProps>(async (props, ctx) => {
  const cells = await evaluateClassicTree(props.children, ctx);
  return reportGrid({ cells });
});
Grid.displayName = "Grid";

export type StatTone = "neutral" | "positive" | "negative" | "warning";

export interface ClassicStatProps {
  readonly label: LocalizedText;
  readonly value: Cell | LocalizedText | number | null;
  readonly detail?: LocalizedText;
  readonly tone?: StatTone;
  readonly className?: string;
}

export const Stat = defineComponent<ClassicStatProps>((props, ctx) => {
  const value = statDisplay(props.value, ctx.scope.locale);
  const detail = props.detail === undefined
    ? undefined
    : resolveLocalizedText(props.detail, ctx.scope.locale);
  return reportStat({
    label: resolveLocalizedText(props.label, ctx.scope.locale),
    value: detail === undefined ? value : `${value}\n${detail}`,
    ...(props.tone === undefined ? {} : { tone: props.tone }),
  });
});
Stat.displayName = "Stat";

export interface ClassicCellTableProps {
  readonly rows: readonly (Readonly<Record<string, unknown>> & { readonly key?: string })[];
  readonly columns: readonly string[];
  readonly className?: string;
  readonly sort?: string;
  readonly searchable?: boolean;
}

export const Table = defineComponent<ClassicCellTableProps>((props) => {
  const rows = sortTableRows(props.rows, props.sort);
  return reportCellTable({
    columns: props.columns,
    rows: rows.map((row, index) => {
      const cells: Record<string, string> = {};
      for (const column of props.columns) {
        cells[column] = formatCellText(cellFromUnknown(row[column]));
      }
      return Object.freeze({
        key: typeof row.key === "string" ? row.key : `row-${index}`,
        cells: Object.freeze(cells),
      });
    }),
  });
});
Table.displayName = "Table";

export const SampleNotices = defineComponent(() => null);
SampleNotices.displayName = "SampleNotices";

export interface CopyBlockProps {
  readonly content: CopyBlockContent;
}

export const CopyBlock = defineComponent<CopyBlockProps>((props) =>
  reportSection({
    heading: "Copy",
    children: [reportCodeBlock({ value: copyBlockText(props.content) })],
  })
);
CopyBlock.displayName = "CopyBlock";

export const AttemptSummary = defineComponent<{ readonly data: AttemptSummaryData }>((props) =>
  reportSection({
    heading: props.data.locator,
    children: [
      reportStat({ label: "Experiment", value: props.data.experimentId }),
      reportStat({ label: "Eval", value: props.data.evalId }),
      reportStat({ label: "Verdict", value: props.data.verdict }),
    ],
  })
);
AttemptSummary.displayName = "AttemptSummary";

export const AttemptAssessment = defineComponent<{ readonly attempt: AttemptEvidence }>((props) =>
  reportSection({
    heading: "Assessment",
    children: [
      reportStat({
        label: "Verdict",
        value: props.attempt.result.verdict ?? "unknown",
      }),
    ],
  })
);
AttemptAssessment.displayName = "AttemptAssessment";

function statDisplay(value: ClassicStatProps["value"], locale: Sample["locale"]): string {
  if (value === null) return "—";
  if (typeof value === "number") return new Intl.NumberFormat(locale).format(value);
  if (isCell(value)) return formatCellText(value);
  return resolveLocalizedText(value, locale);
}

function sortTableRows(
  rows: ClassicCellTableProps["rows"],
  sort: string | undefined,
): ClassicCellTableProps["rows"] {
  if (sort === undefined) return rows;
  return Object.freeze(
    [...rows].sort((left, right) => {
      const leftValue = metricNumericFromUnknown(left[sort]);
      const rightValue = metricNumericFromUnknown(right[sort]);
      if (leftValue === null && rightValue === null) return 0;
      if (leftValue === null) return 1;
      if (rightValue === null) return -1;
      return rightValue - leftValue;
    }),
  );
}

function metricNumericFromUnknown(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (isCell(value) && value.kind === "metric") return value.metric.value;
  if (typeof value === "object" && value !== null && "value" in value && typeof value.value === "number") {
    return value.value;
  }
  return null;
}

export const SampleSummary = defineComponent<{ readonly input?: Sample }>((props, ctx) => {
  const scope = props.input ?? ctx.scope;
  const experiments = new Set(scope.units.map((unit) => unit.experimentId));
  const scoredAttempts = scope.attempts.filter((attempt) =>
    attempt.verdict === "passed" || attempt.verdict === "failed" || attempt.verdict === "errored"
  );
  const overall = passRate.compute(scope.units);
  const results = evalResultCounts(scope.units);
  const totalCost = totalAttempts(scope.units, "costUSD", { unit: "$", better: "lower" });
  const costNote = totalCost.samples < totalCost.total
    ? `Cost available for ${totalCost.samples}/${totalCost.total} attempts`
    : undefined;
  const lastRun = scope.latestRunAt === null
    ? undefined
    : reportParagraph([
      reportText(`Last run · ${formatInstant(scope.latestRunAt, scope.locale)}`),
    ]);
  return [
    reportGrid({
      cells: [
        reportStat({
          label: localize(scope, { en: "Pass rate", "zh-CN": "通过率" }),
          value: formatMetricDisplay(overall),
        }),
        reportStat({
          label: localize(scope, { en: "Experiments", "zh-CN": "实验" }),
          value: String(experiments.size),
        }),
        reportStat({
          label: localize(scope, { en: "Evals", "zh-CN": "题目" }),
          value: String(scope.units.length),
        }),
        reportStat({
          label: localize(scope, { en: "Attempts", "zh-CN": "尝试" }),
          value: String(scoredAttempts.length),
        }),
        reportStat({
          label: localize(scope, { en: "Eval results", "zh-CN": "题目结果" }),
          value: results.display,
        }),
        reportStat({
          label: localize(scope, { en: "Total cost", "zh-CN": "总成本" }),
          value: costNote === undefined
            ? formatMetricDisplay(totalCost)
            : `${formatMetricDisplay(totalCost)}\n${costNote}`,
        }),
      ],
    }),
    ...(lastRun === undefined ? [] : [lastRun]),
  ];
});
SampleSummary.displayName = "SampleSummary";

export const Bars = defineComponent<ClassicBarsProps>((props, ctx): ReportBlock => {
  const points = sortPoints(props.points, props.sort);
  const yBetter = firstMetricBetter(points, props.y) ?? "higher";
  return reportRankedBars({
    title: props.y === "passRate"
      ? localize(ctx.scope, { en: "Pass rate(%)", "zh-CN": "通过率(%)" })
      : props.y,
    layout: "horizontal",
    better: yBetter,
    points: points.map((row, index) => {
      const label = stringField(row, props.x) || `point-${index}`;
      const series = props.color === undefined ? "all" : stringField(row, props.color) || "all";
      const key = props.point === undefined
        ? `${label}::${series}`
        : stringField(row, props.point) || `${label}::${series}`;
      const metric = row[props.y];
      const value = metricNumeric(metric);
      return Object.freeze({
        key,
        label,
        series,
        value,
        display: isMetricValue(metric) ? formatMetricDisplay(metric) : formatRatio(value),
        coverage: isMetricValue(metric)
          ? coverageFromMetric(metric)
          : Object.freeze({ basis: "eval" as const, samples: value === null ? 0 : 1, total: 1 }),
      });
    }),
  });
});
Bars.displayName = "Bars";

export interface ClassicScatterProps {
  readonly input?: Sample;
}

export const ExperimentScatter = defineComponent<ClassicScatterProps>((props, ctx): ReportBlock => {
  const scope = props.input ?? ctx.scope;
  const connect = Object.values(scope.profiles).some((profile) => profile.labels?.line !== undefined);
  const grouped = new Map<string, ReturnType<typeof experimentPoints>[number][]>();
  for (const point of experimentPoints(scope)) {
    const series = scatterSeriesKey(scope, point.experimentId);
    const existing = grouped.get(series);
    if (existing === undefined) grouped.set(series, [point]);
    else existing.push(point);
  }
  return reportScatter({
    title: localize(scope, { en: "Experiments", "zh-CN": "实验" }),
    xLabel: "costUSD",
    yLabel: "passRate",
    connect,
    series: [...grouped.entries()].sort((left, right) => compareText(left[0], right[0])).map(([label, points]) =>
      Object.freeze({
        label,
        points: points.map((point) =>
          Object.freeze({
            key: point.experimentId,
            x: metricNumeric(point.costUSD),
            y: metricNumeric(point.passRate),
            xDisplay: formatMetricDisplay(point.costUSD),
            yDisplay: formatMetricDisplay(point.passRate),
            ...(classicExperimentTarget(point.experimentId) === undefined
              ? {}
              : { target: classicExperimentTarget(point.experimentId) }),
          }),
        ),
      }),
    ),
  });
});
ExperimentScatter.displayName = "ExperimentScatter";

export interface ClassicTableProps {
  readonly input?: Sample;
}

export const ExperimentTable = defineComponent<ClassicTableProps>((props, ctx): ReportBlock => {
  const scope = props.input ?? ctx.scope;
  const content = experimentTableContent(scope);
  return reportCellTable({
    columns: content.columns.map((column) => column.header),
    rows: content.rows.map((row) =>
      Object.freeze({
        key: row.key,
        cells: Object.freeze(
          Object.fromEntries(
            content.columns.map((column) => [column.header, row.cells[column.key] ?? "—"]),
          ),
        ),
      }),
    ),
  });
});
ExperimentTable.displayName = "ExperimentTable";

function requireLogoSrc(src: string): string {
  if (!isAllowedLogoSrc(src)) {
    throw new TypeError("Hero logo src must be an absolute https URL or a data:image payload");
  }
  return src;
}

function isAllowedLogoSrc(src: string): boolean {
  if (/^data:image\/[a-z0-9.+-]+[;,]/i.test(src)) {
    return true;
  }
  return isAbsoluteHttps(src);
}

function isAbsoluteHttps(href: string): boolean {
  try {
    const url = new URL(href);
    return url.protocol === "https:" && url.hostname.length > 0;
  } catch {
    return false;
  }
}

function sortPoints(
  points: readonly ClassicAggregatePoint[],
  sort: ClassicBarsProps["sort"],
): readonly ClassicAggregatePoint[] {
  if (sort === undefined) {
    return Object.freeze([...points]);
  }
  const direction = sort.direction === "asc" ? 1 : -1;
  return Object.freeze(
    [...points].sort((left, right) => {
      const leftValue = metricNumeric(left[sort.field]);
      const rightValue = metricNumeric(right[sort.field]);
      if (leftValue === null && rightValue === null) {
        return 0;
      }
      if (leftValue === null) {
        return 1;
      }
      if (rightValue === null) {
        return -1;
      }
      if (leftValue === rightValue) {
        return 0;
      }
      return leftValue < rightValue ? -direction : direction;
    }),
  );
}

function firstMetricBetter(
  points: readonly ClassicAggregatePoint[],
  field: string,
): "higher" | "lower" | undefined {
  for (const point of points) {
    const value = point[field];
    if (isMetricValue(value) && value.better !== undefined) {
      return value.better;
    }
  }
  return undefined;
}

function stringField(row: ClassicAggregatePoint, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value : "";
}

function scatterSeriesKey(sample: Sample, experimentId: string): string {
  const profile = sample.profiles[experimentId];
  const line = profile?.labels?.line;
  if (line !== undefined) return String(line);
  return profile?.agent && profile.agent.length > 0 ? profile.agent : "unknown";
}

function experimentPoints(sample: Sample): readonly {
  readonly experimentId: string;
  readonly passRate: ReturnType<typeof passRate.compute>;
  readonly costUSD: ReturnType<typeof costUSD.compute>;
}[] {
  return Object.freeze(
    groupUnitsByExperiment(sample).map(([experimentId, units]) =>
      Object.freeze({
        experimentId,
        passRate: passRate.compute(units),
        costUSD: costUSD.compute(units),
      }),
    ),
  );
}

function evalResultCounts(units: readonly ClassicEvalUnit[]): {
  readonly display: string;
  readonly samples: number;
} {
  let passed = 0;
  let failed = 0;
  let errored = 0;
  for (const unit of units) {
    const folded = foldEvalVerdict(unit);
    if (folded === "passed") {
      passed += 1;
    } else if (folded === "failed") {
      failed += 1;
    } else if (folded === "errored") {
      errored += 1;
    }
  }
  return Object.freeze({
    display: [
      `${passed} passed`,
      `${failed} failed`,
      ...(errored > 0 ? [`${errored} errored`] : []),
    ].join(" · "),
    samples: passed + failed + errored,
  });
}

function groupUnitsByExperiment(
  sample: Sample,
): readonly (readonly [string, readonly ClassicEvalUnit[]])[] {
  const groups = new Map<string, ClassicEvalUnit[]>();
  for (const unit of sample.units) {
    const existing = groups.get(unit.experimentId);
    if (existing === undefined) {
      groups.set(unit.experimentId, [unit]);
    } else {
      existing.push(unit);
    }
  }
  return Object.freeze(
    [...groups.entries()].sort((left, right) => compareText(left[0], right[0])),
  );
}

function localize(sample: Sample, value: LocalizedText): string {
  return resolveLocalizedText(value, sample.locale);
}

function compareText(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}
