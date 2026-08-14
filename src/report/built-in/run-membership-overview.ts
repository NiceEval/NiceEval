import { Either } from "effect";
import type { AnalysisSlot } from "../../analysis/index.ts";
import {
  attemptSlotProjection,
  membershipProvenanceProjector,
  selectedRunProjection,
  verdictProjector,
  type MembershipAction,
  type MembershipProvenance,
  type ProjectedRecordAttachmentResult,
  type ProjectedSample,
  type Verdict,
} from "../../projection/index.ts";
import { encodeAttemptLocator } from "../../attempt-locator.ts";
import { compareCanonicalIdentity } from "../../record/model/identifiers.ts";
import {
  definePage,
  defineReport,
  reportComponentId,
  reportId,
  reportInputs,
  reportRoute,
  type Report,
} from "../author/index.ts";
import {
  reportDocument,
  reportSection,
  reportStatus,
  reportTable,
  reportText,
  type ReportBlock,
  type ReportScalar,
} from "../semantic/index.ts";

const MEMBERSHIP_ROWS_MAX = 200;
const PROBLEM_DETAILS_MAX = 200;

const runMembershipInputs = reportInputs({
  membership: selectedRunProjection(membershipProvenanceProjector),
  verdict: attemptSlotProjection(verdictProjector),
});

type MembershipEntry = ProjectedSample<
  "selected-run",
  MembershipProvenance
>["entries"][number];
type VerdictEntry = ProjectedSample<
  "attempt-slot",
  Verdict
>["entries"][number];

interface RunMembershipInputs {
  readonly membership: ProjectedSample<"selected-run", MembershipProvenance>;
  readonly verdict: ProjectedSample<"attempt-slot", Verdict>;
}

interface RunMembershipRow extends Readonly<Record<string, ReportScalar>> {
  readonly runId: string;
  readonly slotId: string;
  readonly slotState: AnalysisSlot["state"];
  readonly memberRelation: "origin" | "reference" | null;
  readonly sourceAttemptLocator: string | null;
  readonly membershipState:
    | ProjectedRecordAttachmentResult<MembershipProvenance>["state"]
    | "action-missing";
  readonly membershipOutcome: MembershipAction["outcome"] | null;
  readonly verdictState:
    | ProjectedRecordAttachmentResult<Verdict>["state"]
    | "not-read";
  readonly verdict: Verdict | null;
}

/** The bounded built-in summary for one or more explicit historical Runs. */
export function runMembershipOverviewReport(): Report {
  const page = definePage({
    id: Either.getOrThrow(reportComponentId("run-membership")),
    route: Either.getOrThrow(reportRoute("/")),
    inputs: runMembershipInputs,
    completeness: "allow-partial",
    render: ({ sample, inputs }) => runMembershipOverviewDocument(sample.slots, inputs),
  });
  return defineReport({
    id: Either.getOrThrow(reportId("run-membership-overview")),
    pages: [page],
  });
}

/** The CLI default Report for an explicit `--run` selection. */
export const defaultRunMembershipOverviewReport = runMembershipOverviewReport();

export default defaultRunMembershipOverviewReport;

function runMembershipOverviewDocument(
  slots: readonly AnalysisSlot[],
  inputs: RunMembershipInputs,
) {
  const rows = assembleRows(slots, inputs);
  const visibleRows = rows.slice(0, MEMBERSHIP_ROWS_MAX);
  const omittedRows = rows.length - visibleRows.length;
  const problemBlocks = attachmentProblemBlocks(inputs);

  return reportDocument({
    title: "Run membership overview",
    children: [
      reportTable({
        caption: "Run membership",
        columns: [
          { key: "runId", label: "Run" },
          { key: "slotId", label: "Slot" },
          { key: "slotState", label: "Slot state" },
          { key: "memberRelation", label: "Member relation" },
          { key: "sourceAttemptLocator", label: "Source Attempt" },
          { key: "membershipState", label: "Membership state" },
          { key: "membershipOutcome", label: "Membership outcome" },
          { key: "verdictState", label: "Verdict state" },
          { key: "verdict", label: "Verdict" },
        ],
        rows: visibleRows,
      }),
      reportStatus({
        tone: omittedRows === 0 ? "neutral" : "warning",
        label: `Omitted rows: ${omittedRows}`,
      }),
      reportStatus({
        tone: "neutral",
        label: `Unmatched membership actions: ${countUnmatchedMembershipActions(slots, inputs.membership)}`,
      }),
      ...(problemBlocks.length === 0
        ? []
        : [reportSection({ heading: "Attachment details", children: problemBlocks })]),
    ],
  });
}

function assembleRows(
  slots: readonly AnalysisSlot[],
  inputs: RunMembershipInputs,
): readonly RunMembershipRow[] {
  const membershipByRun = new Map<string, MembershipEntry>();
  for (const entry of inputs.membership.entries) {
    membershipByRun.set(entry.run.runId, entry);
  }
  const verdictBySlot = new Map<string, VerdictEntry>();
  for (const entry of inputs.verdict.entries) {
    verdictBySlot.set(slotKey(entry.slot), entry);
  }

  return Object.freeze(
    [...slots]
      .sort(compareSlots)
      .map((slot) => rowForSlot(
        slot,
        membershipByRun.get(slot.runId),
        verdictBySlot.get(slotKey(slot)),
      )),
  );
}

