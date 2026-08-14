import type { AnalysisSample, RunId, SlotId } from "../../analysis/index.ts";
import type { EvaluationPlanView } from "../../eval/record/evaluation-plan.ts";
import type { EvaluationKind } from "../../eval/record/evaluation.ts";
import type { ProjectedRecordAttachmentResult } from "../../projection/attachment-result.ts";
import type { ProjectedSample, ProjectionAccess } from "../../projection/model.ts";
import type { ReportDataPlan } from "../author/model.ts";
import { slotKey } from "./sample.ts";

export interface ClassicSlotIdentity {
  readonly experimentId: string;
  readonly evalId: string;
  readonly attempt: number;
  readonly kind: EvaluationKind;
}

export type ClassicIdentityMap = ReadonlyMap<string, ClassicSlotIdentity>;

export interface ClassicIdentityGap {
  readonly code: "unavailable" | "invalid";
  readonly runId: RunId;
  readonly slotId: SlotId;
}

export type ClassicIdentityPreparation =
  | { readonly state: "complete"; readonly identities: ClassicIdentityMap }
  | { readonly state: "incomplete"; readonly gaps: readonly [ClassicIdentityGap, ...ClassicIdentityGap[]] }
  | { readonly state: "defect" };

const identityKeysByPlan = new WeakMap<ReportDataPlan, ReadonlySet<string>>();
const preparationByProjected = new WeakMap<
  ProjectedSample<ProjectionAccess, unknown>,
  ClassicIdentityPreparation
>();

/** Package-private. Marks one data-plan input as classic identity. */
export function markClassicIdentityInput(plan: ReportDataPlan, key: string): void {
  const next = new Set(identityKeysByPlan.get(plan));
  next.add(key);
  identityKeysByPlan.set(plan, next);
}

/** Package-private. Input keys that use the classic identity gate. */
export function classicIdentityInputKeys(plan: ReportDataPlan): ReadonlySet<string> {
  return identityKeysByPlan.get(plan) ?? new Set();
}

/**
 * Package-private. Exhaustively prevalidates identity for every selected,
 * non-excluded slot and caches one preparation on the projected plan.
 */
export function prepareClassicIdentities(
  sample: AnalysisSample,
  projected: ProjectedSample<ProjectionAccess, unknown>,
): ClassicIdentityPreparation {
  const cached = preparationByProjected.get(projected);
  if (cached !== undefined) {
    return cached;
  }
  const prepared = computeClassicIdentities(sample, projected);
  preparationByProjected.set(projected, prepared);
  return prepared;
}

/** Package-private. Returns the unique complete map, or undefined. */
export function classicIdentityMap(
  projected: ProjectedSample<ProjectionAccess, unknown> | undefined,
): ClassicIdentityMap | undefined {
  if (projected === undefined) {
    return undefined;
  }
  const prepared = preparationByProjected.get(projected);
  return prepared?.state === "complete" ? prepared.identities : undefined;
}

function computeClassicIdentities(
  sample: AnalysisSample,
  projected: ProjectedSample<ProjectionAccess, unknown>,
): ClassicIdentityPreparation {
  if (!isSelectedRunSample(projected)) {
    return Object.freeze({ state: "defect" as const });
  }
  const plans = new Map<string, ProjectedRecordAttachmentResult<unknown>>();
  for (const entry of projected.entries) {
    plans.set(entry.run.runId, entry.attachment);
  }
  const identities = new Map<string, ClassicSlotIdentity>();
  const gaps: ClassicIdentityGap[] = [];

  for (const slot of sample.slots) {
    if (slot.state === "excluded") {
      continue;
    }
    if (!sample.runs.some((run) => run.runId === slot.runId)) {
      return Object.freeze({ state: "defect" as const });
    }
    const resolved = resolveSlotIdentity(plans.get(slot.runId), slot.runId, slot.slotId);
    if (resolved === "defect") {
      return Object.freeze({ state: "defect" as const });
    }
    if (resolved.kind === "gap") {
      gaps.push(resolved.gap);
      continue;
    }
    identities.set(slotKey(slot.runId, slot.slotId), resolved.identity);
  }

  if (gaps.length > 0) {
    return Object.freeze({
      state: "incomplete" as const,
      gaps: Object.freeze(gaps) as readonly [ClassicIdentityGap, ...ClassicIdentityGap[]],
    });
  }
  return Object.freeze({
    state: "complete" as const,
    identities,
  });
}

function resolveSlotIdentity(
  attachment: ProjectedRecordAttachmentResult<unknown> | undefined,
  runId: RunId,
  slotId: SlotId,
):
  | { readonly kind: "identity"; readonly identity: ClassicSlotIdentity }
  | { readonly kind: "gap"; readonly gap: ClassicIdentityGap }
  | "defect" {
  if (attachment === undefined) {
    return Object.freeze({
      kind: "gap" as const,
      gap: Object.freeze({ code: "unavailable" as const, runId, slotId }),
    });
  }
  switch (attachment.state) {
    case "unavailable":
    case "migration-required":
    case "migration-unavailable":
    case "unsupported":
      return Object.freeze({
        kind: "gap" as const,
        gap: Object.freeze({ code: "unavailable" as const, runId, slotId }),
      });
    case "invalid":
      return Object.freeze({
        kind: "gap" as const,
        gap: Object.freeze({ code: "invalid" as const, runId, slotId }),
      });
    case "available": {
      if (!isEvaluationPlanView(attachment.value)) {
        return Object.freeze({
          kind: "gap" as const,
          gap: Object.freeze({ code: "invalid" as const, runId, slotId }),
        });
      }
      let coordinate: ReturnType<EvaluationPlanView["coordinateForSlot"]>;
      try {
        coordinate = attachment.value.coordinateForSlot(slotId);
      } catch {
        return "defect";
      }
      if (coordinate === undefined) {
        return Object.freeze({
          kind: "gap" as const,
          gap: Object.freeze({ code: "invalid" as const, runId, slotId }),
        });
      }
      return Object.freeze({
        kind: "identity" as const,
        identity: Object.freeze({
          experimentId: coordinate.experimentId,
          evalId: coordinate.evalId,
          attempt: coordinate.attempt,
          kind: coordinate.kind,
        }),
      });
    }
  }
}

function isSelectedRunSample(
  value: ProjectedSample<ProjectionAccess, unknown>,
): value is ProjectedSample<"selected-run", unknown> {
  return value.access === "selected-run";
}

function isEvaluationPlanView(value: unknown): value is EvaluationPlanView {
  return (
    typeof value === "object"
    && value !== null
    && "coordinateForSlot" in value
    && typeof value.coordinateForSlot === "function"
  );
}
