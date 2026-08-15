import type {
  AnalysisIssue,
  EvidenceRef,
  ExperimentId,
  MetricValue,
  Sample,
} from "../../analysis/index.ts";
import { costUSD, totalCostUSD } from "../../analysis/index.ts";
import type { AttemptLocator } from "../../attempt-locator.ts";
import type { LocalizedText } from "../../shared/types.ts";
import {
  defineComponent,
  type ChartAxisKey,
  type ChartDimensionKey,
  type ReportComponent,
  type TableColumn,
} from "../components.ts";
import {
  reportElement,
  type AuthorReportNode,
} from "../author/element.ts";
import {
  aggregate,
  attempt,
  durationMs,
  evalId,
  experiment,
  passRate,
} from "../model/calculation.ts";
import type { ReportTone } from "../semantic/closed.ts";
import {
  attemptDetailTarget,
  experimentDetailTarget,
  libraryDetailRoute,
} from "../library/details.ts";
import {
  compactVerdictText,
  formatInstant,
  formatReportDateTimeRange,
} from "./format.ts";
import {
  Bars,
  Callouts,
  Col,
  CopyBlock,
  Grid,
  Line,
  Link,
  Scatter,
  Section,
  Stat,
  Table,
  Text,
  type CalloutItem,
  type ClassicChildren,
} from "./primitives.ts";

type RowRecord = object;

/** One full MetricValue is kept for every visible summary item. */
export interface MetricSummaryItem {
  readonly label: LocalizedText;
  readonly value: MetricValue;
}

/**
 * Classic metric cards are a neutral composition over existing Stat nodes.
 * They don't accept a Sample or SemanticFrame and cannot redefine a metric.
 */
export function MetricSummary(input: {
  readonly items: readonly MetricSummaryItem[];
  readonly detail?: boolean;
}): AuthorReportNode {
  return Grid({
    children: input.items.map((item) => Stat({ label: item.label, value: item.value })),
  });
}

export interface ComparisonProps<Row extends RowRecord> {
  readonly rows: readonly Row[];
  readonly columns?: readonly TableColumn<Row>[];
  readonly x: ChartAxisKey<Row>;
  readonly y: ChartAxisKey<Row>;
  readonly color?: ChartDimensionKey<Row>;
  readonly series?: ChartDimensionKey<Row>;
  readonly chart?: "bars" | "line" | "scatter";
  readonly title?: LocalizedText;
  readonly tableCaption?: LocalizedText;
}

/**
 * The classic comparison pattern sends the same closed rows to its chart and
 * table.  Both shapes preserve MetricValue cells and ClosedRows metadata.
 */
export function Comparison<Row extends RowRecord>(input: ComparisonProps<Row>): AuthorReportNode {
  const chartProps = {
    points: input.rows,
    x: input.x,
    y: input.y,
    ...(input.color === undefined ? {} : { color: input.color }),
    ...(input.series === undefined ? {} : { series: input.series }),
    ...(input.title === undefined ? {} : { title: input.title }),
  };
  const chart = input.chart === "line"
    ? Line(chartProps)
    : input.chart === "scatter"
    ? Scatter(chartProps)
    : Bars(chartProps);
  return Grid({
    children: [
      chart,
      Table({
        rows: input.rows,
        ...(input.columns === undefined ? {} : { columns: input.columns }),
        ...(input.tableCaption === undefined ? {} : { caption: input.tableCaption }),
      }),
    ],
  });
}

/** A closed Evidence / issue-bearing row suitable for classic detail pages. */
export interface EvidenceEntry {
  readonly locator: string;
  readonly state: string;
  readonly summary?: string;
  readonly tone?: ReportTone;
  readonly issues?: readonly AnalysisIssue[];
  readonly refs?: readonly EvidenceRef[];
}

/**
 * Shows each evidence state explicitly, then emits every retained issue and
 * evidence reference.  Missing and duplicate entries are caller-owned states,
 * not silently converted to an empty row.
 */
