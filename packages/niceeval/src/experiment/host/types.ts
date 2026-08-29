import { Data, type Effect } from "effect";

import type { Config } from "../../types.ts";
import type { FeedbackCoordinator } from "../../runner/feedback/coordinator.ts";
import type { InvocationCompletion } from "../../runner/types.ts";
import type { SessionListDocument, SessionShowDocument } from "../../runner/session.ts";
import type { CurrentReuseReadbackSnapshot } from "../../runner/reuse-readback.ts";

export type ExperimentHostJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly ExperimentHostJsonValue[]
  | { readonly [key: string]: ExperimentHostJsonValue };

/** Services supplied once by the outer Node/application composition edge. */
export type ExperimentHostRequirements =
  | import("../../record/platform/services.ts").RecordFileSystem
  | import("../../record/platform/services.ts").RecordEntropy
  | import("../../coordination/record-leases.ts").RecordCoordination;

export type ExperimentHostOperation =
  | "catalog"
  | "check"
  | "debug"
  | "invocation-plan"
  | "invocation-run"
  | "rename-plan"
  | "rename-apply"
  | "accept"
  | "invocation-status-list"
  | "invocation-status-show"
  | "teardown-inspect"
  | "teardown-run";

/** Stable typed failure boundary; defects and interruption remain separate. */
export class ExperimentHostError extends Data.TaggedError("ExperimentHostError")<{
  readonly operation: ExperimentHostOperation;
  readonly code: string;
  readonly message: string;
  /** Structured typed failure retained for application/CLI attribution. */
  readonly cause?: unknown;
}> {}

/** Inputs shared by discovery, link checking, and invocation planning. */
export interface ExperimentHostSelectionInput {
  readonly cwd: string;
  readonly experimentSelector?: string;
  readonly evalSelectors?: readonly string[];
  readonly tag?: string;
}

export interface ExperimentHostEvalSummary {
  readonly id: string;
  readonly description?: string;
  readonly tags: readonly string[];
  readonly evaluationKind: "pass" | "score";
}

export interface ExperimentHostExperimentSummary {
  readonly id: string;
  readonly description?: string;
  readonly agent: string;
  readonly model?: string;
  readonly attempts: number;
  readonly evalIds: readonly string[];
  readonly labels: Readonly<Record<string, string | number>>;
  readonly hasSetup: boolean;
  readonly hasTeardown: boolean;
  readonly sharedStateKey?: string;
}

export interface ExperimentHostCatalog {
  readonly status: "listed";
  readonly evals: readonly ExperimentHostEvalSummary[];
  readonly experimentIds: readonly string[];
  readonly experiments: readonly ExperimentHostExperimentSummary[];
}

export type ExperimentHostSelectionProblem =
  | {
      readonly status: "experiment-no-match";
      readonly selector: string;
      readonly candidates: readonly string[];
    }
  | {
      readonly status: "eval-no-match";
      readonly selector: string;
      readonly experimentIds: readonly string[];
      readonly candidates: readonly string[];
    }
  | {
      readonly status: "empty-selection";
      readonly experimentIds: readonly string[];
      readonly candidates: readonly string[];
    };

export interface ExperimentHostRunOverrides {
  readonly attempts?: number;
  readonly earlyExit?: boolean;
  readonly timeoutMs?: number;
  readonly budget?: number;
  readonly rerun?: "failed" | "all";
  readonly keepSandbox?: "failed" | "all";
  readonly maxConcurrency?: number;
  readonly maxBuildConcurrency?: number;
  readonly maxSetupPrefixConcurrency?: number;
}

export interface ExperimentHostCheckRequest extends ExperimentHostSelectionInput {
  readonly config: Config;
  readonly overrides?: ExperimentHostRunOverrides;
}

export type ExperimentHostCheckResult =
  | ExperimentHostSelectionProblem
  | {
      readonly status: "linked";
      readonly experimentIds: readonly string[];
      readonly evalIds: readonly string[];
      readonly pairCount: number;
    };

declare const invocationPlanBrand: unique symbol;

/**
 * Opaque in-memory authority issued by `experimentHost.invocation.plan`.
 * Its Runner graph is held in Host-private storage and cannot be forged or
 * reconstructed by a CLI.
 */
export interface ExperimentHostInvocationPlan {
  readonly [invocationPlanBrand]: typeof invocationPlanBrand;
}

