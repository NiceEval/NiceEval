import type { FrozenCurrentTarget } from "../experiment/host/current.ts";
import type { CurrentSlotAssessment, CurrentTargetSlot, CurrentAssessmentSource } from "../runner/reuse-plan.ts";
import type { LoadedInspectionRun } from "./facts.ts";
import type { InspectionFactSource } from "./source.ts";
import type { ReadableRunResource } from "../run/storage/types.ts";

export interface CurrentResultSource extends CurrentAssessmentSource {
  readonly sourceRunId: string;
  readonly locator: string;
  readonly relation: "origin" | "reference";
  readonly action: "executed" | "carried" | "accepted";
}

export interface FrozenProjectInput {
  readonly cutoffIdentity: string;
  readonly target: FrozenCurrentTarget;
  readonly assessments: readonly CurrentSlotAssessment<CurrentTargetSlot, CurrentResultSource>[];
  readonly runs: readonly LoadedInspectionRun[];
  readonly resources: readonly ReadableRunResource[];
}

// Only the Host preparation edge can bind one frozen assessment to its reader.
const preparedInputs = new WeakMap<InspectionFactSource, FrozenProjectInput>();
export function bindProjectInput(source: InspectionFactSource, input: FrozenProjectInput): void { preparedInputs.set(source, Object.freeze(input)); }
export function projectInput(source: InspectionFactSource): FrozenProjectInput | undefined { return preparedInputs.get(source); }