export function EvidenceSummary(input: {
  readonly title?: LocalizedText;
  readonly entries: readonly EvidenceEntry[];
}): AuthorReportNode {
  const rows = input.entries.map((entry) => ({
    locator: entry.locator,
    state: entry.state,
    summary: entry.summary ?? "",
    issues: entry.issues?.length ?? 0,
    evidence: entry.refs?.length ?? 0,
  }));
  const callouts: CalloutItem[] = input.entries.flatMap((entry) => {
    const items: CalloutItem[] = [];
    if ((entry.issues?.length ?? 0) > 0 || (entry.refs?.length ?? 0) > 0) {
      items.push({
        tone: entry.tone ?? "warning",
        title: `${entry.locator}: ${entry.state}`,
        text: entry.summary ?? {
          en: "Closed evidence carries issues or references.",
          "zh-CN": "闭合证据带有问题或引用。",
        },
        ...(entry.issues === undefined ? {} : { issues: entry.issues }),
        ...(entry.refs === undefined ? {} : { refs: entry.refs }),
      });
    }
    return items;
  });
  return Section({
    title: input.title ?? { en: "Evidence", "zh-CN": "证据" },
    children: [
      Table({
        caption: { en: "Closed evidence entries", "zh-CN": "闭合证据条目" },
        columns: [
          { key: "locator", label: { en: "Attempt", "zh-CN": "尝试" } },
          { key: "state", label: { en: "State", "zh-CN": "状态" } },
          { key: "summary", label: { en: "Summary", "zh-CN": "摘要" } },
          { key: "issues", label: { en: "Issues", "zh-CN": "问题" }, align: "end" },
          { key: "evidence", label: { en: "Evidence refs", "zh-CN": "证据引用" }, align: "end" },
        ],
        rows,
      }),
      ...(callouts.length === 0 ? [] : [Callouts({ items: callouts })]),
    ],
  });
}

/** A complete Analysis issue surface for pages that have no domain-specific view. */
export function IssueSummary(input: {
  readonly title?: LocalizedText;
  readonly issues: readonly AnalysisIssue[];
  readonly refs?: readonly EvidenceRef[];
}): AuthorReportNode {
  if (input.issues.length === 0 && (input.refs?.length ?? 0) === 0) {
    return Section({
      title: input.title ?? { en: "Data status", "zh-CN": "数据状态" },
      children: [Text({
        value: {
          en: "No Analysis issues were recorded.",
          "zh-CN": "没有记录 Analysis 问题。",
        },
      })],
    });
  }
  return Callouts({
    items: [{
      tone: input.issues.length === 0 ? "neutral" : "warning",
      title: input.title ?? { en: "Data status", "zh-CN": "数据状态" },
      text: input.issues.length === 0
        ? {
          en: "Evidence references are available.",
          "zh-CN": "证据引用可用。",
        }
        : {
          en: `${input.issues.length} Analysis issue(s) were retained.`,
          "zh-CN": `保留了 ${input.issues.length} 个 Analysis 问题。`,
        },
      issues: input.issues,
      ...(input.refs === undefined ? {} : { refs: input.refs }),
    }],
  });
}

/** A neutral list facade: caller supplies already closed rows and optional columns. */
export function DataList<Row extends RowRecord>(input: {
  readonly title?: LocalizedText;
  readonly rows: readonly Row[];
  readonly columns?: readonly TableColumn<Row>[];
}): AuthorReportNode {
  return Section({
    title: input.title ?? { en: "Data", "zh-CN": "数据" },
    children: [Table({
      rows: input.rows,
      ...(input.columns === undefined ? {} : { columns: input.columns }),
    })],
  });
}

export interface SampleSummaryProps {
  /** An explicit current-Scope Sample; omitted means `ctx.scope`. */
  readonly input?: Sample;
  /** Closed values may be supplied by a parent composition without recomputing. */
  readonly metrics?: readonly MetricSummaryItem[];
  readonly coverage?: readonly { readonly label: string; readonly value: string | number }[];
  readonly title?: LocalizedText;
  readonly detail?: boolean;
}

/**
 * The familiar zero-config summary remains a composition component.  It
 * requests only Analysis-owned MetricValues and passes them unchanged to the
 * neutral Stat/Table primitives.
 */
