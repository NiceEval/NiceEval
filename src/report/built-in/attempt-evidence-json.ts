import { encodeAttemptLocator } from "../../attempt-locator.ts";
import type {
  AnalysisSample,
  IncludedAnalysisSlot,
} from "../../analysis/index.ts";
import {
  assertionsProjector,
  attemptSlotProjection,
  verdictProjector,
  type AssertionsSourceProjection,
  type EvaluationPlanCoordinate,
  type EvaluationPlanView,
  type ProjectedRecordAttachmentResult,
  type ProjectedSample,
  type Score,
  type Verdict,
} from "../../projection/index.ts";
import {
  attemptCommandsProjector,
  attemptConversationProjector,
  attemptDiagnosticsProjector,
  attemptTimingProjector,
  attemptUsageProjector,
  type AttemptDiagnosticsView,
  type AttemptTimingView,
  type CommandsView,
  type ConversationView,
  type UsageView,
} from "../../o11y/record/family-projectors.ts";
import {
  reportInputs,
  type ReportProjectedValues,
} from "../author/index.ts";
import {
  reportEvaluationPlanProjection,
  reportScoreProjection,
} from "../evaluation-projections.ts";

const assertionsProjection = attemptSlotProjection(assertionsProjector);
const verdictProjection = attemptSlotProjection(verdictProjector);
const conversationProjection = attemptSlotProjection(attemptConversationProjector);
const commandsProjection = attemptSlotProjection(attemptCommandsProjector);
const usageProjection = attemptSlotProjection(attemptUsageProjector);
const timingProjection = attemptSlotProjection(attemptTimingProjector);
const diagnosticsProjection = attemptSlotProjection(attemptDiagnosticsProjector);

/** The human Attempt page reads only this subset. */
export const attemptOverviewEvidenceInputs = reportInputs({
  "evaluation-plan": reportEvaluationPlanProjection,
  assertions: assertionsProjection,
  verdict: verdictProjection,
  score: reportScoreProjection,
  diagnostics: diagnosticsProjection,
});

/** Exact Attempt JSON is the complete semantic evidence projection. */
export const attemptShowJsonInputs = reportInputs({
  "evaluation-plan": reportEvaluationPlanProjection,
  assertions: assertionsProjection,
  verdict: verdictProjection,
  score: reportScoreProjection,
  conversation: conversationProjection,
  commands: commandsProjection,
  usage: usageProjection,
  timing: timingProjection,
  diagnostics: diagnosticsProjection,
});

/** Execution text does not need the Evaluation Plan. */
export const executionEvidenceInputs = reportInputs({
  conversation: conversationProjection,
  commands: commandsProjection,
  usage: usageProjection,
  timing: timingProjection,
  diagnostics: diagnosticsProjection,
});

/** Execution JSON adds the semantic Evaluation identity to the same evidence. */
export const executionShowJsonInputs = reportInputs({
  "evaluation-plan": reportEvaluationPlanProjection,
  conversation: conversationProjection,
  commands: commandsProjection,
  usage: usageProjection,
  timing: timingProjection,
  diagnostics: diagnosticsProjection,
});

export type PublicEvidence<Value> =
  | { readonly state: "available"; readonly value: Value }
  | { readonly state: "unavailable" }
  | { readonly state: "migration-required" }
  | { readonly state: "migration-unavailable" }
  | { readonly state: "unsupported" }
  | { readonly state: "invalid" }
  | { readonly state: "not-applicable" };

export interface PublicAttemptIdentity {
  readonly locator: string;
  readonly selectedRunId: string;
  readonly originRunId: string;
  readonly slotId: string;
  readonly memberRelation: "origin" | "reference";
}

export interface PublicAttemptEvidenceJson {
  readonly kind: "attempt";
  readonly identity: PublicAttemptIdentity;
  readonly evaluation: PublicEvidence<EvaluationPlanCoordinate>;
  readonly assertions: PublicEvidence<AssertionsSourceProjection>;
  readonly verdict: PublicEvidence<Verdict>;
  readonly score: PublicEvidence<Score>;
  readonly conversation: PublicEvidence<ConversationView>;
  readonly commands: PublicEvidence<CommandsView>;
  readonly usage: PublicEvidence<UsageView>;
  readonly timing: PublicEvidence<AttemptTimingView>;
  readonly diagnostics: PublicEvidence<AttemptDiagnosticsView>;
}

export interface PublicExecutionEvidenceJson {
  readonly kind: "attempt-execution";
  readonly identity: PublicAttemptIdentity;
  readonly evaluation: PublicEvidence<EvaluationPlanCoordinate>;
  readonly conversation: PublicEvidence<ConversationView>;
  readonly commands: PublicEvidence<CommandsView>;
  readonly usage: PublicEvidence<UsageView>;
  readonly timing: PublicEvidence<AttemptTimingView>;
  readonly diagnostics: PublicEvidence<AttemptDiagnosticsView>;
}

