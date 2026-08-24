import type { AttemptOutcome } from "../record/model/core.ts";
import type {
  ExecutionIdentityDigest,
  ExperimentId,
  RunId,
  UtcMillis,
} from "../record/model/identifiers.ts";
import type { VerdictState } from "../eval/record/verdict.ts";
import type { AnalysisRunExecution, JsonValue } from "./contracts.ts";

/** Fixed, NiceEval-published closed domain projections. */
export type BuiltinDomainViewKind =
  | "attempt-evidence"
  | "attempt-observability"
  | "file-changes"
  | "source-navigation"
  | "sources"
  | "sandbox-history";

/** A blob is closed to display-safe text before it leaves Sample. */
export type ClosedBlobContent =
  | { readonly state: "available"; readonly text: string }
  | { readonly state: "unavailable" | "binary" };

/** Core is closed when Sample successfully resolves a ReadableAttempt. */
export interface ClosedAttemptCore {
  readonly outcome: AttemptOutcome;
  /**
   * Exact historical execution facts from the Attempt's origin Run. They are
   * deliberately distinct from a LogicalSlot's selected target Run: carried
   * and accepted members may point at another origin.
   */
  readonly origin: {
    readonly runId: RunId;
    readonly experimentId: ExperimentId;
    readonly startedAt: UtcMillis;
    readonly executionIdentityDigest: ExecutionIdentityDigest;
    readonly execution: AnalysisRunExecution;
  };
}

export type ClosedSourceState =
  | {
      readonly state: "complete" | "partial";
      readonly limitations: readonly JsonValue[];
    }
  | {
      readonly state: "not-recorded" | "migration-required" | "unsupported" | "invalid";
      readonly limitations: readonly [];
    };

/** One declared source dependency and its source-local read/collection state. */
export type ClosedSourceDependency<Source extends string = string> =
  & { readonly source: Source }
  & ClosedSourceState;

/** Collection state for the source that owns a component's retained values. */
export type ClosedTraceCollection = ClosedSourceState;

export interface ClosedConversationTurn {
  readonly turnId: string;
  readonly sequence: number;
  readonly outcome: "completed" | "failed" | "cancelled" | "interrupted";
}

interface ClosedConversationItemBase {
  readonly itemId: string;
  readonly turnId: string;
  readonly sequence: number;
  /** Current source event identity; historical Agent Turns rows omit it. */
  readonly eventId?: string;
  /** Exact, display-safe target already closed by Analysis. */
  readonly anchor?: string;
}

export type ClosedConversationItem =
  | (ClosedConversationItemBase & {
      readonly kind: "message";
      readonly role: "user" | "assistant";
      readonly text: string;
    })
  | (ClosedConversationItemBase & {
      readonly kind: "tool-call";
      readonly callId: string;
      readonly tool: string;
      readonly inputSummary: string;
    })
  | (ClosedConversationItemBase & {
      readonly kind: "tool-result";
      readonly callId: string;
      readonly outcome: "completed" | "rejected" | "failed" | "cancelled";
      readonly outputSummary: string;
    })
  | (ClosedConversationItemBase & {
      readonly kind: "thinking-summary" | "compaction" | "context-injection";
      readonly summary: string;
    })
  | (ClosedConversationItemBase & {
      readonly kind: "subagent";
      readonly state: "started" | "completed" | "failed";
      readonly label: string;
      readonly summary: string;
    })
  | (ClosedConversationItemBase & {
      readonly kind: "input-request";
      readonly state: "requested" | "answered" | "cancelled";
      readonly promptSummary: string;
      readonly responseSummary: string | null;
    })
  | (ClosedConversationItemBase & {
      readonly kind: "skill-load" | "conversation-error";
      readonly code: string;
      readonly summary: string;
    });

export interface ClosedConversationDetail {
  readonly dependencies: readonly ["niceeval.agent-turns", "niceeval.turn-contexts"];
  readonly collection: ClosedTraceCollection;
  readonly turns: readonly ClosedConversationTurn[];
  readonly items: readonly ClosedConversationItem[];
}

