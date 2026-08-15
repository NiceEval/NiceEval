import type { Sample, SampleSnapshot } from "../../analysis/index.ts";
import {
  defineReport,
  Text,
  type PlainPageDefinition,
} from "../author/index.ts";
import {
  AttemptDetails,
  AttemptList,
  DataList,
  ExperimentTable,
  IssueSummary,
  MetricSummary,
  SampleOverview,
  StabilityOverview,
} from "../classic/components.ts";
import { Col, Section } from "../classic/primitives.ts";
import {
  loadBuiltInSummaryRows,
  type BuiltInSummaryRows,
} from "./analysis-values.ts";

interface ClassicOverviewPageInput {
  readonly snapshot: SampleSnapshot;
  readonly metrics: BuiltInSummaryRows;
}

const classicOverviewPage = {
  id: "classic-overview",
  path: "/",
  title: "Classic overview",
  load: async (sample: Sample): Promise<ClassicOverviewPageInput> => Object.freeze({
    snapshot: sample.snapshot,
    metrics: await loadBuiltInSummaryRows(sample),
  }),
  render: classicOverviewNode,
} satisfies PlainPageDefinition<ClassicOverviewPageInput>;

/** The zero-configuration v0.12-style overview used by `standard`. */
export const standardOverviewPage = {
  id: "overview",
  title: "Overview",
  render: (sample: Sample) => SampleOverview({ input: sample }),
} satisfies PlainPageDefinition<Sample>;

/** Ordinary paths are derived from ids, so these pages compose into any Report. */
export const standardAttemptsPage = {
  id: "attempts",
  title: "Attempts",
  render: (sample: Sample) => AttemptList({ input: sample }),
} satisfies PlainPageDefinition<Sample>;

export const standardTracesPage = {
  id: "traces",
  title: "Traces",
  render: () => Section({
    title: "Traces",
    children: [Text({ value: "Trace evidence is rendered by an explicit closed DomainView detail Page." })],
  }),
} satisfies PlainPageDefinition<Sample>;

export const standardAttemptPage = {
  id: "attempt",
  title: "Attempt detail",
  render: () => AttemptDetails({
    title: "Attempt detail",
    sections: [{
      title: "Closed evidence",
      children: [Text({ value: "Select a generated evidence detail route for one included Attempt." })],
    }],
  }),
} satisfies PlainPageDefinition<Sample>;

export const standardExperimentPage = {
  id: "experiment",
  title: "Experiment detail",
  render: (sample: Sample) => Col({
    children: [
      ExperimentTable({ input: sample, title: "Experiments" }),
      StabilityOverview({ input: sample, title: "Stability" }),
    ],
  }),
} satisfies PlainPageDefinition<Sample>;

/**
 * A v0.12-style overview rebuilt on today's Sample and MetricValue boundary.
 * It owns no Record access and never rematerializes an aggregate from rows.
 */
export const classicOverviewReport = defineReport({
  title: "NiceEval classic overview",
  pages: [classicOverviewPage],
});

/** A complete SSG-first classic library Report; no page performs browser I/O. */
export const standard = defineReport({
  title: "NiceEval standard report",
  pages: [
    standardOverviewPage,
    standardAttemptsPage,
    standardTracesPage,
    standardAttemptPage,
    standardExperimentPage,
  ],
});

export default classicOverviewReport;

function classicOverviewNode(input: ClassicOverviewPageInput) {
  const metrics = input.metrics[0];
  const coverage = input.snapshot.coverage;
  return Col({
    children: [
      Text({ value: selectionLabel(input.snapshot) }),
      ...(metrics === undefined
        ? [Section({
          title: "Metrics unavailable",
          tone: "warning",
          children: [Text({ value: "Analysis produced no aggregate MetricValue for this Sample." })],
        })]
        : [MetricSummary({
          detail: true,
          items: [
            { label: "Pass rate", value: metrics.passRate },
            { label: "Mean latency", value: metrics.meanLatencyMs },
            { label: "Tool failure rate", value: metrics.toolFailureRate },
          ],
        })]),
      DataList({
        title: "Sample coverage",
        columns: [
          { key: "field", label: "Field" },
          { key: "value", label: "Value", align: "end" },
        ],
        rows: [
          { field: "Frame slots", value: coverage.frameTotal },
          { field: "Selected slots", value: coverage.selected },
          { field: "Included slots", value: coverage.included },
          { field: "Not recorded", value: coverage.notRecorded },
          { field: "Core invalid", value: coverage.coreInvalid },
          { field: "Excluded", value: coverage.excluded },
        ],
      }),
      IssueSummary({
        title: "Aggregate data status",
        issues: input.metrics.issues,
        refs: input.metrics.refs,
      }),
    ],
  });
}

function selectionLabel(snapshot: SampleSnapshot): string {
  const selected = snapshot.selection.selectedRunIds.length;
  return selected === 0
    ? "Selection: empty"
    : `Selection: ${selected} sealed Run(s)`;
}
