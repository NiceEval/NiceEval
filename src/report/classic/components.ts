import {
  foldEvalVerdict,
  meanMetric,
  passRate,
  totalAttempts,
} from "./aggregate.ts";
import {
  coverageFromMetric,
  displayFromMetric,
  formatMetricDisplay,
  formatRatio,
  formatRunRange,
  formatUsd,
} from "./format.ts";
import { defineComponent, evaluateClassicTree, Fragment, jsx } from "./jsx.ts";
import { resolveLocalizedText, type LocalizedText } from "./localize.ts";
import { isMetricValue, metricNumeric, type MetricValue } from "./metric.ts";
import type { ClassicEvalUnit, Sample } from "./sample.ts";
import {
  reportHero,
  reportRankedBars,
  reportScatter,
  reportSection,
  reportSummary,
  reportTreeTable,
  type ReportBlock,
  type ReportDisplayValue,
  type ReportLinkTarget,
} from "../semantic/document.ts";

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
  });
});
Hero.displayName = "Hero";

export const Section = defineComponent<ClassicSectionProps>(async (props, ctx) => {
  const children = await evaluateClassicTree(props.children, ctx);
  return reportSection({
    heading: resolveLocalizedText(props.title, ctx.scope.locale),
    children,
  });
});
Section.displayName = "Section";

export const SampleSummary = defineComponent<{ readonly input?: Sample }>((props, ctx): ReportBlock => {
  const scope = props.input ?? ctx.scope;
  const experiments = new Set(scope.units.map((unit) => unit.experimentId));
  const scoredAttempts = scope.attempts.filter((attempt) =>
    attempt.verdict === "passed" || attempt.verdict === "failed" || attempt.verdict === "errored"
  );
  const overall = passRate.compute(scope.units);
  const results = evalResultCounts(scope.units);
  const totalCost = totalAttempts(scope.units, "costUSD", { unit: "USD", better: "lower" });
  return reportSummary({
    lastRunAt: scope.latestRunAt,
    metrics: [
      {
        key: "passRate",
        label: localize(scope, { en: "Pass rate", "zh-CN": "通过率" }),
        ...displayFromMetric(overall),
      },
      {
        key: "experiments",
        label: localize(scope, { en: "Experiments", "zh-CN": "实验" }),
        value: experiments.size,
        display: String(experiments.size),
        coverage: Object.freeze({
          basis: "eval" as const,
          samples: experiments.size,
          total: experiments.size,
        }),
      },
      {
        key: "evals",
        label: localize(scope, { en: "Evals", "zh-CN": "题目" }),
        value: scope.units.length,
        display: String(scope.units.length),
        coverage: Object.freeze({
          basis: "eval" as const,
          samples: scope.units.length,
          total: scope.units.length,
        }),
      },
      {
        key: "attempts",
        label: localize(scope, { en: "Attempts", "zh-CN": "尝试" }),
        value: scoredAttempts.length,
        display: String(scoredAttempts.length),
        coverage: Object.freeze({
          basis: "eval" as const,
          samples: scoredAttempts.length,
          total: scope.attempts.length,
        }),
      },
      {
        key: "evalResults",
        label: localize(scope, { en: "Eval results", "zh-CN": "题目结果" }),
        value: results.display,
        display: results.display,
        coverage: Object.freeze({
          basis: "eval" as const,
          samples: results.samples,
          total: scope.units.length,
        }),
      },
      {
        key: "totalCost",
        label: localize(scope, { en: "Total cost", "zh-CN": "总成本" }),
        ...displayFromMetric(totalCost),
      },
      {
        key: "runRange",
        label: localize(scope, { en: "Run range", "zh-CN": "运行区间" }),
        value: scope.latestRunAt,
        display: formatRunRange(scope.earliestRunAt, scope.latestRunAt, scope.runCount),
        coverage: Object.freeze({
          basis: "eval" as const,
          samples: scope.runCount,
          total: scope.runCount,
        }),
      },
    ],
  });
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
  const points = experimentPoints(scope);
  return reportScatter({
    title: localize(scope, { en: "Experiments", "zh-CN": "实验" }),
    xLabel: localize(scope, { en: "Cost", "zh-CN": "成本" }),
    yLabel: localize(scope, { en: "Pass rate", "zh-CN": "通过率" }),
    connect: true,
    series: [
      Object.freeze({
        label: localize(scope, { en: "Experiments", "zh-CN": "实验" }),
        points: points.map((point) =>
          Object.freeze({
            key: point.experimentId,
            x: metricNumeric(point.costUSD),
            y: metricNumeric(point.passRate),
            xDisplay: formatMetricDisplay(point.costUSD),
            yDisplay: formatMetricDisplay(point.passRate),
          }),
        ),
      }),
    ],
  });
});
ExperimentScatter.displayName = "ExperimentScatter";

export interface ClassicTableProps {
  readonly input?: Sample;
}