export interface ClosedTimingInterval {
  readonly intervalId: string;
  readonly phase: string;
  readonly label: string;
  readonly startOffsetMs: number;
  readonly durationMs: number;
  readonly parentIntervalId: string | null;
  readonly outcome: string;
}

export interface ClosedTimingDetail {
  readonly dependencies: readonly ["niceeval.runner-activities"];
  readonly collection: ClosedTraceCollection;
  readonly intervals: readonly ClosedTimingInterval[];
}

export type ClosedCommandInvocation =
  | {
      readonly kind: "argv";
      readonly executable: string;
      readonly arguments: readonly string[];
    }
  | { readonly kind: "shell"; readonly command: string };

export type ClosedCommandWorkingDirectory =
  | { readonly kind: "sandbox-default" }
  | { readonly kind: "project-relative"; readonly path: string }
  | { readonly kind: "redacted" };

export type ClosedCommandOutcome =
  | { readonly kind: "exited"; readonly exitCode: number }
  | { readonly kind: "terminated"; readonly reason: string }
  | { readonly kind: "not-started"; readonly reason: string };

export type ClosedCommandStream =
  | {
      readonly kind: "inline";
      readonly text: string;
      readonly retainedBytes: number;
      readonly totalSafeUtf8Bytes: number;
    }
  | {
      readonly kind: "blob";
      readonly retainedBytes: number;
      readonly totalSafeUtf8Bytes: number;
      readonly content: ClosedBlobContent;
    };

export interface ClosedCommandEntry {
  readonly commandId: string;
  readonly manifest: {
    readonly phase: string;
    readonly invocation: ClosedCommandInvocation;
    readonly workingDirectory: ClosedCommandWorkingDirectory;
  };
  readonly result: {
    readonly outcome: ClosedCommandOutcome;
    readonly stdout: ClosedCommandStream;
    readonly stderr: ClosedCommandStream;
  };
}

export interface ClosedCommandsDetail {
  readonly dependencies: readonly ["niceeval.sandbox-commands"];
  readonly collection: ClosedTraceCollection;
  readonly entries: readonly ClosedCommandEntry[];
}

export type ClosedUsageObservation =
  | {
      readonly provider: string;
      readonly kind: "token-bucket";
      readonly bucket: string;
      readonly tokens: number;
    }
  | {
      readonly provider: string;
      readonly kind: "request";
      readonly requestKind: string;
    }
  | {
      readonly provider: string;
      readonly kind: "provider-cost";
      readonly amount: string;
      readonly currency: string;
    };

export interface ClosedUsageDetail {
  readonly dependencies: readonly ["niceeval.agent-turns"];
  readonly collection: ClosedTraceCollection;
  readonly observations: readonly ClosedUsageObservation[];
}

export type ClosedDiagnosticRedaction =
  | { readonly state: "none" }
  | { readonly state: "applied"; readonly replacements: number };

export interface ClosedSourceFrame {
  readonly sourceItemId: string;
  readonly sha256: string;
  readonly start: { readonly line: number; readonly column: number };
  readonly end: { readonly line: number; readonly column: number };
}

export interface ClosedDiagnosticsDetail {
  readonly dependencies: readonly ["niceeval.runner-diagnostics"];
  readonly collection: ClosedTraceCollection;
  readonly diagnostics: readonly {
    readonly diagnosticId: string;
    readonly kind: "advisory" | "execution-error";
    readonly code: string;
    readonly phase: string;
    readonly summary: string;
    readonly causes: readonly { readonly code: string; readonly summary: string }[];
    readonly redaction: ClosedDiagnosticRedaction;
    readonly sourceFrame: ClosedSourceFrame | null;
  }[];
}