export interface ExperimentHostInvocationShape {
  readonly experiments: number;
  readonly evals: number;
  readonly configurations: number;
  readonly totalAttempts: number;
  readonly attempts: number;
  readonly maxConcurrency: number;
  readonly maxBuildConcurrency: number;
  readonly maxSetupPrefixConcurrency: number;
  readonly experimentConcurrency: Readonly<Record<string, number>>;
}

export interface ExperimentHostDrySlotTarget {
  readonly runId: string;
  readonly slotId: string;
  readonly experimentId: string;
  readonly evalId: string;
  readonly executionIdentityDigest: string;
  readonly evalGroupId?: string;
  readonly evalGroupIndex?: number;
  readonly attempt: number;
}

export interface ExperimentHostDryComparison {
  readonly attachment: string;
  readonly recordedClaim: string;
  readonly sourceState: string;
  readonly result: string;
  readonly reason: string;
}

export type ExperimentHostDrySlot =
  | {
      readonly state: "reuse";
      readonly target: ExperimentHostDrySlotTarget;
      readonly source: {
        readonly attemptId: string;
        readonly originRunId: string;
        readonly originSlotId: string;
        readonly sourceRunId: string;
      };
      readonly comparisons: readonly ExperimentHostDryComparison[];
    }
  | {
      readonly state: "gap";
      readonly target: ExperimentHostDrySlotTarget;
      readonly reason: string;
      readonly scope: "slot" | "experiment" | "target";
      readonly issues: readonly ExperimentHostJsonValue[];
      readonly comparisons: readonly ExperimentHostDryComparison[];
    };

export interface ExperimentHostDryPlan {
  readonly policy: { readonly name: "project-target"; readonly version: 1 };
  readonly slots: readonly ExperimentHostDrySlot[];
  readonly readbacks: readonly CurrentReuseReadbackSnapshot[];
  readonly lockedPairs: readonly string[];
}

export type ExperimentHostInvocationPlanResult =
  | ExperimentHostSelectionProblem
  | {
      readonly status: "ready";
      readonly plan: ExperimentHostInvocationPlan;
      readonly shape: ExperimentHostInvocationShape;
      readonly experimentIds: readonly string[];
      readonly evalIds: readonly string[];
      readonly pluginAudit: {
        readonly occurrences: readonly ExperimentHostJsonValue[];
      };
      readonly dry?: ExperimentHostDryPlan;
    };

export interface ExperimentHostInvocationPlanRequest extends ExperimentHostSelectionInput {
  readonly config: Config;
  /** @deprecated Ordinary Invocations always use cwd/.niceeval/record.sqlite. */
  readonly recordRoot?: string;
  /** Host path to process coordination state; defaults to cwd/.niceeval. */
  readonly coordinationRoot?: string;
  readonly overrides?: ExperimentHostRunOverrides;
  readonly preview?: boolean;
}

/** Lossless Experiment presentation owned by the calling Host surface. */
export interface ExperimentHostInvocationFeedback {
  readonly coordinator: FeedbackCoordinator;
}

export interface ExperimentHostInvocationRunRequest {
  readonly plan: ExperimentHostInvocationPlan;
  readonly signal?: AbortSignal;
  readonly feedback?: ExperimentHostInvocationFeedback;
  /** Optional required JUnit reporter target, owned and invoked inside Host. */
  readonly junitPath?: string;
}

/**
 * Invocation status is project-local and ephemeral.  It is an observation of
 * the coordination directory, not recoverable Record fact data.
 */
export interface ExperimentHostInvocationStatusListRequest {
  readonly cwd: string;
  readonly all?: boolean;
  readonly experimentSelector?: string;
}

export interface ExperimentHostInvocationStatusShowRequest {
  readonly cwd: string;
  readonly invocationSelector: string;
}

export type ExperimentHostInvocationStatusList = SessionListDocument;

export type ExperimentHostInvocationStatusShow = SessionShowDocument;

export interface ExperimentHostInvocationReceipt {
  readonly invocationId: string;
  readonly createdRunIds: readonly string[];
  readonly publicationCutoff: string;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly completion: "completed" | "interrupted" | "failed";
}

export interface ExperimentHostInvocationSummary {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly errored: number;
  readonly durationMs: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly estimatedCostUSD?: number;
}

export interface ExperimentHostInvocationResult {
  readonly status: "finished";
  readonly receipt: ExperimentHostInvocationReceipt;
  readonly summary: ExperimentHostInvocationSummary;
  /** Present when the caller supplied the one feedback reducer/presentation. */
  readonly completion?: InvocationCompletion;
  /** Exact CLI exit fold for the supplied presentation. */
  readonly exitCode?: number;
}

