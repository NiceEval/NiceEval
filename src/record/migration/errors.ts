import { Schema } from "effect";
import type {
  RecordAttachmentName,
  RecordAttachmentSchemaId,
  RecordFormatId,
} from "../model/identifiers.ts";

export type RecordCoreMigrationRegistryIssueCode =
  | "record-core-migration-edge-invalid"
  | "record-core-migration-edge-duplicate"
  | "record-core-migration-edge-fork";

export interface RecordCoreMigrationRegistryIssue {
  readonly code: RecordCoreMigrationRegistryIssueCode;
  readonly path: readonly string[];
}

export interface RecordCoreMigrationRegistryInvalid {
  readonly code: "record-core-migration-registry-invalid";
  readonly issues: readonly [
    RecordCoreMigrationRegistryIssue,
    ...RecordCoreMigrationRegistryIssue[],
  ];
}

export type RecordCoreMigrationPlanIssue =
  | {
      readonly code: "record-core-migration-edge-missing";
      readonly from: RecordFormatId;
      readonly to: RecordFormatId;
    }
  | {
      readonly code: "record-core-migration-source-unsupported";
      readonly format: RecordFormatId;
    };

export interface RecordCoreMigrationPlanInvalid {
  readonly code: "record-core-migration-plan-invalid";
  readonly issues: readonly [
    RecordCoreMigrationPlanIssue,
    ...RecordCoreMigrationPlanIssue[],
  ];
}

export interface RecordCoreMigrationStepFailed {
  readonly code: "record-core-migration-step-failed";
  readonly from: RecordFormatId;
  readonly to: RecordFormatId;
}

/** A durable sentinel exists, so no Record operation may guess recovery. */
export class RecordMigrationInterruptedState extends Schema.TaggedError<RecordMigrationInterruptedState>(
  "@niceeval/record/RecordMigrationInterruptedState",
)("RecordMigrationInterruptedState", {
  code: Schema.Literal("record-migration-interrupted"),
}) {}

export interface RecordMigrationPlanStale {
  readonly code: "record-migration-plan-stale";
}

export interface RecordMigrationConfirmationRequired {
  readonly code: "record-migration-confirmation-required";
}

export interface RecordMigrationAuthorizationInvalid {
  readonly code: "record-migration-authorization-invalid";
}

export interface RecordAttachmentMigrationStepFailed {
  readonly code: "record-attachment-migration-step-failed";
  readonly owner: "run" | "attempt";
  readonly name: RecordAttachmentName;
  readonly schemaId: RecordAttachmentSchemaId;
}

export function recordCoreMigrationRegistryIssue(
  code: RecordCoreMigrationRegistryIssueCode,
  path: readonly string[],
): RecordCoreMigrationRegistryIssue {
  return Object.freeze({ code, path: Object.freeze([...path]) });
}

export function recordCoreMigrationRegistryInvalid(
  issues: readonly RecordCoreMigrationRegistryIssue[],
): RecordCoreMigrationRegistryInvalid {
  const [first, ...rest] = issues;
  if (first === undefined) {
    throw new Error("Record Core migration registry errors require at least one issue");
  }
  const nonEmpty: readonly [
    RecordCoreMigrationRegistryIssue,
    ...RecordCoreMigrationRegistryIssue[],
  ] = [first, ...rest];
  return Object.freeze({
    code: "record-core-migration-registry-invalid",
    issues: Object.freeze(nonEmpty),
  });
}

export function recordCoreMigrationPlanInvalid(
  issues: readonly RecordCoreMigrationPlanIssue[],
): RecordCoreMigrationPlanInvalid {
  const [first, ...rest] = issues;
  if (first === undefined) {
    throw new Error("Record Core migration plan errors require at least one issue");
  }
  const nonEmpty: readonly [
    RecordCoreMigrationPlanIssue,
    ...RecordCoreMigrationPlanIssue[],
  ] = [first, ...rest];
  return Object.freeze({
    code: "record-core-migration-plan-invalid",
    issues: Object.freeze(nonEmpty),
  });
}

export function recordCoreMigrationStepFailed(input: {
  readonly from: RecordFormatId;
  readonly to: RecordFormatId;
}): RecordCoreMigrationStepFailed {
  return Object.freeze({
    code: "record-core-migration-step-failed",
    from: input.from,
    to: input.to,
  });
}

export function recordMigrationPlanStale(): RecordMigrationPlanStale {
  return Object.freeze({ code: "record-migration-plan-stale" });
}

export function recordMigrationConfirmationRequired(): RecordMigrationConfirmationRequired {
  return Object.freeze({ code: "record-migration-confirmation-required" });
}

export function recordMigrationAuthorizationInvalid(): RecordMigrationAuthorizationInvalid {
  return Object.freeze({ code: "record-migration-authorization-invalid" });
}

export function recordAttachmentMigrationStepFailed(input: {
  readonly owner: "run" | "attempt";
  readonly name: RecordAttachmentName;
  readonly schemaId: RecordAttachmentSchemaId;
}): RecordAttachmentMigrationStepFailed {
  return Object.freeze({
    code: "record-attachment-migration-step-failed",
    owner: input.owner,
    name: input.name,
    schemaId: input.schemaId,
  });
}