export function publicAttemptEvidenceJson(
  sample: AnalysisSample,
  inputs: ReportProjectedValues<typeof attemptShowJsonInputs>,
): PublicAttemptEvidenceJson {
  const slot = onlyIncludedAttempt(sample);
  const evaluation = publicEvaluation(inputs["evaluation-plan"], slot);
  return Object.freeze({
    kind: "attempt" as const,
    identity: publicIdentity(slot),
    evaluation,
    assertions: publicAttachment(attemptAttachment(inputs.assertions, slot)),
    verdict: publicAttachment(attemptAttachment(inputs.verdict, slot)),
    score: evaluation.state === "available" && evaluation.value.kind === "pass"
      ? Object.freeze({ state: "not-applicable" as const })
      : publicAttachment(attemptAttachment(inputs.score, slot)),
    conversation: publicAttachment(attemptAttachment(inputs.conversation, slot)),
    commands: publicAttachment(attemptAttachment(inputs.commands, slot)),
    usage: publicAttachment(attemptAttachment(inputs.usage, slot)),
    timing: publicAttachment(attemptAttachment(inputs.timing, slot)),
    diagnostics: publicAttachment(attemptAttachment(inputs.diagnostics, slot)),
  });
}

export function publicExecutionEvidenceJson(
  sample: AnalysisSample,
  inputs: ReportProjectedValues<typeof executionShowJsonInputs>,
): PublicExecutionEvidenceJson {
  const slot = onlyIncludedAttempt(sample);
  return Object.freeze({
    kind: "attempt-execution" as const,
    identity: publicIdentity(slot),
    evaluation: publicEvaluation(inputs["evaluation-plan"], slot),
    conversation: publicAttachment(attemptAttachment(inputs.conversation, slot)),
    commands: publicAttachment(attemptAttachment(inputs.commands, slot)),
    usage: publicAttachment(attemptAttachment(inputs.usage, slot)),
    timing: publicAttachment(attemptAttachment(inputs.timing, slot)),
    diagnostics: publicAttachment(attemptAttachment(inputs.diagnostics, slot)),
  });
}

function onlyIncludedAttempt(sample: AnalysisSample): IncludedAnalysisSlot {
  const included = sample.slots.filter(
    (slot): slot is IncludedAnalysisSlot => slot.state === "included",
  );
  if (included.length !== 1) {
    throw new Error(
      `Attempt evidence requires exactly one included Slot; got ${included.length}`,
    );
  }
  return included[0]!;
}

function publicIdentity(slot: IncludedAnalysisSlot): PublicAttemptIdentity {
  return Object.freeze({
    locator: encodeAttemptLocator(slot.attempt.attemptId),
    selectedRunId: slot.runId,
    originRunId: slot.attempt.originRunId,
    slotId: slot.slotId,
    memberRelation: slot.relation,
  });
}

function publicEvaluation(
  projected: ProjectedSample<"selected-run", EvaluationPlanView>,
  slot: IncludedAnalysisSlot,
): PublicEvidence<EvaluationPlanCoordinate> {
  const entries = projected.entries.filter((entry) => entry.run.runId === slot.runId);
  if (entries.length !== 1) {
    throw new Error(
      `Attempt evidence lost its selected Run Evaluation Plan; got ${entries.length} matches`,
    );
  }
  const attachment = entries[0]!.attachment;
  if (attachment.state !== "available") return publicAttachment(attachment);
  const coordinate = attachment.value.coordinateForSlot(slot.slotId);
  if (coordinate === undefined) {
    throw new Error("Attempt evidence Evaluation Plan does not contain the included Slot");
  }
  return Object.freeze({ state: "available" as const, value: coordinate });
}

function attemptAttachment<Value>(
  projected: ProjectedSample<"attempt-slot", Value>,
  slot: IncludedAnalysisSlot,
): ProjectedRecordAttachmentResult<Value> {
  const matches = projected.entries.filter(
    (entry) =>
      entry.state === "attachment-result"
      && entry.slot.runId === slot.runId
      && entry.slot.slotId === slot.slotId,
  );
  if (matches.length !== 1 || matches[0]!.state !== "attachment-result") {
    throw new Error(
      `Attempt evidence projection lost its included Slot; got ${matches.length} matches`,
    );
  }
  return matches[0]!.attachment;
}

function publicAttachment<Value>(
  attachment: ProjectedRecordAttachmentResult<Value>,
): PublicEvidence<Value> {
  return attachment.state === "available"
    ? Object.freeze({ state: "available" as const, value: attachment.value })
    : Object.freeze({ state: attachment.state });
}
