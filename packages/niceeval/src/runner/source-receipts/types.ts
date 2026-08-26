import type { AgentTurnsAttachment } from "../../record/family/agent-turns/definition.ts";
import type {
  AttemptRunnerActivitiesAttachment,
  RunRunnerActivitiesAttachment,
} from "../../record/family/runner-activities/definition.ts";
import type {
  AttemptRunnerDiagnosticsAttachment,
  RunRunnerDiagnosticsAttachment,
} from "../../record/family/runner-diagnostics/definition.ts";
import type { SandboxCommandsAttachment } from "../../record/family/sandbox-commands/definition.ts";
import type { SourceReceiptCollection } from "../../record/family/source-receipt/index.ts";
import type { SafeText } from "../../record/family/source-receipt/model.ts";

/**
 * Bytes have already crossed the Sandbox wrapper's decode/redact/limit
 * boundary. The Record writer only chooses their inline/blob representation.
 */
export interface StagedCommandStream {
  readonly text: SafeText;
  readonly retainedBytes: number;
  readonly totalSafeUtf8Bytes: number;
  readonly sha256: string;
}

type DurableSandboxCommandReceipt = SandboxCommandsAttachment["segments"][number];

export type CommandManifest = Pick<
  DurableSandboxCommandReceipt,
  "phase" | "invocation" | "workingDirectory"
>;

export interface StagedSandboxCommandReceipt {
  readonly segmentId: DurableSandboxCommandReceipt["segmentId"];
  readonly commandId: DurableSandboxCommandReceipt["commandId"];
  readonly sequence: DurableSandboxCommandReceipt["sequence"];
  readonly turnId: DurableSandboxCommandReceipt["turnId"];
  readonly phase: CommandManifest["phase"];
  readonly invocation: CommandManifest["invocation"];
  readonly workingDirectory: CommandManifest["workingDirectory"];
  readonly outcome: DurableSandboxCommandReceipt["outcome"];
  readonly stdout: StagedCommandStream;
  readonly stderr: StagedCommandStream;
}

export interface StagedSandboxCommandsAttachment {
  readonly collection: SourceReceiptCollection;
  readonly segments: readonly StagedSandboxCommandReceipt[];
}

/** Immutable source-local snapshots produced before the seal path starts. */
export interface RunnerAttemptSourceReceiptsCapture {
  readonly agentTurns?: AgentTurnsAttachment;
  readonly sandboxCommands?: StagedSandboxCommandsAttachment;
  readonly runnerActivities: AttemptRunnerActivitiesAttachment;
  readonly runnerDiagnostics: AttemptRunnerDiagnosticsAttachment;
}

export interface RunnerRunSourceReceiptsCapture {
  readonly runnerActivities?: RunRunnerActivitiesAttachment;
  readonly runnerDiagnostics?: RunRunnerDiagnosticsAttachment;
}

export type NormalizedAgentTurnTerminal = AgentTurnsAttachment["segments"][number]["terminal"];
