import { identityManifestsRecordAttachment } from "./identity-manifests/definition.ts";
import { attemptNotesRecordAttachment } from "./attempt-note/definition.ts";
import { judgeUsageRecordAttachment } from "./judge-usage/definition.ts";
import { agentTurnsRecordAttachment } from "./agent-turns/definition.ts";
import { adapterUsageRecordAttachment } from "./adapter-usage/definition.ts";
import { attemptCostRecordAttachment } from "./attempt-cost/definition.ts";
import {
  attemptArtifactsRecordAttachment,
  runArtifactsRecordAttachment,
} from "./artifacts/definition.ts";
import { assertionsRecordAttachment } from "./assertions/definition.ts";
import { fileChangesRecordAttachment } from "./file-changes/definition.ts";
import { executionTracesRecordCollection } from "./execution-traces/definition.ts";
import {
  attemptRunnerActivitiesRecordAttachment,
  runRunnerActivitiesRecordAttachment,
} from "./runner-activities/definition.ts";
import {
  attemptRunnerDiagnosticsRecordAttachment,
  runRunnerDiagnosticsRecordAttachment,
} from "./runner-diagnostics/definition.ts";
import { sandboxCommandsRecordAttachment } from "./sandbox-commands/definition.ts";
import { sourcesRecordAttachment } from "./sources/definition.ts";
import { turnContextsRecordAttachment } from "./turn-contexts/definition.ts";

/** Browser-neutral logical definitions, grouped only for direct current-reader use. */
export const NiceEvalRecordAttachments = Object.freeze({
  attemptNotes: attemptNotesRecordAttachment,
  adapterUsage: adapterUsageRecordAttachment,
  judgeUsage: judgeUsageRecordAttachment,
  assertions: assertionsRecordAttachment,
  attemptCost: attemptCostRecordAttachment,
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
  executionTraces: executionTracesRecordCollection,
  identityManifests: identityManifestsRecordAttachment,
  sources: sourcesRecordAttachment,
  artifacts: Object.freeze({
    attempt: attemptArtifactsRecordAttachment,
    run: runArtifactsRecordAttachment,
  }),
});

const current = <Attachment>(attachment: Attachment) =>
  Object.freeze({ attachment, revision: undefined });

/** Official readers use the enclosing Record format rather than family revisions. */
export const NiceEvalCurrentRecordAttachments = Object.freeze({
  attemptNotes: current(attemptNotesRecordAttachment),
  adapterUsage: current(adapterUsageRecordAttachment),
  judgeUsage: current(judgeUsageRecordAttachment),
  assertions: current(assertionsRecordAttachment),
  attemptCost: current(attemptCostRecordAttachment),
  agentTurns: current(agentTurnsRecordAttachment),
  turnContexts: current(turnContextsRecordAttachment),
  sandboxCommands: current(sandboxCommandsRecordAttachment),
  runnerActivities: Object.freeze({
    attempt: current(attemptRunnerActivitiesRecordAttachment),
    run: current(runRunnerActivitiesRecordAttachment),
  }),
  runnerDiagnostics: Object.freeze({
    attempt: current(attemptRunnerDiagnosticsRecordAttachment),
    run: current(runRunnerDiagnosticsRecordAttachment),
  }),
  fileChanges: current(fileChangesRecordAttachment),
  executionTraces: current(executionTracesRecordCollection),
  identityManifests: current(identityManifestsRecordAttachment),
  sources: current(sourcesRecordAttachment),
  artifacts: Object.freeze({
    attempt: current(attemptArtifactsRecordAttachment),
    run: current(runArtifactsRecordAttachment),
  }),
});
