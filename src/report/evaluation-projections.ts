import type { ProjectedRecordAttachmentResult } from "../projection/attachment-result.ts";
import type { ProjectedEntry } from "../projection/model.ts";
import {
  attemptSlotProjection,
  selectedRunProjection,
  withProjectionRequirements,
  type ProjectionRequirement,
} from "../projection/projector.ts";
import {
  evaluationPlanProjector,
  type EvaluationPlanView,
} from "../eval/record/evaluation-plan.ts";
import { scoreProjector, type Score } from "../eval/record/score.ts";

export const reportEvaluationPlanProjection = selectedRunProjection(
  evaluationPlanProjector,
);

export const reportScoreProjection = withProjectionRequirements({
  projection: attemptSlotProjection(scoreProjector),
  dependency: reportEvaluationPlanProjection,
  resolve: resolveScoreRequirements,
});

type EvaluationPlanEntry = ProjectedEntry<"selected-run", EvaluationPlanView>;
type ScoreEntry = ProjectedEntry<"attempt-slot", Score>;
type PlanRequirement =
  | { readonly state: "available"; readonly value: EvaluationPlanView }
  | Extract<ProjectionRequirement, { readonly state: "unresolved" }>;

function resolveScoreRequirements(input: {
  readonly entries: readonly ScoreEntry[];
  readonly dependency: {
    readonly entries: readonly EvaluationPlanEntry[];
  };
}): readonly ProjectionRequirement[] {
  const plansByRun = new Map<string, PlanRequirement>();
  for (const entry of input.dependency.entries) {
    plansByRun.set(entry.run.runId, planRequirement(entry.attachment));
  }

  return input.entries.map((entry): ProjectionRequirement => {
    if (entry.state === "excluded") return { state: "required" };
    const plan = plansByRun.get(entry.slot.runId);
    if (plan === undefined) {
      return { state: "unresolved", code: "unavailable" };
    }
    if (plan.state === "unresolved") return plan;
    const coordinate = plan.value.coordinateForSlot(entry.slot.slotId);
    if (coordinate === undefined) {
      return { state: "unresolved", code: "unavailable" };
    }
    return coordinate.kind === "pass"
      ? { state: "not-applicable" }
      : { state: "required" };
  });
}

function planRequirement(
  attachment: ProjectedRecordAttachmentResult<EvaluationPlanView>,
): PlanRequirement {
  switch (attachment.state) {
    case "available":
      return { state: "available", value: attachment.value };
    case "unavailable":
    case "migration-required":
    case "migration-unavailable":
    case "unsupported":
    case "invalid":
      return { state: "unresolved", code: attachment.state };
  }
}
