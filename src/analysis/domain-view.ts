import type { AttemptOutcome } from "../record/model/core.ts";
import type { VerdictState } from "../eval/record/verdict.ts";
import type { JsonValue } from "./contracts.ts";

/** Fixed, NiceEval-published closed domain projections. */
export type BuiltinDomainViewKind =
  | "attempt-evidence"
  | "attempt-observability"
  | "file-changes"
  | "sources"
  | "sandbox-history";

/** A blob is closed to display-safe text before it leaves Sample. */
export type ClosedBlobContent =
  | { readonly state: "available"; readonly text: string }
  | { readonly state: "unavailable" | "binary" };

/** Core is closed when Sample successfully resolves a ReadableAttempt. */
export interface ClosedAttemptCore {
  readonly outcome: AttemptOutcome;
}

export interface ClosedTraceCollection {
  readonly state: "complete" | "partial";
  readonly limitations: readonly JsonValue[];
}

export interface ClosedConversationTurn {
  readonly turnId: string;
  readonly sequence: number;
  readonly outcome: "completed" | "failed" | "cancelled" | "interrupted";
}

interface ClosedConversationItemBase {
  readonly itemId: string;
  readonly turnId: string;
  readonly sequence: number;
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
  readonly conversation: ClosedConversationDetail;
  readonly commands: ClosedCommandsDetail;
  readonly usage: ClosedUsageDetail;
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
    readonly display: JsonValue;
    readonly criterion: JsonValue;
    readonly result: JsonValue;
    readonly coverage: JsonValue;
    readonly limitations: JsonValue;
    readonly subject: JsonValue;
    readonly evidence: readonly JsonValue[];
  }[];
  readonly sourceSites: readonly JsonValue[];
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

export type BuiltinDomainDetail<Kind extends BuiltinDomainViewKind> =
  Kind extends "attempt-evidence" ? AttemptEvidenceDomainDetail
    : Kind extends "attempt-observability" | "sandbox-history" ? AttemptObservabilityDomainDetail
    : Kind extends "file-changes" ? FileChangesDomainDetail
    : Kind extends "sources" ? SourcesDomainDetail
    : never;