export const SampleSummary: ReportComponent<SampleSummaryProps> = defineComponent<SampleSummaryProps>(
  async (props, context) => {
    const sample = props.input ?? context.scope;
    const stats = props.metrics === undefined
      ? await defaultSummaryStats(sample)
      : props.metrics.map((item) => Stat({ label: item.label, value: item.value }));
    const range = runRangeText(sample);
    return classicShell("niceeval-classic-summary", [
      classicElement("h2", "niceeval-classic-summary-title", Text({
        value: props.title ?? { en: "Summary", "zh-CN": "摘要" },
      })),
      ...(stats.length === 0
        ? [Text({ value: {
          en: "No closed MetricValue was produced for this Sample.",
          "zh-CN": "此 Sample 没有闭合的 MetricValue。",
        } })]
        : [Grid({ children: stats })]),
      ...(props.coverage === undefined ? [] : [Table({
        caption: { en: "Coverage", "zh-CN": "覆盖" },
        columns: [
          { key: "label", label: { en: "Field", "zh-CN": "字段" } },
          { key: "value", label: { en: "Value", "zh-CN": "值" }, align: "end" },
        ],
        rows: props.coverage,
      })]),
      ...(range === undefined ? [] : [classicElement("p", "niceeval-classic-summary-range", Text({ value: range }))]),
    ]);
  },
);

export interface ExperimentScatterProps {
  readonly input?: Sample;
  readonly points?: readonly Readonly<Record<string, unknown>>[];
  readonly x?: string;
  readonly y?: string;
  readonly series?: string;
  readonly title?: LocalizedText;
}

/** A zero-config chart over the current Sample, or a closed points facade. */
export const ExperimentScatter: ReportComponent<ExperimentScatterProps> = defineComponent<ExperimentScatterProps>(
  async (props, context) => {
    const points = props.points ?? await aggregate(props.input ?? context.scope, {
      by: { experiment },
      values: { passRate, costUSD },
    });
    const x = props.x ?? "costUSD";
    const y = props.y ?? "passRate";
    return classicShell("niceeval-classic-scatter", Scatter({
      points: points as readonly Record<string, unknown>[],
      x: x as never,
      y: y as never,
      ...(props.series === undefined ? { series: "experiment" as never } : { series: props.series as never }),
      ...(props.title === undefined
        ? { title: { en: "Experiment comparison", "zh-CN": "实验对比" } }
        : { title: props.title }),
    }));
  },
);

export interface ExperimentTableProps {
  readonly input?: Sample;
  readonly rows?: readonly Readonly<Record<string, unknown>>[];
  readonly columns?: readonly TableColumn<Readonly<Record<string, unknown>>>[];
  readonly title?: LocalizedText;
}

/** A zero-config table over the same closed rows used by the comparison chart. */
export const ExperimentTable: ReportComponent<ExperimentTableProps> = defineComponent<ExperimentTableProps>(
  async (props, context) => {
    const sample = props.input ?? context.scope;
    const rows = props.rows ?? await experimentTableRows(sample);
    return classicShell("niceeval-classic-experiment-table", Table({
      caption: props.title ?? { en: "Experiments", "zh-CN": "实验" },
      searchable: true,
      sort: props.rows === undefined ? { field: "passRate", direction: "desc" } : undefined,
      rows,
      ...(props.columns === undefined
        ? props.rows === undefined
          ? {
            columns: [
              { key: "experiment", label: { en: "Experiment", "zh-CN": "实验" } },
              { key: "passRate", label: { en: "Pass rate", "zh-CN": "通过率" }, align: "end" },
              { key: "duration", label: { en: "Avg. time", "zh-CN": "平均用时" }, align: "end" },
              { key: "cost", label: { en: "Avg. cost", "zh-CN": "平均成本" }, align: "end" },
              { key: "record", label: { en: "Record", "zh-CN": "记录" }, align: "end" },
            ],
          }
          : {}
        : { columns: props.columns }),
    }));
  },
);

export interface AttemptListProps {
  readonly input?: Sample;
  readonly rows?: readonly Readonly<Record<string, unknown>>[];
  readonly columns?: readonly TableColumn<Readonly<Record<string, unknown>>>[];
  readonly title?: LocalizedText;
}

/** Closed Sample identities replace the legacy Record-backed attempt handles. */
export const AttemptList: ReportComponent<AttemptListProps> = defineComponent<AttemptListProps>((props, context) => {
  const sample = props.input ?? context.scope;
  const rows = props.rows ?? sample.snapshot.slots.map((slot) => Object.freeze({
    locator: slot.state === "included" ? slot.attempt.locator : "not-recorded",
    experiment: slot.experimentId,
    evalId: slot.evalId,
    state: slot.state,
  }));
  return classicShell("niceeval-classic-attempt-list", DataList({
    title: props.title ?? { en: "Attempts", "zh-CN": "尝试" },
    rows,
    ...(props.columns === undefined ? {} : { columns: props.columns }),
  }));
});

