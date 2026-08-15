import type {
  AnalysisIssue,
  EvidenceRef,
  MetricValue,
  Sample,
} from "../../analysis/index.ts";
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
import { loadBuiltInSummaryRows } from "../built-in/analysis-values.ts";
import {
  aggregate,
  durationMs,
  experiment,
  passRate,
} from "../model/calculation.ts";
import type { ReportNode, ReportTone } from "../semantic/closed.ts";
import {
  Bars,
  Callouts,
  Col,
  CopyBlock,
  Grid,
  Line,
  Metric,
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
  const detail = input.detail ?? false;
  return Grid({
    children: input.items.map((item) => detail
      ? Metric({ label: item.label, value: item.value })
      : Stat({ label: item.label, value: item.value })),
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
        text: entry.summary ?? "Closed evidence carries issues or references.",
        ...(entry.issues === undefined ? {} : { issues: entry.issues }),
        ...(entry.refs === undefined ? {} : { refs: entry.refs }),
      });
    }
    return items;
  });
  return Section({
    title: input.title ?? "Evidence",
    children: [
      Table({
        caption: "Closed evidence entries",
        columns: [
          { key: "locator", label: "Attempt" },
          { key: "state", label: "State" },
          { key: "summary", label: "Summary" },
          { key: "issues", label: "Issues", align: "end" },
          { key: "evidence", label: "Evidence refs", align: "end" },
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
      title: input.title ?? "Data status",
      children: [Text({ value: "No Analysis issues were recorded." })],
    });
  }
  return Callouts({
    items: [{
      tone: input.issues.length === 0 ? "neutral" : "warning",
      title: input.title ?? "Data status",
      text: input.issues.length === 0
        ? "Evidence references are available."
        : `${input.issues.length} Analysis issue(s) were retained.`,
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
    title: input.title ?? "Data",
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
    const rows = props.metrics === undefined ? await loadBuiltInSummaryRows(sample) : undefined;
    const metrics = props.metrics ?? summaryItems(rows);
    const coverage = props.coverage ?? coverageRows(sample);
    return classicShell("niceeval-classic-summary", Section({
      title: props.title ?? "Summary",
      children: [
        ...(metrics.length === 0
          ? [Text({ value: "No closed MetricValue was produced for this Sample." })]
          : [MetricSummary({ items: metrics, detail: props.detail ?? true })]),
        Table({
          caption: "Coverage",
          columns: [
            { key: "label", label: "Field" },
            { key: "value", label: "Value", align: "end" },
          ],
          rows: coverage,
        }),
      ],
    }));
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
      values: { passRate, durationMs },
    });
    const x = props.x ?? "durationMs";
    const y = props.y ?? "passRate";
    return classicShell("niceeval-classic-scatter", Scatter({
      points: points as readonly Record<string, unknown>[],
      x: x as never,
      y: y as never,
      ...(props.series === undefined ? { series: "experiment" as never } : { series: props.series as never }),
      ...(props.title === undefined ? { title: "Experiment comparison" } : { title: props.title }),
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
    const rows = props.rows ?? await aggregate(props.input ?? context.scope, {
      by: { experiment },
      values: { passRate, durationMs },
    });
    return classicShell("niceeval-classic-experiment-table", DataList({
      title: props.title ?? "Experiments",
      rows: rows as readonly Readonly<Record<string, unknown>>[],
      ...(props.columns === undefined ? {} : { columns: props.columns }),
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
    title: props.title ?? "Attempts",
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
    title: props.title ?? "Data requiring attention",
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
      title: props.title ?? "Stability",
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
    title: props.title ?? "Attempt details",
    children: props.sections === undefined || props.sections.length === 0
      ? [Text({ value: "Pass a closed Evidence, trace, source, or diff section to render details." })]
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
  readonly label: string;
  readonly href: string;
}

export interface HeroProps {
  readonly title?: LocalizedText;
  readonly description?: string;
  readonly logo?: HeroLogo;
  readonly links?: readonly HeroLink[];
}

/**
 * Hero keeps 0.12's branding input but does not emit an image or remote link.
 * Both are represented as ordinary readable text until a Host-provided local
 * asset declaration is available.
 */
export const Hero: ReportComponent<HeroProps> = defineComponent<HeroProps>((props, context) =>
  classicShell("niceeval-classic-hero", Section({
    title: props.title ?? context.page.title,
    children: [
      ...(props.logo === undefined ? [] : [Text({ value: `Brand: ${props.logo.alt}` })]),
      ...(props.description === undefined ? [] : [Text({ value: props.description })]),
      ...(props.links ?? []).map((link) => Text({ value: `${link.label}: ${link.href}` })),
    ],
  }))
);

export const HeroCard = Hero;

/** Package attribution is ordinary text so it survives every rendering face. */
export const PoweredBy: ReportComponent<Record<never, never>> = defineComponent<Record<never, never>>(() =>
  classicShell("niceeval-classic-powered-by", Text({ value: "Powered by NiceEval" }))
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
      title: "Sample completeness",
      text: `${coverage.notRecorded} not-recorded and ${coverage.coreInvalid} core-invalid slot(s) remain visible in this Report.`,
    }]);
  return classicShell(
    "niceeval-classic-notices",
    items.length === 0 ? Text({ value: "No Sample completeness notices." }) : Callouts({ items }),
  );
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

function summaryItems(rows: Awaited<ReturnType<typeof loadBuiltInSummaryRows>> | undefined): readonly MetricSummaryItem[] {
  const row = rows?.[0];
  return row === undefined
    ? Object.freeze([])
    : Object.freeze([
      Object.freeze({ label: "Pass rate", value: row.passRate }),
      Object.freeze({ label: "Mean duration", value: row.meanLatencyMs }),
      Object.freeze({ label: "Tool failure rate", value: row.toolFailureRate }),
    ]);
}

function coverageRows(sample: Sample): readonly { readonly label: string; readonly value: number }[] {
  const coverage = sample.snapshot.coverage;
  return Object.freeze([
    Object.freeze({ label: "Frame slots", value: coverage.frameTotal }),
    Object.freeze({ label: "Selected slots", value: coverage.selected }),
    Object.freeze({ label: "Included slots", value: coverage.included }),
    Object.freeze({ label: "Not recorded", value: coverage.notRecorded }),
    Object.freeze({ label: "Core invalid", value: coverage.coreInvalid }),
    Object.freeze({ label: "Excluded", value: coverage.excluded }),
  ]);
}

function classicShell(className: string, children: AuthorReportNode): AuthorReportNode {
  return reportElement("section", Object.freeze({ className: `niceeval-classic ${className}`, children }));
}
