import { Either } from "effect";
import type { AnalysisSample, AnalysisSlot } from "../../analysis/index.ts";
import {
  definePage,
  defineReport,
  reportComponentId,
  reportId,
  reportRoute,
} from "../author/index.ts";
import {
  reportDocument,
  reportMetric,
  reportSection,
  reportStatus,
  reportTable,
  reportText,
  type ReportBlockV1,
} from "../semantic/index.ts";

const RUN_ROWS_MAX = 200;
const SLOT_ISSUES_MAX = 200;
const ISSUES_PER_SLOT_MAX = 4;

const slotStates = ["included", "not-recorded", "core-invalid", "excluded"] as const;
type SlotState = (typeof slotStates)[number];

export const overviewPage = definePage({
  id: Either.getOrThrow(reportComponentId("overview")),
  route: Either.getOrThrow(reportRoute("/")),
  render: ({ sample }) => overviewDocument(sample),
});

/** The zero-configuration Report for one selected AnalysisSample. */
export const defaultOverviewReport = defineReport({
  id: Either.getOrThrow(reportId("default-overview")),
  pages: [overviewPage],
});

/** A short named form for callers that prefer a named built-in import. */
export const overview = defaultOverviewReport;

export default defaultOverviewReport;

function overviewDocument(sample: AnalysisSample) {
  const stateCounts = countSlotStates(sample.slots);
  const issueBlocks = slotIssueBlocks(sample.slots);
  const visibleRuns = sample.runs.slice(0, RUN_ROWS_MAX);
  const omittedRuns = sample.runs.length - visibleRuns.length;

  return reportDocument({
    title: "NiceEval overview",
    children: [
      reportMetric({ label: "Selected runs", value: sample.runs.length }),
      reportMetric({ label: "Slot denominator", value: sample.denominator }),
      reportMetric({ label: "Expected slots", value: sample.slots.length }),
      reportSection({
        heading: "Selected runs",
        children: [
          reportStatus({
            tone: "neutral",
            label: selectionLabel(sample),
          }),
          reportTable({
            caption: "Selected runs",
            columns: [
              { key: "run", label: "Run" },
              { key: "expectedSlots", label: "Expected slots", align: "end" },
              { key: "completedAt", label: "Completed at (ms)", align: "end" },
            ],
            rows: visibleRuns.map((run) => ({
              run: run.runId,
              expectedSlots: run.expectedSlots.length,
              completedAt: run.completedAt,
            })),
          }),
          ...(omittedRuns === 0
            ? []
            : [reportStatus({
              tone: "warning",
              label: `${omittedRuns} selected run(s) omitted from this bounded table`,
            })]),
        ],
      }),
      reportSection({
        heading: "Slot states",
        children: [
          reportTable({
            caption: "Slot denominator by state",
            columns: [
              { key: "state", label: "State" },
              { key: "slots", label: "Slots", align: "end" },
              { key: "denominator", label: "In denominator", align: "end" },
              { key: "meaning", label: "Meaning" },
            ],
            rows: slotStates.map((state) => ({
              state,
              slots: stateCounts[state],
              denominator: state === "excluded" ? 0 : stateCounts[state],
              meaning: slotStateMeaning(state),
            })),
          }),
        ],
      }),
      reportSection({
        heading: "Slot problems",
        children: issueBlocks,
      }),
    ],
  });
}

function countSlotStates(slots: readonly AnalysisSlot[]): Readonly<Record<SlotState, number>> {
  const counts: Record<SlotState, number> = {
    included: 0,
    "not-recorded": 0,
    "core-invalid": 0,
    excluded: 0,
  };
  for (const slot of slots) {
    counts[slot.state] += 1;
  }
  return Object.freeze(counts);
}

function selectionLabel(sample: AnalysisSample): string {
  if (sample.selection.policy === "explicit-runs/v1") {
    return "Selection policy: explicit runs";
  }
  return sample.selection.experimentIds === "all"
    ? "Selection policy: latest run for every determinable experiment"
    : "Selection policy: latest run for selected experiments";
}

function slotStateMeaning(state: SlotState): string {
  switch (state) {
    case "included":
      return "A published Member and its referenced Attempt are available.";
    case "not-recorded":
      return "The expected Slot has no published Member.";
    case "core-invalid":
      return "Record Core could not establish a reliable Member or Attempt.";
    case "excluded":
      return "Explicitly narrowed out of the sample denominator.";
  }
}

function slotIssueBlocks(slots: readonly AnalysisSlot[]): readonly ReportBlockV1[] {
  const problems = slots.filter((slot) => slot.state !== "included");
  if (problems.length === 0) {
    return [reportStatus({
      tone: "positive",
      label: "No slot problems in this sample",
    })];
  }

  const visible = problems.slice(0, SLOT_ISSUES_MAX);
  const blocks: ReportBlockV1[] = visible.map((slot) =>
    reportStatus({
      tone: slotTone(slot),
      label: `${slot.state}: ${slot.runId}/${slot.slotId}`,
      detail: [reportText(slotDetail(slot))],
    })
  );
  const omitted = problems.length - visible.length;
  if (omitted > 0) {
    blocks.push(reportStatus({
      tone: "warning",
      label: `${omitted} additional slot problem(s) omitted from this bounded list`,
    }));
  }
  return Object.freeze(blocks);
}

function slotTone(slot: Exclude<AnalysisSlot, { readonly state: "included" }>): "neutral" | "warning" | "negative" {
  switch (slot.state) {
    case "not-recorded":
      return "warning";
    case "core-invalid":
      return "negative";
    case "excluded":
      return "neutral";
  }
}

function slotDetail(slot: Exclude<AnalysisSlot, { readonly state: "included" }>): string {
  switch (slot.state) {
    case "not-recorded":
      return "No Member was published for this expected Slot.";
    case "core-invalid":
      return issueDetail(slot.issues);
    case "excluded":
      return slot.base.state === "core-invalid"
        ? `Excluded from the denominator; underlying state is core-invalid: ${issueDetail(slot.base.issues)}`
        : `Excluded from the denominator; underlying state is ${slot.base.state}.`;
  }
}

function issueDetail(issues: readonly { readonly code: string; readonly path: readonly string[] }[]): string {
  const visible = issues.slice(0, ISSUES_PER_SLOT_MAX).map((issue) => {
    const path = issue.path.length === 0 ? "Record Core" : issue.path.join("/");
    return `${issue.code} at ${path}`;
  });
  const omitted = issues.length - visible.length;
  return omitted === 0
    ? visible.join("; ")
    : `${visible.join("; ")}; ${omitted} additional issue(s)`;
}