export interface ExperimentHostRenameRequest {
  readonly cwd: string;
  readonly oldId: string;
  readonly newId: string;
  /** @deprecated Rename is anchored to cwd/.niceeval/record.sqlite. */
  readonly recordRoot?: string;
  readonly sourceRunId?: string;
  readonly config?: Config;
  readonly operatorReason?: string;
}

export type ExperimentHostRenameReason =
  | "source-empty"
  | "target-not-found"
  | "target-has-results"
  | "source-unreadable"
  | "artifact-unavailable"
  | "nothing-to-migrate";

export interface ExperimentHostRenamePlan {
  readonly status: "plan";
  readonly oldId: string;
  readonly newId: string;
  readonly migrations: readonly {
    readonly evalId: string;
    readonly sourceLocator: string;
    readonly targetExperimentId: string;
    readonly fingerprint: string;
  }[];
  readonly excluded: readonly { readonly evalId: string; readonly reason: string }[];
  readonly blocked?: {
    readonly reason: ExperimentHostRenameReason;
    readonly evalId?: string;
    readonly conflictingEvals?: readonly string[];
    readonly detail?: string;
  };
}

export type ExperimentHostRenameResult =
  | {
      readonly status: "rejected";
      readonly oldId: string;
      readonly newId: string;
      readonly reason: ExperimentHostRenameReason;
      readonly evalId?: string;
      readonly conflictingEvals?: readonly string[];
      readonly detail?: string;
    }
  | {
      readonly status: "done";
      readonly invocationId: string;
      readonly runId: string;
      readonly snapshotPath: string;
      readonly oldId: string;
      readonly newId: string;
      readonly migrated: readonly {
        readonly evalId: string;
        readonly sourceLocator: string;
        readonly locator: string;
        readonly fingerprint: string;
        readonly verdict: "passed" | "failed";
      }[];
    };

export interface ExperimentHostAcceptRequest {
  readonly cwd: string;
  readonly locators: readonly string[];
  /** @deprecated Accept is anchored to cwd/.niceeval/record.sqlite. */
  readonly recordRoot?: string;
  readonly config?: Config;
  readonly operatorReason?: string;
}

export interface ExperimentHostAcceptedAttempt {
  readonly invocationId: string;
  readonly runId: string;
  readonly slotId: string;
  readonly locator: string;
  readonly sourceLocator: string;
  readonly fingerprint: string;
}

export interface ExperimentHostAcceptRunRequest extends Omit<ExperimentHostAcceptRequest, "locators"> {
  readonly runId: string;
}

export interface ExperimentHostAcceptRunPlan {
  readonly sourceRunId: string;
  readonly members: readonly {
    readonly locator: string;
    readonly experimentId: string;
    readonly evalId: string;
    readonly attempt: number;
    readonly fingerprint: string;
  }[];
}

export interface ExperimentHostSharedStateEvidence {
  readonly key: string;
  readonly experimentId: string;
  readonly ownerToken: string;
  readonly host: string;
  readonly pid: number;
  readonly processIdentity: string;
  readonly heartbeatAt: string;
}

export interface ExperimentHostTeardownInspectRequest {
  readonly cwd: string;
  readonly experimentSelector?: string;
  readonly coordinationRoot?: string;
  readonly currentHost: string;
  readonly recoveryKey?: string;
}

export type ExperimentHostTeardownInspection =
  | { readonly status: "no-evidence"; readonly key: string }
  | ExperimentHostSelectionProblem
  | {
      readonly status: "selection-not-unique";
      readonly experimentIds: readonly string[];
      readonly evidence: ExperimentHostSharedStateEvidence;
    }
  | {
      readonly status: "experiment-mismatch";
      readonly selectedExperimentId: string;
      readonly evidence: ExperimentHostSharedStateEvidence;
    }
  | {
      readonly status: "teardown-required";
      readonly experimentId: string;
      readonly evidence: ExperimentHostSharedStateEvidence;
    }
  | {
      readonly status: "ready";
      readonly experimentIds: readonly string[];
      readonly orphanedRegistrations: number;
      readonly evidence?: ExperimentHostSharedStateEvidence;
    };

export interface ExperimentHostTeardownRequest extends ExperimentHostTeardownInspectRequest {
  readonly observer?: ExperimentHostTeardownObserver;
  readonly signal?: AbortSignal;
  readonly ownerToken?: string;
  readonly confirmOwnerTerminated?: boolean;
  readonly confirmRemoteQuiesced?: boolean;
}

