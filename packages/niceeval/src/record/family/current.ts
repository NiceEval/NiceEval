import { agentTurnsRecordAttachment } from "./agent-turns/definition.ts";
import { attemptCostRecordAttachment } from "./attempt-cost/definition.ts";
import {
  attemptArtifactsRecordAttachment,
  runArtifactsRecordAttachment,
} from "./artifacts/definition.ts";
import { assertionsRecordAttachment } from "./assertions/definition.ts";
import { fileChangesRecordAttachment } from "./file-changes/definition.ts";
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
  sources: sourcesRecordAttachment,
  artifacts: Object.freeze({
    attempt: attemptArtifactsRecordAttachment,
    run: runArtifactsRecordAttachment,
  }),
});

const current = <Attachment, Revision extends number>(attachment: Attachment, revision: Revision) =>
  Object.freeze({ attachment, revision });

/** Current revisions without importing historical Node-only migration code. */
export const NiceEvalCurrentRecordAttachments = Object.freeze({
  assertions: current(assertionsRecordAttachment, 4),
  attemptCost: current(attemptCostRecordAttachment, 1),
  agentTurns: current(agentTurnsRecordAttachment, 4),
  turnContexts: current(turnContextsRecordAttachment, 2),
  sandboxCommands: current(sandboxCommandsRecordAttachment, 2),
  runnerActivities: Object.freeze({
    attempt: current(attemptRunnerActivitiesRecordAttachment, 2),
    run: current(runRunnerActivitiesRecordAttachment, 2),
  }),
  runnerDiagnostics: Object.freeze({
    attempt: current(attemptRunnerDiagnosticsRecordAttachment, 2),
    run: current(runRunnerDiagnosticsRecordAttachment, 2),
  }),
  fileChanges: current(fileChangesRecordAttachment, 2),
  sources: current(sourcesRecordAttachment, 2),
  artifacts: Object.freeze({
    attempt: current(attemptArtifactsRecordAttachment, 2),
    run: current(runArtifactsRecordAttachment, 2),
  }),
});