/** Closed, display-safe projection of one attempt-owned Observability value. */
export interface AttemptObservabilityDomainDetail {
  readonly sources: {
    readonly agentTurns: ClosedSourceDependency<"niceeval.agent-turns">;
    readonly turnContexts: ClosedSourceDependency<"niceeval.turn-contexts">;
    readonly sandboxCommands: ClosedSourceDependency<"niceeval.sandbox-commands">;
    readonly runnerActivities: ClosedSourceDependency<"niceeval.runner-activities">;
    readonly runnerDiagnostics: ClosedSourceDependency<"niceeval.runner-diagnostics">;
  };
  readonly conversation: ClosedConversationDetail;
  readonly commands: ClosedCommandsDetail;
  readonly usage: ClosedUsageDetail;
  readonly timing: ClosedTimingDetail;
  readonly diagnostics: ClosedDiagnosticsDetail;
}

/** Sandbox-only assembled view; it does not manufacture conversation or usage. */
export interface SandboxHistoryDomainDetail {
  readonly sources: {
    readonly sandboxCommands: ClosedSourceDependency<"niceeval.sandbox-commands">;
    readonly runnerActivities: ClosedSourceDependency<"niceeval.runner-activities">;
    readonly runnerDiagnostics: ClosedSourceDependency<"niceeval.runner-diagnostics">;
  };
  readonly commands: ClosedCommandsDetail;
  readonly timing: ClosedTimingDetail;
  readonly diagnostics: ClosedDiagnosticsDetail;
}

export interface AttemptEvidenceDomainDetail {
  /** Immutable terminal execution fact; it is not a Verdict. */
  readonly outcome: AttemptOutcome;
  /** Derived once by Eval's authoritative Core + Assertions fold. */
  readonly verdict: VerdictState;
  readonly entries: readonly {
    readonly entryId: string;
    readonly display: ClosedAssertionDisplay;
    readonly source: ClosedAssertionSource;
    readonly check: ClosedAssertionFactValue;
    readonly observed: ClosedAssertionObserved;
    readonly expected: ClosedAssertionFactValue;
    readonly explanation: ClosedAssertionFactValue;
    readonly decision: ClosedAssertionDecision;
    /** Present only for matcher entries whose durable query/source facts can be debugged. */
    readonly matcherDebugger?: ClosedMatcherFilterDebugger;
  }[];
  readonly sourceSites: readonly ClosedAssertionSourceSite[];
}

export type ClosedMatcherConversationTarget =
  | {
      readonly state: "exact";
      readonly turnId: string;
      readonly eventId: string;
      readonly anchor: string;
    }
  | {
      readonly state: "unavailable";
      readonly reason: "historical-not-recorded" | "source-unavailable" | "ambiguous";
    };

export type ClosedMatcherSourceLocator =
  | { readonly kind: "tool-occurrence"; readonly toolOccurrenceId: string }
  | { readonly kind: "event"; readonly eventId: string };

export interface ClosedMatcherFilterRow {
  readonly kind: "tool" | "event" | "legacy-source-row";
  readonly rowId: string;
  readonly number: string;
  readonly phase: "at-evaluation" | "outside-evaluation-snapshot" | "historical";
  readonly summary: string;
  readonly detail: ClosedAssertionFactValue;
  readonly locator?: ClosedMatcherSourceLocator;
  readonly evaluation:
    | { readonly result: "matched" | "mismatched" | "unavailable" | "not-evaluated" | "not-retained"; readonly difference?: ClosedAssertionFactValue }
    | { readonly result: "outside-snapshot" | "legacy" };
  readonly conversationTarget: ClosedMatcherConversationTarget;
}

export interface ClosedMatcherOrderReceipt {
  readonly sourceRows: number;
  readonly comparisons: number;
  readonly unavailableComparisons: number;
  readonly definitePrefixLength: number;
  readonly possiblePrefixLength: number;
  readonly stepReceipts: readonly {
    readonly step: number;
    readonly comparisons: number;
    readonly matched: number;
    readonly mismatched: number;
    readonly unavailable: number;
  }[];
  readonly complete: boolean;
  readonly exhaustive: boolean;
  readonly decisive: boolean;
}

