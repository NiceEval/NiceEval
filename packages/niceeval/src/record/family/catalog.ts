import { Result, Schema } from "effect";

import {
  makeRecordAttachmentCatalog,
  type RecordAttachmentCatalog,
} from "../attachment/index.ts";
import { agentTurnsRecordAttachment } from "./agent-turns/definition.ts";
import { agentTurnsRecordAttachmentPersistence } from "./agent-turns/persistence.ts";
import {
  attemptArtifactsRecordAttachment,
  runArtifactsRecordAttachment,
} from "./artifacts/definition.ts";
import {
  attemptArtifactsRecordAttachmentPersistence,
  runArtifactsRecordAttachmentPersistence,
} from "./artifacts/persistence.ts";
import { assertionsRecordAttachment } from "./assertions/definition.ts";
import { assertionsRecordAttachmentPersistence } from "./assertions/persistence.ts";
import { fileChangesRecordAttachment } from "./file-changes/definition.ts";
import { fileChangesRecordAttachmentPersistence } from "./file-changes/persistence.ts";
import {
  attemptRunnerActivitiesRecordAttachment,
  runRunnerActivitiesRecordAttachment,
} from "./runner-activities/definition.ts";
import {
  attemptRunnerActivitiesRecordAttachmentPersistence,
  runRunnerActivitiesRecordAttachmentPersistence,
} from "./runner-activities/persistence.ts";
import {
  attemptRunnerDiagnosticsRecordAttachment,
  runRunnerDiagnosticsRecordAttachment,
} from "./runner-diagnostics/definition.ts";
import {
  attemptRunnerDiagnosticsRecordAttachmentPersistence,
  runRunnerDiagnosticsRecordAttachmentPersistence,
} from "./runner-diagnostics/persistence.ts";
import { sandboxCommandsRecordAttachment } from "./sandbox-commands/definition.ts";
import { sandboxCommandsRecordAttachmentPersistence } from "./sandbox-commands/persistence.ts";
import { sourcesRecordAttachment } from "./sources/definition.ts";
import { sourcesRecordAttachmentPersistence } from "./sources/persistence.ts";
import { turnContextsRecordAttachment } from "./turn-contexts/definition.ts";
import { turnContextsRecordAttachmentPersistence } from "./turn-contexts/persistence.ts";

/** Official logical fact definitions, grouped only for direct SDK use. */
export const NiceEvalRecordAttachments = Object.freeze({
  assertions: assertionsRecordAttachment,
  agentTurns: agentTurnsRecordAttachment,
  turnContexts: turnContextsRecordAttachment,
  sandboxCommands: sandboxCommandsRecordAttachment,
  runnerActivities: Object.freeze({
    attempt: attemptRunnerActivitiesRecordAttachment,
    run: runRunnerActivitiesRecordAttachment,
  }),
  runnerDiagnostics: Object.freeze({
    attempt: attemptRunnerDiagnosticsRecordAttachment,
    run: runRunnerDiagnosticsRecordAttachment,
  }),
  fileChanges: fileChangesRecordAttachment,
  sources: sourcesRecordAttachment,
  artifacts: Object.freeze({
    attempt: attemptArtifactsRecordAttachment,
    run: runArtifactsRecordAttachment,
  }),
});

/** Explicit durable Host composition; importing a family never registers it. */
export const NiceEvalRecordAttachmentPersistences = Object.freeze([
  assertionsRecordAttachmentPersistence,
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