export const ExperimentTable = defineComponent<ClassicTableProps>((props, ctx): ReportBlock => {
  const scope = props.input ?? ctx.scope;
  return reportTreeTable({
    caption: localize(scope, { en: "Experiments", "zh-CN": "实验" }),
    columns: [
      Object.freeze({
        key: "model",
        label: localize(scope, { en: "Model", "zh-CN": "模型" }),
      }),
      Object.freeze({
        key: "agent",
        label: localize(scope, { en: "Agent", "zh-CN": "Agent" }),
      }),
      Object.freeze({
        key: "avgTime",
        label: localize(scope, { en: "Avg time", "zh-CN": "平均耗时" }),
        align: "end" as const,
      }),
      Object.freeze({
        key: "passRate",
        label: localize(scope, { en: "Pass rate", "zh-CN": "通过率" }),
        align: "end" as const,
      }),
      Object.freeze({
        key: "tokens",
        label: localize(scope, { en: "Tokens", "zh-CN": "Tokens" }),
        align: "end" as const,
      }),
      Object.freeze({
        key: "cost",
        label: localize(scope, { en: "Cost", "zh-CN": "成本" }),
        align: "end" as const,
      }),
      Object.freeze({
        key: "record",
        label: localize(scope, { en: "Record", "zh-CN": "记录" }),
      }),
    ],
    rows: experimentTableRows(scope),
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

function experimentPoints(sample: Sample): readonly {
  readonly experimentId: string;
  readonly passRate: ReturnType<typeof passRate.compute>;
  readonly costUSD: ReturnType<typeof totalAttempts>;
}[] {
  return Object.freeze(
    groupUnitsByExperiment(sample).map(([experimentId, units]) =>
      Object.freeze({
        experimentId,
        passRate: passRate.compute(units),
        costUSD: totalAttempts(units, "costUSD", { unit: "USD", better: "lower" }),
      }),
    ),
  );
}

function experimentTableRows(sample: Sample): ReportTreeTableRows {
  const rows: ReportTreeTableRows[number][] = [];
  for (const [experimentId, units] of groupUnitsByExperiment(sample)) {
    const profile = sample.profiles[experimentId] ?? units[0]?.subject.run.experiment;
    rows.push({
      key: experimentId,
      kind: "experiment",
      depth: 0,
      label: experimentLabel(sample, experimentId),
      cells: groupCells(
        units,
        profile,
        units[0]?.subject.run.runId ?? experimentId,
      ),
    });
    for (const unit of units) {
      const unitProfile = sample.profiles[unit.experimentId] ?? unit.subject.run.experiment;
      rows.push({
        key: `${unit.experimentId}/${unit.evalId}`,
        kind: "eval",
        depth: 1,
        label: unit.evalId,
        cells: groupCells(
          [unit],
          unitProfile,
          unit.subject.run.runId,
        ),
      });
      for (const attempt of unit.attempts) {
        const record = attempt.target?.locator ?? attempt.runId;
        rows.push({
          key: attempt.attemptId ?? `${unit.experimentId}/${unit.evalId}/${attempt.attempt}`,
          kind: "attempt",
          depth: 2,
          label: `attempt ${attempt.attempt}`,
          ...(attempt.target === undefined
            ? {}
            : { target: attemptTarget(attempt.target.locator) }),
          cells: Object.freeze({
            model: profileField(unitProfile?.model),
            agent: profileField(unitProfile?.agent),
            avgTime: observedNumber(attempt.durationMs, "ms"),
            passRate: attemptPassRate(attempt.verdict),
            tokens: observedNumber(attempt.tokens, "tokens"),
            cost: observedNumber(attempt.costUSD, "USD"),
            record,
          }),
        });
      }
    }
  }
  return Object.freeze(rows);
}

type ReportTreeTableRows = Parameters<typeof reportTreeTable>[0]["rows"];

function groupCells(
  units: readonly ClassicEvalUnit[],
  profile: { readonly agent?: string; readonly model?: string } | undefined,
  record: string,
): Readonly<Record<string, ReportDisplayValue | string | number | null>> {
  return Object.freeze({
    model: profileField(profile?.model),
    agent: profileField(profile?.agent),
    avgTime: displayFromMetric(meanMetric(units, "durationMs", { unit: "ms", better: "lower" })),
    passRate: displayFromMetric(passRate.compute(units)),
    tokens: displayFromMetric(totalAttempts(units, "tokens", { better: "lower" })),
    cost: displayFromMetric(totalAttempts(units, "costUSD", { unit: "USD", better: "lower" })),
    record,
  });
}

function attemptPassRate(verdict: Sample["attempts"][number]["verdict"]): ReportDisplayValue {
  if (verdict === "passed") {
    return Object.freeze({
      value: 1,
      display: formatRatio(1),
      unit: "ratio",
      coverage: Object.freeze({ basis: "eval" as const, samples: 1, total: 1 }),
    });
  }
  if (verdict === "failed" || verdict === "errored") {
    return Object.freeze({
      value: 0,
      display: formatRatio(0),
      unit: "ratio",
      coverage: Object.freeze({ basis: "eval" as const, samples: 1, total: 1 }),
    });
  }
  return Object.freeze({
    value: null,
    display: "—",
    unit: "ratio",
    coverage: Object.freeze({ basis: "eval" as const, samples: 0, total: 1 }),
  });
}

function observedNumber(value: number | null, unit: string): ReportDisplayValue {
  return Object.freeze({
    value,
    display: value === null ? "—" : unit === "USD" ? formatUsd(value) : unit === "ms" ? `${Math.round(value)}ms` : String(value),
    ...(unit === "tokens" ? {} : { unit }),
    coverage: Object.freeze({
      basis: "eval" as const,
      samples: value === null ? 0 : 1,
      total: 1,
    }),
  });
}

function profileField(value: string | undefined): string {
  return value && value.length > 0 ? value : "unknown";
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
    display: `${passed} passed / ${failed} failed / ${errored} errored`,
    samples: passed + failed + errored,
  });
}

function attemptTarget(locator: string): Extract<ReportLinkTarget, { readonly kind: "attempt" }> {
  return Object.freeze({ kind: "attempt" as const, locator });
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

function experimentLabel(sample: Sample, experimentId: string): string {
  const profile = sample.profiles[experimentId];
  const line = profile?.labels?.line;
  if (typeof line === "string" && line.length > 0) {
    const memory = profile.flags?.memory;
    if (typeof memory === "string" && memory.length > 0 && memory !== "baseline") {
      return `${line}+${memory}`;
    }
    return line;
  }
  return experimentId.split("/").pop() || experimentId;
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