export interface ClosedMatcherOrderStep {
  readonly step: number;
  readonly summary: ClosedAssertionFactValue;
  readonly state: "matched" | "possible" | "blocked" | "not-reached";
  readonly sourceRow?: string;
  readonly conversationTarget?: ClosedMatcherConversationTarget;
}

export type ClosedMatcherLedgerCollection =
  | {
      readonly state: "complete" | "partial";
      readonly rows: readonly ClosedMatcherFilterRow[];
      readonly limitations: readonly ClosedAssertionFactValue[];
    }
  | {
      readonly state: "unavailable";
      readonly reason: "historical-not-recorded" | "source-unavailable" | "ambiguous";
      readonly rows: readonly ClosedMatcherFilterRow[];
      readonly limitations: readonly ClosedAssertionFactValue[];
    };

export type ClosedMatcherFilterDebugger =
  | {
      readonly state: "current";
      readonly subject: "tool" | "event";
      readonly query:
        | { readonly kind: "collection-filter"; readonly summary: ClosedAssertionFactValue }
        | { readonly kind: "ordered-sequence"; readonly summaries: readonly ClosedAssertionFactValue[] };
      readonly receipt: ClosedAssertionCollectionReceipt | ClosedMatcherOrderReceipt;
      readonly source: {
        readonly final: ClosedMatcherLedgerCollection;
        readonly atEvaluation: ClosedMatcherLedgerCollection;
      };
      readonly identityRelation:
        | { readonly state: "exact" }
        | { readonly state: "unavailable"; readonly reason: "source-unavailable" | "ambiguous" };
      readonly overlayRetention: "complete" | "partial" | "unavailable";
      readonly steps: readonly ClosedMatcherOrderStep[];
    }
  | {
      readonly state: "legacy";
      readonly subject: "tool" | "event" | "source-row";
      readonly query: { readonly state: "unavailable"; readonly reason: "historical-not-recorded" };
      readonly source: {
        readonly final: ClosedMatcherLedgerCollection;
        readonly atEvaluation: ClosedMatcherLedgerCollection;
      };
      readonly identityRelation: { readonly state: "unavailable"; readonly reason: "historical-not-recorded" };
      readonly overlayRetention: "unavailable";
      readonly steps: readonly ClosedMatcherOrderStep[];
      readonly legacyDiagnostic?: ClosedAssertionFactValue;
    };

export interface ClosedAssertionDisplay {
  readonly key?: string;
  readonly label?: string;
  readonly groupPath: readonly string[];
}

/** Recursive, display-safe algebra used by all five neutral assertion sections. */
export type ClosedAssertionFactValue =
  | { readonly kind: "unavailable"; readonly reason: "not-recorded" | "not-declared" | "source-unavailable" }
  | { readonly kind: "value"; readonly value: null | boolean | number | string }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "list"; readonly items: readonly ClosedAssertionFactValue[] }
  | { readonly kind: "fields"; readonly fields: readonly ClosedAssertionFactField[] };

export interface ClosedAssertionFactField {
  readonly label: string;
  readonly value: ClosedAssertionFactValue;
}

export interface ClosedAssertionCollectionReceipt {
  readonly examined: number;
  readonly matched: number;
  readonly mismatched: number;
  readonly unavailable: number;
  readonly knownTotal: number | null;
  readonly complete: boolean;
  readonly exhaustive: boolean;
  readonly decisive: boolean;
}

export interface ClosedAssertionObserved {
  readonly kind: "fields";
  readonly fields: readonly ClosedAssertionFactField[];
  readonly receipt?: ClosedAssertionCollectionReceipt;
}

export type ClosedAssertionCoverage =
  | { readonly state: "complete" }
  | { readonly state: "partial"; readonly reason: "sampled" | "truncated" | "redacted" | "provider-limited" }
  | { readonly state: "unavailable"; readonly reason: "not-collected" | "source-unavailable" | "producer-failed" }
  | { readonly state: "not-applicable"; readonly reason: "optional-material" | "unsupported-subject" };

