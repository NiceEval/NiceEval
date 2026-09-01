import { Result, Schema } from "effect";

import {
  makeRecordAttachmentCatalog,
  type RecordAttachmentCatalog,
} from "../attachment/index.ts";
import { agentTurnsRecordAttachmentPersistence } from "./agent-turns/persistence.ts";
import { attemptCostRecordAttachmentPersistence } from "./attempt-cost/persistence.ts";
import {
  attemptArtifactsRecordAttachmentPersistence,
  runArtifactsRecordAttachmentPersistence,
} from "./artifacts/persistence.ts";
import { assertionsRecordAttachmentPersistence } from "./assertions/persistence.ts";
import { fileChangesRecordAttachmentPersistence } from "./file-changes/persistence.ts";
import {
  attemptRunnerActivitiesRecordAttachmentPersistence,
  runRunnerActivitiesRecordAttachmentPersistence,
} from "./runner-activities/persistence.ts";
import {
  attemptRunnerDiagnosticsRecordAttachmentPersistence,
  runRunnerDiagnosticsRecordAttachmentPersistence,
} from "./runner-diagnostics/persistence.ts";
import { sandboxCommandsRecordAttachmentPersistence } from "./sandbox-commands/persistence.ts";
import { sourcesRecordAttachmentPersistence } from "./sources/persistence.ts";
import { turnContextsRecordAttachmentPersistence } from "./turn-contexts/persistence.ts";
import { NiceEvalRecordAttachments } from "./current.ts";

export { NiceEvalCurrentRecordAttachments, NiceEvalRecordAttachments } from "./current.ts";

/** Explicit durable Host composition; importing a family never registers it. */
export const NiceEvalRecordAttachmentPersistences = Object.freeze([
  assertionsRecordAttachmentPersistence,
  attemptCostRecordAttachmentPersistence,
  agentTurnsRecordAttachmentPersistence,
  turnContextsRecordAttachmentPersistence,
  sandboxCommandsRecordAttachmentPersistence,
  attemptRunnerActivitiesRecordAttachmentPersistence,
  runRunnerActivitiesRecordAttachmentPersistence,
  attemptRunnerDiagnosticsRecordAttachmentPersistence,
  runRunnerDiagnosticsRecordAttachmentPersistence,
  fileChangesRecordAttachmentPersistence,
  sourcesRecordAttachmentPersistence,
  attemptArtifactsRecordAttachmentPersistence,
  runArtifactsRecordAttachmentPersistence,
] as const);

function requireCatalog(
  result: Result.Result<RecordAttachmentCatalog, unknown>,
): RecordAttachmentCatalog {
  if (Result.isFailure(result)) {
    throw new Error("NiceEval official Record Attachment catalog is invalid");
  }
  return result.success;
}

export const NiceEvalRecordAttachmentCatalog = requireCatalog(
  makeRecordAttachmentCatalog(NiceEvalRecordAttachmentPersistences),
);

/** Family identities and source subsets derive from the logical definitions. */
export const NICE_EVAL_FAMILIES = Object.freeze([
  NiceEvalRecordAttachments.assertions.family,
  NiceEvalRecordAttachments.attemptCost.family,
  NiceEvalRecordAttachments.agentTurns.family,
  NiceEvalRecordAttachments.turnContexts.family,
  NiceEvalRecordAttachments.sandboxCommands.family,
  NiceEvalRecordAttachments.runnerActivities.attempt.family,
  NiceEvalRecordAttachments.runnerDiagnostics.attempt.family,
  NiceEvalRecordAttachments.fileChanges.family,
  NiceEvalRecordAttachments.sources.family,
  NiceEvalRecordAttachments.artifacts.attempt.family,
] as const);

export const NICE_EVAL_OBSERVABILITY_SOURCE_FAMILIES = Object.freeze([
  NiceEvalRecordAttachments.agentTurns.family,
  NiceEvalRecordAttachments.turnContexts.family,
  NiceEvalRecordAttachments.sandboxCommands.family,
  NiceEvalRecordAttachments.runnerActivities.attempt.family,
  NiceEvalRecordAttachments.runnerDiagnostics.attempt.family,
] as const);

export type NiceEvalFamily = (typeof NICE_EVAL_FAMILIES)[number];

export const NiceEvalFamilySchema: Schema.Codec<NiceEvalFamily> = Schema.Literals([
  ...NICE_EVAL_FAMILIES,
]);