/** A transparent filter over closed Sample state, not a second verdict fold. */
export const FailureList: ReportComponent<AttemptListProps> = defineComponent<AttemptListProps>((props, context) => {
  const sample = props.input ?? context.scope;
  const fallback = sample.snapshot.slots
    .filter((slot) => slot.state !== "included")
    .map((slot) => Object.freeze({
      experiment: slot.experimentId,
      evalId: slot.evalId,
      state: slot.state,
    }));
  return classicShell("niceeval-classic-failure-list", DataList({
    title: props.title ?? { en: "Data requiring attention", "zh-CN": "需要关注的数据" },
    rows: props.rows ?? fallback,
    ...(props.columns === undefined ? {} : { columns: props.columns }),
  }));
});

export const StabilityOverview: ReportComponent<ExperimentTableProps> = defineComponent<ExperimentTableProps>(
  async (props, context) => {
    const rows = props.rows ?? await aggregate(props.input ?? context.scope, {
      by: { experiment },
      values: { passRate },
    });
    return classicShell("niceeval-classic-stability", DataList({
      title: props.title ?? { en: "Stability", "zh-CN": "稳定性" },
      rows: rows as readonly Readonly<Record<string, unknown>>[],
      ...(props.columns === undefined ? {} : { columns: props.columns }),
    }));
  },
);

export interface AttemptDetailsProps {
  readonly title?: LocalizedText;
  readonly sections?: readonly { readonly title: LocalizedText; readonly children?: ClassicChildren }[];
}

/** Details accept only pre-closed domain content; they never open an Attempt or Record. */
export const AttemptDetails: ReportComponent<AttemptDetailsProps> = defineComponent<AttemptDetailsProps>((props) =>
  classicShell("niceeval-classic-attempt-details", Section({
    title: props.title ?? { en: "Attempt details", "zh-CN": "尝试详情" },
    children: props.sections === undefined || props.sections.length === 0
      ? [Text({
        value: {
          en: "Pass a closed Evidence, trace, source, or diff section to render details.",
          "zh-CN": "传入已闭合的 Evidence、trace、source 或 diff 区块以呈现详情。",
        },
      })]
      : props.sections.map((section) => Section(section)),
  }))
);

export const AttemptAssessment = AttemptDetails;
export const AttemptSummary = AttemptDetails;
export const ExperimentDetails = AttemptDetails;

export interface SampleOverviewProps {
  readonly input?: Sample;
  readonly summary?: ClassicChildren;
  readonly comparison?: ClassicChildren;
  readonly table?: ClassicChildren;
  readonly notices?: ClassicChildren;
}

/** The classic overview keeps its familiar no-prop use while all I/O stays in child components. */
export const SampleOverview: ReportComponent<SampleOverviewProps> = defineComponent<SampleOverviewProps>((props) =>
  Col({
    children: [
      props.notices ?? SampleNotices({ input: props.input }),
      props.summary ?? SampleSummary({ input: props.input }),
      props.comparison ?? ExperimentScatter({ input: props.input }),
      props.table ?? ExperimentTable({ input: props.input }),
    ],
  })
);

export interface HeroLogo {
  readonly src: string;
  readonly alt: string;
}

export interface HeroLink {
  readonly label: LocalizedText;
  readonly href: string;
}

export interface HeroProps {
  readonly title?: LocalizedText;
  readonly description?: LocalizedText;
  readonly logo?: HeroLogo;
  readonly links?: readonly HeroLink[];
}

/**
 * Hero restores the 0.12 title / description / HTTPS link / last-run hierarchy.
 * External hrefs are closed `link` nodes; Host classifies them as https.
 */