export interface ClosedAssertionSource {
  readonly kind: "fields";
  readonly fields: readonly ClosedAssertionFactField[];
  readonly coverage: ClosedAssertionCoverage;
  readonly limitations: readonly ClosedAssertionLimitation[];
}

export type ClosedAssertionLimitation =
  | { readonly kind: "redacted"; readonly fieldCount: number }
  | { readonly kind: "sampled"; readonly captured: number; readonly knownTotal?: number }
  | { readonly kind: "truncated"; readonly omittedBytes: number }
  | { readonly kind: "provider-limited" };

export interface ClosedAssertionPolicy {
  readonly requirement:
    | { readonly state: "available"; readonly value: "required" | "optional" }
    | { readonly state: "unavailable"; readonly reason: "not-recorded" };
  readonly condition:
    | {
        readonly state: "available";
        readonly value:
          | { readonly kind: "boolean"; readonly expected: true }
          | { readonly kind: "at-least"; readonly threshold: number }
          | { readonly kind: "record-only" };
      }
    | { readonly state: "unavailable"; readonly reason: "not-recorded" };
}

export type ClosedAssertionContribution =
  | { readonly state: "not-scored" }
  | { readonly state: "earned"; readonly points: number; readonly earned: number }
  | {
      readonly state: "unavailable";
      readonly points: number;
      readonly reason: "source-unavailable" | "evaluation-errored" | "not-applicable";
    };

export interface ClosedAssertionDecision {
  readonly result: "matched" | "mismatched" | "unavailable" | "errored" | "not-applicable";
  readonly reason: string | null;
  readonly gate: "not-gate" | "satisfied" | "failed" | "unavailable" | "not-applicable";
  readonly policy: ClosedAssertionPolicy;
  readonly contribution: ClosedAssertionContribution;
}

export interface ClosedAssertionSourceSite {
  readonly entryId: string;
  readonly sourceOrder: number;
  readonly role: "declaration" | "threshold" | "score" | "gate" | "optional" | "stop";
  readonly sourceItemId: string;
  readonly sha256: string;
  readonly start: { readonly line: number; readonly column: number };
  readonly end: { readonly line: number; readonly column: number };
}

/** A FileChanges endpoint after its owner-local blob reference has been closed. */
export type ClosedFileChangeEndpoint =
  | { readonly state: "absent" }
  | {
      readonly state: "present";
      readonly revision: ClosedFileRevision;
    };

/** The `available` alternative substitutes display-safe content for a RecordBlobRef. */
export type ClosedFileRevision =
  | {
      readonly kind: "text";
      readonly sha256: string;
      readonly byteLength: number;
      readonly content:
        | { readonly state: "available"; readonly content: ClosedBlobContent }
        | { readonly state: "omitted"; readonly reason: "collection-cap" };
    }
  | {
      readonly kind: "elided";
      readonly reason: "binary" | "oversized-text";
      readonly byteLength: number;
    }
  | {
      readonly kind: "unavailable";
      readonly reason: "unsupported-input" | "capture-failed" | "capture-interrupted";
    };

export type ClosedFileChangesCollectionLimitation =
  | {
      readonly code: "capture-failed" | "capture-interrupted";
      readonly stage: "checkpoint" | "export" | "finalizer-export" | "normalize";
      readonly atWindowId: string | null;
    }
  | {
      readonly code: "collection-cap-reached";
      readonly target: "window" | "change" | "content-blob" | "content-byte" | "json-byte";
      readonly omittedAtLeast: number;
      readonly atWindowId: string | null;
    }
  | {
      readonly code: "unsupported-input";
      readonly target: "endpoint-metadata";
      readonly omittedAtLeast: number;
    };

export interface ClosedFileChangesCollection {
  readonly state: "complete" | "partial";
  readonly limitations: readonly ClosedFileChangesCollectionLimitation[];
}

export interface ClosedFileChangesAttribution {
  readonly kind: "agent-send-window-endpoints";
  readonly policy: {
    readonly defaultPolicy: "niceeval.sandbox-ledger/default-excludes/v1";
    readonly include: readonly string[];
    readonly ignore: readonly string[];
  };
}

