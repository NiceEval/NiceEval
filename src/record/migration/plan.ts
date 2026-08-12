import { Either } from "effect";
import type { RecordFormatId } from "../model/identifiers.ts";
import {
  recordCoreMigrationPlanInvalid,
  type RecordCoreMigrationPlanInvalid,
  type RecordCoreMigrationPlanIssue,
} from "./errors.ts";
import {
  type RecordCoreMigrationRegistry,
  type RecordCoreMigrationResolution,
} from "./registry.ts";

export interface RecordCoreMigrationPlanStep {
  readonly from: RecordFormatId;
  readonly to: RecordFormatId;
}

export interface RecordCoreMigrationPlanSummary {
  readonly sourceFormat: RecordFormatId;
  readonly targetFormat: RecordFormatId;
  readonly steps: readonly RecordCoreMigrationPlanStep[];
  readonly state: "needed" | "not-needed";
}

/** Runtime execution state never becomes part of a plan's public summary. */
const corePlanResolutions = new WeakMap<object, unknown>();

/**
 * Package-created, pure Core plan. The source snapshot stays opaque to callers
 * so a later execution boundary cannot substitute a different value or path.
 */
export class RecordCoreMigrationPlan<CoreValue> {
  private constructor(
    readonly summary: RecordCoreMigrationPlanSummary,
  ) {
    Object.freeze(this);
  }

  static make<CoreValue>(input: {
    readonly registry: RecordCoreMigrationRegistry<CoreValue>;
    readonly sourceFormat: RecordFormatId;
  }): Either.Either<RecordCoreMigrationPlan<CoreValue>, RecordCoreMigrationPlanInvalid> {
    const resolution = input.registry.resolve(input.sourceFormat);
    const issues: RecordCoreMigrationPlanIssue[] = [];
    if (resolution.state === "migration-edge-missing") {
      issues.push({
        code: "record-core-migration-edge-missing",
        from: resolution.from,
        to: resolution.to,
      });
    } else if (resolution.state === "unsupported") {
      issues.push({
        code: "record-core-migration-source-unsupported",
        format: input.sourceFormat,
      });
    }
    if (issues.length > 0) {
      return Either.left(recordCoreMigrationPlanInvalid(issues));
    }

    const edges =
      resolution.state === "migration-required" ? resolution.edges : Object.freeze([]);
    const steps = Object.freeze(
      edges.map((edge) => Object.freeze({ from: edge.from, to: edge.to })),
    );
    const plan = new RecordCoreMigrationPlan<CoreValue>(
      Object.freeze({
        sourceFormat: input.sourceFormat,
        targetFormat: input.registry.currentFormat,
        steps,
        state: steps.length === 0 ? "not-needed" : "needed",
      }),
    );
    corePlanResolutions.set(plan, resolution);
    return Either.right(plan);
  }
}

export function makeRecordCoreMigrationPlan<CoreValue>(input: {
  readonly registry: RecordCoreMigrationRegistry<CoreValue>;
  readonly sourceFormat: RecordFormatId;
}): Either.Either<RecordCoreMigrationPlan<CoreValue>, RecordCoreMigrationPlanInvalid> {
  return RecordCoreMigrationPlan.make(input);
}

/** @internal Only migration orchestration may recover converter capabilities. */
export function recordCoreMigrationPlanResolution<CoreValue>(
  plan: RecordCoreMigrationPlan<CoreValue>,
): RecordCoreMigrationResolution<CoreValue> {
  const resolution = corePlanResolutions.get(plan);
  if (resolution === undefined) {
    throw new Error("Record Core migration plan is not package-created");
  }
  return resolution as RecordCoreMigrationResolution<CoreValue>;
}