export const Hero: ReportComponent<HeroProps> = defineComponent<HeroProps>((props, context) => {
  const meta = heroMeta(context.scope);
  return classicElement("header", "niceeval-classic niceeval-classic-hero", [
    ...(props.logo === undefined
      ? []
      : [classicElement("p", "niceeval-classic-hero-logo", Text({ value: props.logo.alt }))]),
    classicElement("h1", "niceeval-classic-hero-title", Text({ value: props.title ?? context.page.title })),
    ...(props.description === undefined
      ? []
      : [classicElement("p", "niceeval-classic-hero-description", Text({ value: props.description }))]),
    ...((props.links ?? []).length === 0 ? [] : [classicElement("div", "niceeval-classic-hero-links",
      (props.links ?? []).map((link) => Link({
        href: link.href,
        className: "niceeval-classic-hero-link",
        children: Text({ value: link.label }),
      })),
    )]),
    ...(meta === undefined ? [] : [classicElement("p", "niceeval-classic-hero-meta", Text({ value: meta }))]),
    PoweredBy({}),
  ]);
});

export const HeroCard = Hero;

/** Package attribution is a closed HTTPS link, same destination as the site brand. */
export const PoweredBy: ReportComponent<Record<never, never>> = defineComponent<Record<never, never>>(() =>
  classicElement("p", "niceeval-classic niceeval-classic-powered-by", Link({
    href: "https://niceeval.com/?utm_source=report&utm_medium=powered",
    className: "niceeval-classic-powered-by-link",
    children: Text({
      value: { en: "Powered by NiceEval", "zh-CN": "由 NiceEval 提供" },
    }),
  }))
);

export interface SampleNoticesProps {
  readonly input?: Sample;
  readonly items?: readonly CalloutItem[];
}

/** Coverage facts are closed in Sample.snapshot and remain visible when incomplete. */
export const SampleNotices: ReportComponent<SampleNoticesProps> = defineComponent<SampleNoticesProps>((props, context) => {
  const sample = props.input ?? context.scope;
  const coverage = sample.snapshot.coverage;
  const items = props.items ?? (coverage.notRecorded + coverage.coreInvalid === 0
    ? []
    : [{
      tone: "warning" as const,
      title: { en: "Sample completeness", "zh-CN": "Sample 完整度" },
      text: {
        en: `${coverage.notRecorded} not-recorded and ${coverage.coreInvalid} core-invalid slot(s) remain visible in this Report.`,
        "zh-CN": `此 Report 仍可见 ${coverage.notRecorded} 个未记录与 ${coverage.coreInvalid} 个 core-invalid slot。`,
      },
    }]);
  if (items.length === 0) {
    return classicElement("div", "niceeval-classic niceeval-classic-notices niceeval-classic-notices-empty", []);
  }
  return classicShell("niceeval-classic-notices", Callouts({ items }));
});

export const RunNotices = SampleNotices;

export interface SampleFixPromptProps {
  readonly value?: string;
  readonly title?: LocalizedText;
}

/** Existing closed remediation text becomes a no-JS-readable copy block. */
export const SampleFixPrompt: ReportComponent<SampleFixPromptProps> = defineComponent<SampleFixPromptProps>((props) =>
  classicShell("niceeval-classic-fix-prompt", CopyBlock({
    value: props.value ?? "No closed remediation prompt was supplied.",
    ...(props.title === undefined ? {} : { title: props.title }),
  }))
);

async function defaultSummaryStats(sample: Sample): Promise<readonly AuthorReportNode[]> {
  const [passRows, costRows] = await Promise.all([
    aggregate(sample, { by: {}, values: { passRate } }),
    aggregate(sample, { by: {}, values: { totalCostUSD } }),
  ]);
  const pass = passRows[0]?.passRate;
  const cost = costRows[0]?.totalCostUSD;
  const counts = sampleCounts(sample);
  return Object.freeze([
    ...(pass === undefined
      ? [summaryStat({ en: "Pass rate", "zh-CN": "通过率" }, "—")]
      : [Stat({ label: { en: "Pass rate", "zh-CN": "通过率" }, value: pass })]),
    summaryStat({ en: "Experiments", "zh-CN": "实验" }, String(counts.experiments)),
    summaryStat({ en: "Evals", "zh-CN": "评测" }, String(counts.evals)),
    summaryStat({ en: "Attempts", "zh-CN": "尝试" }, String(counts.attempts)),
    summaryStat(
      { en: "Eval results", "zh-CN": "评测结果" },
      pass === undefined ? "—" : compactVerdictText(pass),
    ),
    ...(cost === undefined
      ? [summaryStat({ en: "Total cost", "zh-CN": "总成本" }, "—")]
      : [Stat({ label: { en: "Total cost", "zh-CN": "总成本" }, value: cost })]),
  ]);
}

