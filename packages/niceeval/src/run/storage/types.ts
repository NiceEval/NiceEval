import { RUN_ABSENCE_REASONS, type RunAbsenceReason } from "../protocol.ts";
import type { AttemptState, AttemptStateResult, RunSandboxState } from "../../state/protocol.ts";

export { RUN_ABSENCE_REASONS, type RunAbsenceReason };

export const RUN_TERMINAL_STATES = ["completed", "interrupted", "failed"] as const;
export type RunTerminalState = (typeof RUN_TERMINAL_STATES)[number];
export type RunState = "active" | "recovering" | RunTerminalState;

export interface PublicationCutoff {
  readonly storeGeneration: string;
  readonly revision: number;
}

export interface ExpectedRunSlot {
  readonly slotId: string;
  readonly evalId: string;
  readonly attemptOrdinal: number;
  readonly executionIdentityDigest: string;
}

export interface CreateRunResourceInput {
  readonly runId: string;
  readonly invocationId: string;
  readonly experimentId: string;
  readonly writerGeneration: string;
  readonly startedAt: string;
  readonly expectedSlots: readonly ExpectedRunSlot[];
  readonly deadlineEpochMs: number;
}

export interface RunMutationReceipt {
  readonly runId: string;
  readonly cutoff: PublicationCutoff;
}

export interface AttemptPublicationIdentity {
  readonly originRunId: string;
  readonly attemptId: string;
  readonly revision: number;
}

export interface PublishOriginAttemptInput {
  readonly runId: string;
  readonly writerGeneration: string;
  readonly slotId: string;
  readonly attemptId: string;
  readonly attemptLocator: string;
  readonly closureBytes: Uint8Array;
  readonly closureDigest: string;
  readonly attemptState?: AttemptState | undefined;
  readonly deadlineEpochMs: number;
}

export interface AttemptPublicationReceipt extends RunMutationReceipt {
  readonly slotId: string;
  readonly publicationIdentity: AttemptPublicationIdentity;
}

export interface BindAttemptReferenceInput {
  readonly runId: string;
  readonly writerGeneration: string;
  readonly slotId: string;
  readonly action: "carried" | "accepted";
  readonly publicationIdentity: AttemptPublicationIdentity;
  readonly deadlineEpochMs: number;
}

export interface ReferenceBindingReceipt extends RunMutationReceipt {
  readonly slotId: string;
  readonly publicationIdentity: AttemptPublicationIdentity;
}

export interface CloseRunResourceInput {
  readonly runId: string;
  readonly writerGeneration: string;
  readonly state: RunTerminalState;
  readonly completedAt: string;
  readonly absences: readonly {
    readonly slotId: string;
    readonly reason: RunAbsenceReason;
  }[];
  readonly deadlineEpochMs: number;
}

export interface OwnerTerminationEvidence {
  readonly kind: string;
  readonly identity: string;
  readonly observedAt: string;
}

interface RecoverRunResourceBase {
  readonly runId: string;
  readonly expectedWriterGeneration: string;
  readonly recoveryWriterGeneration: string;
  readonly completedAt: string;
  readonly deadlineEpochMs: number;
}

export type RecoverRunResourceInput = RecoverRunResourceBase &
  (
    | { readonly mode: "active"; readonly evidence: OwnerTerminationEvidence }
    | { readonly mode: "resume"; readonly actorProof: string }
    | { readonly mode: "terminal"; readonly expectedState: RunTerminalState }
  );

export interface RecoverRunReceipt extends RunMutationReceipt {
  readonly previousWriterGeneration: string;
  readonly writerGeneration: string;
  readonly state: RunTerminalState;
}

export interface DeleteRunResourceInput {
  readonly runId: string;
  readonly expectedState: RunTerminalState;
  readonly deletedAt: string;
  readonly deadlineEpochMs: number;
}

export interface RunReferenceDependency {
  readonly dependentRunId: string;
  readonly dependentSlotId: string;
  readonly attemptId: string;
  readonly attemptLocator: string;
}

export interface DeleteRunReceipt extends RunMutationReceipt {
  readonly state: RunTerminalState;
}

export interface PublishedAttempt {
  readonly sandboxState: AttemptStateResult;
  readonly attemptId: string;
  readonly attemptLocator: string;
  readonly originRunId: string;
  readonly originSlotId: string;
  readonly publicationIdentity: AttemptPublicationIdentity;
  readonly closureBytes: Uint8Array;
  readonly closureDigest: string;
}

export type RunSlotPublication =
  | { readonly state: "pending" }
  | {
      readonly state: "published";
      readonly action: "executed" | "carried" | "accepted";
      readonly attemptId: string;
      readonly attemptLocator: string;
      readonly originRunId: string;
      readonly originSlotId: string;
      readonly publicationIdentity: AttemptPublicationIdentity;
      readonly bindingRevision: number;
    }
  | {
      readonly state: "absent";
      readonly reason: RunAbsenceReason;
      readonly absenceRevision: number;
    };

interface ReadableRunResourceBase {
  readonly sandboxState: RunSandboxState;
  readonly runId: string;
  readonly invocationId: string;
  readonly experimentId: string;
  readonly startedAt: string;
  readonly writerGeneration: string;
  readonly createdRevision: number;
  readonly expected: number;
  readonly published: number;
  readonly missing: number;
  readonly slots: readonly (ExpectedRunSlot & {
    readonly publication: RunSlotPublication;
  })[];
}

export type ReadableRunResource = ReadableRunResourceBase &
  (
    | { readonly state: "active" | "recovering" }
    | { readonly state: RunTerminalState; readonly completedAt: string; readonly closeRevision: number }
  );

export interface RunResourcePage {
  readonly cutoff: PublicationCutoff;
  readonly runs: readonly ReadableRunResource[];
  readonly nextAfterRunId: string | null;
}
