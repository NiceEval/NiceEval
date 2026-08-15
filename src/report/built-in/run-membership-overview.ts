import {
  attemptEvidenceView,
  query,
  type AttemptEvidenceDomainView,
  type Sample,
  type SampleSnapshot,
} from "../../analysis/index.ts";
import {
  Callout,
  defineReport,
  Stack,
  Stat,
  Table,
  Text,
  type Report,
} from "../author/index.ts";
import {
  loadBuiltInSummaryRows,
  type BuiltInSummaryRows,
} from "./analysis-values.ts";
import { captureLeaderboardShowResult } from "./attempt-evidence-json.ts";
import { registerBuiltInShowResult } from "../execution/results.ts";

const MEMBERSHIP_ROWS_MAX = 200;

const runMembershipPage = {
  id: "run-membership",
  path: "/",
  title: "Run membership overview",
  load: async (sample: Sample) => Object.freeze({
    snapshot: sample.snapshot,
    metrics: await loadBuiltInSummaryRows(sample),
    evidence: await query(sample, { kind: "domain-view", view: attemptEvidenceView }),
  }),
  render: (input: {
    readonly snapshot: SampleSnapshot;
    readonly metrics: BuiltInSummaryRows;
    readonly evidence: AttemptEvidenceDomainView;
  }) => runMembershipNode(input),
};

/**
 * The bounded default for explicit historical Runs. Core membership, closed
 * Assertion evidence, and MetricValues stay independent facts.
 */
export function runMembershipOverviewReport(): Report {
  return registerBuiltInShowResult(defineReport({
    title: "Run membership overview",
    pages: [runMembershipPage],
  }), Object.freeze({ produce: captureLeaderboardShowResult }));
}

/** The CLI default Report for one or more explicit `--run` selectors. */
export const defaultRunMembershipOverviewReport = runMembershipOverviewReport();

export default defaultRunMembershipOverviewReport;

function runMembershipNode(input: {
  readonly snapshot: SampleSnapshot;
  readonly metrics: BuiltInSummaryRows;
  readonly evidence: AttemptEvidenceDomainView;
}) {
  const evidenceByLocator = new Map(
    input.evidence.entries.map((entry) => [entry.attempt.locator, entry] as const),
  );
  const rows = input.snapshot.slots.slice(0, MEMBERSHIP_ROWS_MAX).map((slot) => {
    const evidence = slot.state === "included"
      ? evidenceByLocator.get(slot.attempt.locator)
      : undefined;
    return Object.freeze({
      runId: slot.runId,
      slotId: slot.slotId,
      slotState: slot.state,
      memberAction: slot.state === "excluded" ? slot.base.action : slot.action,
      memberRelation: slot.state === "included" ? slot.relation : null,
      sourceAttemptLocator: slot.state === "included"
        ? slot.attempt.locator
        : null,
      evidenceState: evidence?.state ?? "not-recorded",
    });
  });
  const omitted = input.snapshot.slots.length - rows.length;
  const metrics = input.metrics[0];

  return Stack({
    children: [
      ...(metrics === undefined
        ? []
        : [Stat({ label: "Pass rate", value: metrics.passRate })]),
      Table({
        caption: "Run membership",
        columns: [
          { key: "runId", label: "Run" },
          { key: "slotId", label: "Slot" },
          { key: "slotState", label: "Slot state" },
          { key: "memberAction", label: "Member action" },
          { key: "memberRelation", label: "Member relation" },
          { key: "sourceAttemptLocator", label: "Source Attempt" },
          { key: "evidenceState", label: "Assertion evidence" },
        ],
        rows,
      }),
      Callout({
        tone: omitted === 0 ? "neutral" : "warning",
        title: "Bounded summary",
        children: [Text({ value: `Omitted rows: ${omitted}` })],
      }),
    ],
  });
}