function sampleCounts(sample: Sample): { readonly experiments: number; readonly evals: number; readonly attempts: number } {
  const slots = sample.snapshot.slots.filter((slot) => slot.state !== "excluded");
  return Object.freeze({
    experiments: new Set(slots.map((slot) => slot.experimentId)).size,
    evals: new Set(slots.map((slot) => slot.evalId)).size,
    attempts: slots.filter((slot) => slot.state === "included").length,
  });
}

function runRangeText(sample: Sample): LocalizedText | undefined {
  const runs = sample.snapshot.runs;
  if (runs.length === 0) return undefined;
  const started = runs.map((run) => run.startedAt).filter((value) => Number.isFinite(value));
  const completed = runs.map((run) => run.completedAt).filter((value) => Number.isFinite(value));
  if (started.length === 0 || completed.length === 0) return undefined;
  const from = Math.min(...started);
  const to = Math.max(...completed);
  if (from === to) {
    return {
      en: `Last run · ${formatInstant(to, "en")}`,
      "zh-CN": `最近运行 · ${formatInstant(to, "zh-CN")}`,
    };
  }
  const en = formatReportDateTimeRange(from, to, "en");
  const zh = formatReportDateTimeRange(from, to, "zh-CN");
  return {
    en: `Run range · ${en.from} – ${en.to}`,
    "zh-CN": `运行区间 · ${zh.from} – ${zh.to}`,
  };
}

function heroMeta(sample: Sample): LocalizedText | undefined {
  const runs = sample.snapshot.runs;
  if (runs.length === 0) return undefined;
  const completed = runs.map((run) => run.completedAt).filter((value) => Number.isFinite(value));
  if (completed.length === 0) return undefined;
  const latest = Math.max(...completed);
  return {
    en: runs.length > 1
      ? `Last run ${formatInstant(latest, "en")} · composed from ${runs.length} runs`
      : `Last run ${formatInstant(latest, "en")}`,
    "zh-CN": runs.length > 1
      ? `最近运行 ${formatInstant(latest, "zh-CN")} · 合成自 ${runs.length} 次运行`
      : `最近运行 ${formatInstant(latest, "zh-CN")}`,
  };
}

const UNAVAILABLE: LocalizedText = Object.freeze({
  en: "unavailable",
  "zh-CN": "不可用",
});

type IncludedSlot = Extract<Sample["snapshot"]["slots"][number], { readonly state: "included" }>;
type ActiveSlot = Extract<
  Sample["snapshot"]["slots"][number],
  { readonly state: "included" | "not-recorded" | "core-invalid" }
>;

interface AttemptFact {
  readonly experiment: unknown;
  readonly evalId: unknown;
  readonly attempt: unknown;
  readonly passRate: MetricValue;
  readonly durationMs: MetricValue;
  readonly costUSD: MetricValue;
}

async function experimentTableRows(sample: Sample): Promise<readonly Record<string, unknown>[]> {
  const [experiments, evals, attemptRows] = await Promise.all([
    aggregate(sample, { by: { experiment }, values: { passRate, durationMs, costUSD } }),
    aggregate(sample, { by: { experiment, evalId }, values: { passRate, durationMs, costUSD } }),
    aggregate(sample, { by: { experiment, evalId, attempt }, values: { passRate, durationMs, costUSD } }),
  ]);
  const facts = new Map<string, AttemptFact>();
  for (const row of attemptRows) {
    const locator = closedAttemptLocator(row.attempt);
    if (locator === undefined) continue;
    facts.set(attemptFactKey(row.experiment, row.evalId, locator), row);
  }
  const members = sample.snapshot.slots.filter(
    (slot): slot is ActiveSlot => slot.state !== "excluded",
  );
  return Object.freeze(experiments.map((row) => {
    const evalRows = evals.filter((entry) => entry.experiment === row.experiment).map((entry) => {
      const attempts = closedAttemptChildren(row.experiment, entry.evalId, members, facts);
      return Object.freeze({
        experiment: String(entry.evalId),
        passRate: entry.passRate,
        duration: entry.durationMs,
        cost: entry.costUSD,
        record: compactVerdictText(entry.passRate),
        fresh: attempts.some((child) => child.fresh === true),
        subRows: attempts,
      });
    });
    return Object.freeze({
      experiment: String(row.experiment),
      passRate: row.passRate,
      duration: row.durationMs,
      cost: row.costUSD,
      record: compactVerdictText(row.passRate),
      fresh: evalRows.some((entry) => entry.fresh === true),
      href: experimentHref(row.experiment),
      subRows: evalRows,
    });
  }));
}