function rowForSlot(
  slot: AnalysisSlot,
  membership: MembershipEntry | undefined,
  verdict: VerdictEntry | undefined,
): RunMembershipRow {
  const action = membershipAction(membership, slot.slotId);
  const membershipState = membership === undefined
    ? "unavailable"
    : membership.attachment.state === "available"
      ? action === undefined ? "action-missing" : "available"
      : membership.attachment.state;
  const verdictValue = verdictForSlot(slot, verdict);

  return Object.freeze({
    runId: slot.runId,
    slotId: slot.slotId,
    slotState: slot.state,
    memberRelation: slot.state === "included" ? slot.relation : null,
    sourceAttemptLocator: slot.state === "included" ? encodeAttemptLocator(slot.attempt.attemptId) : null,
    membershipState,
    membershipOutcome: action?.outcome ?? null,
    verdictState: verdictValue.state,
    verdict: verdictValue.value,
  });
}

function membershipAction(
  membership: MembershipEntry | undefined,
  slotId: string,
): MembershipAction | undefined {
  if (membership?.attachment.state !== "available") return undefined;
  return membership.attachment.value.actions.find((action) => action.slotId === slotId);
}

function verdictForSlot(
  slot: AnalysisSlot,
  entry: VerdictEntry | undefined,
): {
  readonly state: RunMembershipRow["verdictState"];
  readonly value: Verdict | null;
} {
  if (slot.state !== "included" || entry?.state !== "attachment-result") {
    return Object.freeze({ state: "not-read", value: null });
  }
  return entry.attachment.state === "available"
    ? Object.freeze({ state: "available", value: entry.attachment.value })
    : Object.freeze({ state: entry.attachment.state, value: null });
}

function countUnmatchedMembershipActions(
  slots: readonly AnalysisSlot[],
  membership: ProjectedSample<"selected-run", MembershipProvenance>,
): number {
  const selectedSlotsByRun = new Map<string, Set<string>>();
  for (const slot of slots) {
    const selected = selectedSlotsByRun.get(slot.runId) ?? new Set<string>();
    selected.add(slot.slotId);
    selectedSlotsByRun.set(slot.runId, selected);
  }

  let unmatched = 0;
  for (const entry of membership.entries) {
    if (entry.attachment.state !== "available") continue;
    const selected = selectedSlotsByRun.get(entry.run.runId) ?? new Set<string>();
    unmatched += entry.attachment.value.actions.filter((action) => !selected.has(action.slotId)).length;
  }
  return unmatched;
}

function attachmentProblemBlocks(inputs: RunMembershipInputs): readonly ReportBlock[] {
  const blocks: ReportBlock[] = [];
  for (const entry of inputs.membership.entries) {
    if (entry.attachment.state !== "available") {
      blocks.push(attachmentProblemBlock(`Membership for Run ${entry.run.runId}`, entry.attachment));
    }
  }
  for (const entry of inputs.verdict.entries) {
    if (entry.state === "attachment-result" && entry.attachment.state !== "available") {
      blocks.push(attachmentProblemBlock(
        `Verdict for ${entry.slot.runId}/${entry.slot.slotId}`,
        entry.attachment,
      ));
    }
  }

  const visible = blocks.slice(0, PROBLEM_DETAILS_MAX);
  const omitted = blocks.length - visible.length;
  return Object.freeze([
    ...visible,
    ...(omitted === 0
      ? []
      : [reportStatus({
        tone: "warning",
        label: `${omitted} additional Attachment detail(s) omitted`,
      })]),
  ]);
}

function attachmentProblemBlock<Value>(
  name: string,
  attachment: Exclude<ProjectedRecordAttachmentResult<Value>, { readonly state: "available" }>,
): ReportBlock {
  switch (attachment.state) {
    case "unavailable":
      return reportStatus({ tone: "warning", label: `${name}: unavailable` });
    case "migration-required":
      return reportStatus({
        tone: "warning",
        label: `${name}: migration-required`,
        detail: [reportText(`${attachment.from} → ${attachment.to}; ${attachment.command}`)],
      });
    case "migration-unavailable":
      return reportStatus({
        tone: "warning",
        label: `${name}: migration-unavailable`,
        detail: [reportText(`${attachment.from} → ${attachment.to}; ${attachment.reason}`)],
      });
    case "unsupported":
      return reportStatus({
        tone: "warning",
        label: `${name}: unsupported`,
        detail: [reportText(attachment.schemaId)],
      });
    case "invalid":
      return reportStatus({
        tone: "negative",
        label: `${name}: invalid`,
        detail: [reportText(attachment.issues.map((issue) =>
          `${issue.code} at ${issue.path.length === 0 ? "Attachment" : issue.path.join("/")}`
        ).join("; "))],
      });
  }
}

function compareSlots(left: AnalysisSlot, right: AnalysisSlot): number {
  const run = compareCanonicalIdentity(left.runId, right.runId);
  return run === 0 ? compareCanonicalIdentity(left.slotId, right.slotId) : run;
}

function slotKey(slot: Pick<AnalysisSlot, "runId" | "slotId">): string {
  return `${slot.runId}\u0000${slot.slotId}`;
}