export type ExperimentHostTeardownEvent =
  | {
      readonly type: "experiment-progress";
      readonly experimentId: string;
      readonly detail: string;
    }
  | {
      readonly type: "diagnostic";
      readonly code: string;
      readonly level: "info" | "warning" | "error";
      readonly message: string;
      readonly data?: Readonly<Record<string, ExperimentHostJsonValue>>;
    }
  | {
      readonly type: "experiment-hook";
      readonly experimentId: string;
      readonly hook: "teardown";
      readonly status: "started" | "done" | "failed";
      readonly durationMs?: number;
      readonly recovery?: true;
    };

export interface ExperimentHostTeardownObserver {
  readonly observe: (event: ExperimentHostTeardownEvent) => void;
}

export type ExperimentHostTeardownResult =
  | ExperimentHostTeardownInspection
  | {
      readonly status: "completed";
      readonly experiments: readonly {
        readonly experimentId: string;
        readonly executions: number;
        readonly outcome: "succeeded" | "failed" | "not-configured";
        readonly error?: string;
      }[];
    }
  | {
      readonly status: "recovered" | "already-released";
      readonly key: string;
      readonly experimentId: string;
      readonly ownerToken: string;
    }
  | {
      readonly status: "recovery-confirmation-required";
      readonly evidence: ExperimentHostSharedStateEvidence;
    }
  | {
      readonly status: "recovery-teardown-failed";
      readonly evidence: ExperimentHostSharedStateEvidence;
      readonly error: string;
    };

export interface ExperimentHostHighLevelSDK {
  readonly catalog: (
    input: ExperimentHostSelectionInput,
  ) => Effect.Effect<ExperimentHostCatalog, ExperimentHostError, ExperimentHostRequirements>;
  readonly check: (
    input: ExperimentHostCheckRequest,
  ) => Effect.Effect<ExperimentHostCheckResult, ExperimentHostError, ExperimentHostRequirements>;
  readonly invocation: {
    readonly plan: (
      input: ExperimentHostInvocationPlanRequest,
    ) => Effect.Effect<ExperimentHostInvocationPlanResult, ExperimentHostError, ExperimentHostRequirements>;
    readonly run: (
      input: ExperimentHostInvocationRunRequest,
    ) => Effect.Effect<ExperimentHostInvocationResult, ExperimentHostError, ExperimentHostRequirements>;
  };
  readonly invocationStatus: {
    readonly list: (
      input: ExperimentHostInvocationStatusListRequest,
    ) => Effect.Effect<ExperimentHostInvocationStatusList, ExperimentHostError, ExperimentHostRequirements>;
    readonly show: (
      input: ExperimentHostInvocationStatusShowRequest,
    ) => Effect.Effect<ExperimentHostInvocationStatusShow, ExperimentHostError, ExperimentHostRequirements>;
  };
  readonly rename: {
    readonly plan: (
      input: ExperimentHostRenameRequest,
    ) => Effect.Effect<ExperimentHostRenamePlan, ExperimentHostError, ExperimentHostRequirements>;
    readonly apply: (
      input: ExperimentHostRenameRequest,
    ) => Effect.Effect<ExperimentHostRenameResult, ExperimentHostError, ExperimentHostRequirements>;
  };
  readonly teardown: {
    readonly inspect: (
      input: ExperimentHostTeardownInspectRequest,
    ) => Effect.Effect<ExperimentHostTeardownInspection, ExperimentHostError, ExperimentHostRequirements>;
    readonly run: (
      input: ExperimentHostTeardownRequest,
    ) => Effect.Effect<ExperimentHostTeardownResult, ExperimentHostError, ExperimentHostRequirements>;
  };
  readonly accept: (
    input: ExperimentHostAcceptRequest,
  ) => Effect.Effect<readonly ExperimentHostAcceptedAttempt[], ExperimentHostError, ExperimentHostRequirements>;
  readonly acceptRun: {
    readonly plan: (input: ExperimentHostAcceptRunRequest) => Effect.Effect<ExperimentHostAcceptRunPlan, ExperimentHostError, ExperimentHostRequirements>;
    readonly apply: (input: ExperimentHostAcceptRunRequest) => Effect.Effect<readonly ExperimentHostAcceptedAttempt[], ExperimentHostError, ExperimentHostRequirements>;
  };
}