function closedAttemptChildren(
  experimentId: unknown,
  evalKey: unknown,
  members: readonly ActiveSlot[],
  facts: ReadonlyMap<string, AttemptFact>,
): readonly Record<string, unknown>[] {
  const seen = new Set<string>();
  const rows: Record<string, unknown>[] = [];
  for (const slot of members) {
    if (slot.experimentId !== experimentId || slot.evalId !== evalKey) continue;
    if (slot.state !== "included") {
      rows.push(unavailableDenominatorRow(slot));
      continue;
    }
    const locator = slot.attempt.locator;
    seen.add(locator);
    rows.push(closedAttemptRow(
      locator,
      facts.get(attemptFactKey(slot.experimentId, slot.evalId, locator)),
      slot,
    ));
  }
  for (const fact of facts.values()) {
    if (fact.experiment !== experimentId || fact.evalId !== evalKey) continue;
    const locator = closedAttemptLocator(fact.attempt);
    if (locator === undefined || seen.has(locator)) continue;
    rows.push(closedAttemptRow(locator, fact, undefined));
  }
  return Object.freeze(rows);
}

function unavailableDenominatorRow(
  slot: Extract<ActiveSlot, { readonly state: "not-recorded" | "core-invalid" }>,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    experiment: slot.state === "core-invalid"
      ? { en: "core-invalid", "zh-CN": "core-invalid" }
      : { en: "not-recorded", "zh-CN": "未记录" },
    passRate: UNAVAILABLE,
    duration: UNAVAILABLE,
    cost: UNAVAILABLE,
    record: UNAVAILABLE,
    fresh: false,
  });
}

function closedAttemptRow(
  locator: AttemptLocator,
  fact: AttemptFact | undefined,
  slot: IncludedSlot | undefined,
): Readonly<Record<string, unknown>> {
  const href = libraryDetailRoute(attemptDetailTarget(locator));
  const fresh = slot?.action === "executed";
  if (fact === undefined) {
    return Object.freeze({
      experiment: locator,
      passRate: UNAVAILABLE,
      duration: UNAVAILABLE,
      cost: UNAVAILABLE,
      record: UNAVAILABLE,
      fresh,
      href,
    });
  }
  return Object.freeze({
    experiment: locator,
    passRate: fact.passRate,
    duration: fact.durationMs,
    cost: fact.costUSD,
    record: compactVerdictText(fact.passRate),
    fresh,
    href,
  });
}

function experimentHref(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0
    ? libraryDetailRoute(experimentDetailTarget(value as ExperimentId))
    : undefined;
}

function closedAttemptLocator(value: unknown): AttemptLocator | undefined {
  return typeof value === "string" && value.length > 0 ? value as AttemptLocator : undefined;
}

function attemptFactKey(experimentId: unknown, evalKey: unknown, locator: string): string {
  return `${String(experimentId)}\0${String(evalKey)}\0${locator}`;
}

function summaryStat(label: LocalizedText, value: LocalizedText): AuthorReportNode {
  return classicElement("div", "niceeval-classic-stat", [
    classicElement("div", "niceeval-classic-stat-label", Text({ value: label })),
    classicElement("div", "niceeval-classic-stat-value", Text({ value })),
  ]);
}

function classicElement(
  tag: "div" | "section" | "header" | "h1" | "h2" | "p" | "span" | "small" | "a" | "details" | "summary",
  className: string,
  children: AuthorReportNode,
): AuthorReportNode {
  return reportElement(tag, Object.freeze({ className, children }));
}

function classicShell(className: string, children: AuthorReportNode): AuthorReportNode {
  return reportElement("section", Object.freeze({ className: `niceeval-classic ${className}`, children }));
}
