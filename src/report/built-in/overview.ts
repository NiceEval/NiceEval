import type { Sample, SampleSnapshot } from "../../analysis/index.ts";
import {
  Callout,
  defineReport,
  Stack,
  Stat,
  Table,
  Text,
  type PlainPageDefinition,
  type Report,
} from "../author/index.ts";
import {
  loadBuiltInSummaryRows,
  type BuiltInSummaryRows,
} from "./analysis-values.ts";

const RUN_ROWS_MAX = 200;
const ATTEMPT_ROWS_MAX = 200;

interface OverviewPageInput {
  readonly snapshot: SampleSnapshot;
  readonly metrics: BuiltInSummaryRows;
}

const overviewPage = {
  id: "overview",
  path: "/",
  title: "Overview",
  load: async (sample: Sample): Promise<OverviewPageInput> => Object.freeze({
    snapshot: sample.snapshot,
    metrics: await loadBuiltInSummaryRows(sample),
  }),
  render: overviewNode,
} satisfies PlainPageDefinition<OverviewPageInput>;

/** The default project-current report over Analysis-owned MetricValues. */
export const defaultOverviewReport: Report = defineReport({
  title: "NiceEval overview",
  pages: [overviewPage],
});

/** Stable built-in token target for an explicit `--report overview`. */
export const overview = defaultOverviewReport;

export default defaultOverviewReport;

function overviewNode(input: OverviewPageInput) {
  const { coverage, runs, selection, slots } = input.snapshot;
  const metrics = input.metrics[0];
  const included = slots.filter((slot) => slot.state === "included");
  const visibleRuns = runs.slice(0, RUN_ROWS_MAX);
  const visibleAttempts = included.slice(0, ATTEMPT_ROWS_MAX);

  return Stack({
    children: [
      Text({ value: selectionLabel(selection) }),
      ...(metrics === undefined
        ? [unavailableCallout("No aggregate MetricValue was produced for this Sample.")]
        : [
          Stat({ label: "Pass rate", value: metrics.passRate }),
          Stat({ label: "Mean latency", value: metrics.meanLatencyMs }),
          Stat({ label: "Tool failure rate", value: metrics.toolFailureRate }),
        ]),
      Table({
        caption: "Sample coverage",
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
      Table({
        caption: "Selected Runs",
        columns: [
          { key: "runId", label: "Run" },
          { key: "expectedSlots", label: "Expected slots", align: "end" },
          { key: "completedAt", label: "Completed at (ms)", align: "end" },
        ],
        rows: visibleRuns.map((run) => ({
          runId: run.runId,
          expectedSlots: run.expectedSlots.length,
          completedAt: run.completedAt,
        })),
      }),
      ...(runs.length === visibleRuns.length
        ? []
        : [omittedCallout("selected Run", runs.length - visibleRuns.length)]),
      Table({
        caption: "Included Attempts",
        columns: [
          { key: "locator", label: "Attempt" },
          { key: "originRunId", label: "Origin Run" },
          { key: "runId", label: "Selected Run" },
          { key: "slotId", label: "Slot" },
          { key: "relation", label: "Member relation" },
        ],
        rows: visibleAttempts.map((slot) => ({
          locator: slot.attempt.locator,
          originRunId: slot.attempt.originRunId,
          runId: slot.runId,
          slotId: slot.slotId,
          relation: slot.relation,
        })),
      }),
      ...(included.length === visibleAttempts.length
        ? []
        : [omittedCallout("included Attempt", included.length - visibleAttempts.length)]),
    ],
  });
}

function selectionLabel(selection: SampleSnapshot["selection"]): string {
  return selection.selectedRunIds.length === 0
    ? "Selection: empty"
    : `Selection: ${selection.selectedRunIds.length} sealed Run(s)`;
}

function omittedCallout(kind: string, count: number) {
  return Callout({
    tone: "warning",
    title: "Bounded summary",
    children: [Text({ value: `${count} additional ${kind}(s) omitted.` })],
  });
}

function unavailableCallout(message: string) {
  return Callout({
    tone: "warning",
    title: "Analysis result unavailable",
    children: [Text({ value: message })],
  });
}