export interface ClosedFileChange {
  readonly changeId: string;
  readonly path: string;
  readonly kind: "created" | "modified" | "deleted";
  readonly before: ClosedFileChangeEndpoint;
  readonly after: ClosedFileChangeEndpoint;
}

/** One recorded send-window, including an intentional zero-change window. */
export interface ClosedFileChangeWindow {
  readonly windowId: string;
  readonly sequence: number;
  readonly changes: readonly ClosedFileChange[];
}

export type FileChangesNet =
  | {
      readonly state: "available";
      readonly kind: "none" | "created" | "modified" | "deleted";
      readonly before: ClosedFileChangeEndpoint;
      readonly after: ClosedFileChangeEndpoint;
    }
  | {
      readonly state: "indeterminate";
      readonly reason:
        | "collection-partial"
        | "window-discontinuity"
        | "endpoint-unavailable"
        | "endpoint-equality-unprovable";
    };

/**
 * The complete, display-safe FileChanges trajectory for one Attempt.  It is
 * deliberately a domain structure rather than a table frame: windows retain
 * their temporal order while `paths` gives a separately derived net summary.
 */
export interface FileChangesDomainDetail {
  readonly attribution: ClosedFileChangesAttribution;
  readonly collection: ClosedFileChangesCollection;
  readonly trajectory: readonly ClosedFileChangeWindow[];
  readonly paths: readonly {
    readonly path: string;
    readonly changes: readonly {
      readonly windowId: string;
      readonly changeId: string;
    }[];
    readonly net: FileChangesNet;
  }[];
}

export interface SourcesDomainDetail {
  readonly items: readonly {
    readonly sourceItemId: string;
    readonly path: string;
    readonly sha256: string;
    readonly content: ClosedBlobContent;
  }[];
}

/** Closed physical-send navigation rows; mapped frames retain exact digest joins. */
export interface SourceNavigationDomainDetail {
  readonly dependencies: readonly [
    "niceeval.turn-contexts",
    "niceeval.runner-activities",
    "niceeval.sources",
  ];
  readonly sources: {
    readonly turnContexts: ClosedSourceDependency<"niceeval.turn-contexts">;
    readonly runnerActivities: ClosedSourceDependency<"niceeval.runner-activities">;
    readonly originSources: ClosedSourceDependency<"niceeval.sources">;
  };
  /** Reader-side relation state; source states remain separate above. */
  readonly collection: ClosedTraceCollection;
  readonly rows: readonly {
    readonly turnId: string;
    readonly sourceOrder: number | null;
    readonly source:
      | {
          readonly state: "mapped";
          readonly sourceItemId: string;
          readonly sha256: string;
          readonly start: { readonly line: number; readonly column: number };
          readonly end: { readonly line: number; readonly column: number };
          readonly verification:
            | { readonly state: "verified" }
            | { readonly state: "invalid"; readonly reason: "source-anchor-mismatch" }
            | {
                readonly state: "not-recorded" | "migration-required" | "unsupported" | "invalid";
                readonly reason: "source-dependency-unavailable";
              };
        }
      | {
          readonly state: "unmapped";
          readonly reason:
            | "location-not-captured"
            | "source-snapshot-not-recorded"
            | "position-unrepresentable";
        };
    readonly timing:
      | { readonly state: "linked"; readonly intervalId: string }
      | { readonly state: "unavailable"; readonly reason: "timing-not-recorded" };
  }[];
}

export type BuiltinDomainDetail<Kind extends BuiltinDomainViewKind> =
  Kind extends "attempt-evidence" ? AttemptEvidenceDomainDetail
    : Kind extends "attempt-observability" ? AttemptObservabilityDomainDetail
    : Kind extends "sandbox-history" ? SandboxHistoryDomainDetail
    : Kind extends "file-changes" ? FileChangesDomainDetail
    : Kind extends "source-navigation" ? SourceNavigationDomainDetail
    : Kind extends "sources" ? SourcesDomainDetail
    : never;
