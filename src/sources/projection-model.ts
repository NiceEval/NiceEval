import type { AssertionEntryId } from "../assertions/identity.ts";
import type { SlotId } from "../record/model/identifiers.ts";
import type {
  AttemptOriginRunProjectedEntry,
  AttemptSlotProjectedEntry,
  ProjectedSample,
} from "../projection/model.ts";
import type { ProjectedRecordAttachmentResult } from "../projection/attachment-result.ts";
import type {
  AnalysisSample,
  CoreInvalidAnalysisSlot,
  ExcludedAnalysisSlot,
  IncludedAnalysisSlot,
  NotRecordedAnalysisSlot,
} from "../analysis/index.ts";
import type {
  Sha256Digest,
  SourceFileItemId,
  SourcePackageItemId,
} from "./identity.ts";

/**
 * The source-navigation view keeps the assertion facts needed to render and
 * summarize a source tree, without exposing an Assertions Attachment payload.
 */
export interface AssertionSourceDisplay {
  readonly key?: string;
  readonly label?: string;
  readonly groupPath: readonly string[];
}

export type AssertionSourceScore =
  | { readonly state: "not-scored" }
  | {
      readonly state: "earned";
      readonly points: number;
      readonly earned: number;
    }
  | {
      readonly state: "unavailable";
      readonly points: number;
      readonly reason:
        | "source-unavailable"
        | "evaluation-errored"
        | "not-applicable";
    };

export type AssertionSourceResult =
  | {
      readonly state: "matched";
      readonly gate: "not-gate" | "satisfied";
      readonly score: AssertionSourceScore;
    }
  | {
      readonly state: "mismatched";
      readonly reason: "condition-not-met";
      readonly gate: "not-gate" | "failed";
      readonly score: AssertionSourceScore;
    }
  | {
      readonly state: "unavailable";
      readonly reason: "evidence-unavailable" | "source-unavailable" | "redacted";
      readonly gate: "not-gate" | "unavailable";
      readonly score: AssertionSourceScore;
    }
  | {
      readonly state: "errored";
      readonly reason: "evaluator-failed" | "producer-interrupted" | "invalid-subject";
      readonly gate: "not-gate" | "unavailable";
      readonly score: AssertionSourceScore;
    }
  | {
      readonly state: "not-applicable";
      readonly reason: "coverage-not-applicable";
      readonly gate: "not-gate" | "not-applicable";
      readonly score: AssertionSourceScore;
    };

export interface AssertionSourceEntryValue {
  readonly entryId: AssertionEntryId;
  readonly display: AssertionSourceDisplay;
  readonly result: AssertionSourceResult;
}

/** Criterion interpretation stays entry-local while its durable envelope stays private. */
export type AssertionSourceEntry =
  | {
      readonly state: "available";
      readonly entry: AssertionSourceEntryValue;
    }
  | {
      readonly state: "unsupported";
      readonly entry: AssertionSourceEntryValue;
      readonly reason: "builtin-unknown" | "third-party-schema-unavailable";
    }
  | {
      readonly state: "invalid";
      readonly entry: AssertionSourceEntryValue;
      readonly reason: "criterion-envelope-invalid" | "criterion-data-invalid";
    };

export interface AssertionsSourceProjection {
  readonly entries: readonly AssertionSourceEntry[];
}

/** A source item identity in a materialized source-navigation view. */
export interface SourcePackageItemRef {
  readonly kind: "package";
  readonly packageItemId: SourcePackageItemId;
}

/** A source file identity plus the digest of the materialized snapshot text. */
export interface SourceFileItemRef {
  readonly kind: "file";
  readonly packageItemId: SourcePackageItemId;
  readonly fileItemId: SourceFileItemId;
  readonly sha256: Sha256Digest;
}

export interface SourceCoordinate {
  readonly line: number;
  readonly column: number;
}

export interface AssertionSourcePackageFrame {
  readonly target: SourcePackageItemRef;
}

export interface AssertionSourceFileFrame {
  readonly target: SourceFileItemRef;
  readonly coordinate: SourceCoordinate;
}

export type AssertionSourceFrame =
  | AssertionSourcePackageFrame
  | AssertionSourceFileFrame;

export interface AssertionSourceTrace {
  readonly frames:
    | readonly [AssertionSourceFileFrame]
    | readonly [
        AssertionSourceFileFrame,
        ...AssertionSourceFrame[],
        AssertionSourceFileFrame,
      ];
}

export type AssertionSourceRole =
  | "declaration"
  | "threshold"
  | "score"
  | "gate"
  | "optional"
  | "stop";

export type AssertionSourceOccurrence =
  | {
      readonly sourceOrder: number;
      readonly role: Exclude<AssertionSourceRole, "stop">;
    }
  | {
      readonly sourceOrder: number;
      readonly role: "stop";
      readonly outcome: "continued" | "stopped" | "interrupted";
    };

export interface AssertionSourceSite {
  readonly trace: AssertionSourceTrace;
  readonly occurrences: readonly [
    AssertionSourceOccurrence,
    ...AssertionSourceOccurrence[],
  ];
}

export interface AssertionSourceSitesEntry {
  readonly entryId: AssertionEntryId;
  readonly sites: readonly [AssertionSourceSite, ...AssertionSourceSite[]];
}

export type AssertionSourceSendStatus =
  | "completed"
  | "failed"
  | "interrupted";

export interface AssertionSourceSendOccurrence {
  readonly sourceOrder: number;
  readonly label: string;
  readonly status: AssertionSourceSendStatus;
  readonly durationMs: number;
}

export interface AssertionSourceSendSite {
  readonly trace: AssertionSourceTrace;
  readonly occurrences: readonly [
    AssertionSourceSendOccurrence,
    ...AssertionSourceSendOccurrence[],
  ];
}

/** A deep, detached source-sites view for one Attempt. */
export interface AssertionSourceSitesProjection {
  readonly entries: readonly AssertionSourceSitesEntry[];
  readonly sendSites: readonly AssertionSourceSendSite[];
}

export interface SourceFileProjection {
  readonly ref: SourceFileItemRef;
  readonly path: string;
  readonly text: string;
}

export interface SourcePackageProjection {
  readonly ref: SourcePackageItemRef;
  readonly label: string;
  readonly files: readonly SourceFileProjection[];
}

/** A deep, materialized Run-owned source snapshot for navigation. */
export interface SourcesProjection {
  readonly packages: readonly SourcePackageProjection[];
}

export interface AttemptSourceTreeAssemblyInput {
  readonly assertions: ProjectedSample<"attempt-slot", AssertionsSourceProjection>;
  readonly sourceSites: ProjectedSample<
    "attempt-slot",
    AssertionSourceSitesProjection
  >;
  readonly sources: ProjectedSample<"attempt-origin-run", SourcesProjection>;
}

export type AttemptSourceTreeAssemblyIssue =
  | { readonly code: "sample-mismatch" }
  | {
      readonly code: "slot-alignment-mismatch";
      readonly slotId: SlotId;
    };

export type AttemptSourceTreeAssemblyResult =
  | {
      readonly state: "assembled";
      readonly value: AttemptSourceTreeSample;
    }
  | {
      readonly state: "input-invalid";
      readonly issues: readonly [
        AttemptSourceTreeAssemblyIssue,
        ...AttemptSourceTreeAssemblyIssue[],
      ];
    };

export type AttemptSourceAssertionsAttachment = Extract<
  AttemptSlotProjectedEntry<AssertionsSourceProjection>,
  { readonly state: "attachment-result" }
>;

export type AttemptSourceSitesAttachment = Extract<
  AttemptSlotProjectedEntry<AssertionSourceSitesProjection>,
  { readonly state: "attachment-result" }
>;

export type AttemptSourcesAttachment = Extract<
  AttemptOriginRunProjectedEntry<SourcesProjection>,
  { readonly state: "attachment-result" }
>;

export type AttemptSourceTreeSlot =
  | {
      readonly state: "excluded";
      readonly slot: ExcludedAnalysisSlot;
    }
  | {
      readonly state: "not-recorded";
      readonly slot: NotRecordedAnalysisSlot;
    }
  | {
      readonly state: "core-invalid";
      readonly slot: CoreInvalidAnalysisSlot;
    }
  | {
      readonly state: "attachment-result";
      readonly slot: IncludedAnalysisSlot;
      readonly assertions: AttemptSourceAssertionsAttachment;
      readonly sourceSites: AttemptSourceSitesAttachment;
      readonly sources: AttemptSourcesAttachment;
      readonly tree: AttemptSourceTree;
    };

export interface AttemptSourceTreeSample {
  readonly sample: AnalysisSample;
  readonly slots: readonly AttemptSourceTreeSlot[];
}

export type AttemptSourceUnavailableAttachment =
  | {
      readonly attachment: "assertions";
      readonly result: Exclude<
        ProjectedRecordAttachmentResult<AssertionsSourceProjection>,
        { readonly state: "available" }
      >;
    }
  | {
      readonly attachment: "source-sites";
      readonly result: Exclude<
        ProjectedRecordAttachmentResult<AssertionSourceSitesProjection>,
        { readonly state: "available" }
      >;
    }
  | {
      readonly attachment: "sources";
      readonly result: Exclude<
        ProjectedRecordAttachmentResult<SourcesProjection>,
        { readonly state: "available" }
      >;
    };

export type AttemptSourceUnmappedReason =
  | {
      readonly code: "attachment-not-available";
      readonly attachment: AttemptSourceUnavailableAttachment;
    }
  | { readonly code: "source-sites-entry-missing" }
  | { readonly code: "source-sites-entry-orphan" }
  | { readonly code: "source-sites-entry-duplicate" }
  | { readonly code: "source-order-duplicate"; readonly sourceOrder: number }
  | {
      readonly code: "package-item-missing";
      readonly target: SourcePackageItemRef;
    }
  | {
      readonly code: "file-item-missing";
      readonly target: SourceFileItemRef;
    }
  | {
      readonly code: "file-digest-mismatch";
      readonly target: SourceFileItemRef;
    }
  | {
      readonly code: "coordinate-out-of-range";
      readonly coordinate: SourceCoordinate;
    }
  | { readonly code: "trace-malformed" };

export type AttemptSourceUnmapped =
  | {
      readonly kind: "assertion-entry";
      readonly entry: AssertionSourceEntry;
      readonly reason: AttemptSourceUnmappedReason;
    }
  | {
      readonly kind: "assertion-site";
      readonly entryId: AssertionEntryId;
      readonly site: AssertionSourceSite;
      readonly reason: AttemptSourceUnmappedReason;
    }
  | {
      readonly kind: "orphan-assertion-site";
      readonly entryId: AssertionEntryId;
      readonly site: AssertionSourceSite;
      readonly reason: AttemptSourceUnmappedReason;
    }
  | {
      readonly kind: "send";
      readonly site: AssertionSourceSendSite;
      readonly occurrence: AssertionSourceSendOccurrence;
      readonly reason: AttemptSourceUnmappedReason;
    };

export type AttemptSourceEntryUnmapped = Extract<
  AttemptSourceUnmapped,
  { readonly kind: "assertion-entry" | "assertion-site" }
>;

export type AttemptSourceUnownedUnmapped = Extract<
  AttemptSourceUnmapped,
  { readonly kind: "orphan-assertion-site" | "send" }
>;

export type AttemptSourceAnnotation =
  | {
      readonly kind: "assertion";
      readonly entryId: AssertionEntryId;
      readonly occurrence: AssertionSourceOccurrence;
    }
  | {
      readonly kind: "send";
      readonly occurrence: AssertionSourceSendOccurrence;
    };

export interface AttemptSourceTreeLine {
  readonly line: number;
  readonly text: string;
  readonly annotations: readonly AttemptSourceAnnotation[];
  readonly calls: readonly AttemptSourceTreeNode[];
}

export interface AttemptSourceFileNode {
  readonly kind: "file";
  readonly file: SourceFileProjection;
  readonly lines: readonly AttemptSourceTreeLine[];
}

export interface AttemptSourcePackageNode {
  readonly kind: "package";
  readonly package: SourcePackageProjection;
  readonly calls: readonly AttemptSourceTreeNode[];
}

export type AttemptSourceTreeNode =
  | AttemptSourceFileNode
  | AttemptSourcePackageNode;

export interface AttemptSourceTreeEntry {
  readonly entry: AssertionSourceEntry;
  readonly mappedSites: readonly AssertionSourceSite[];
  readonly unmapped: readonly AttemptSourceEntryUnmapped[];
}

export interface AttemptSourceTreeSummary {
  readonly entries: number;
  readonly results: {
    readonly matched: number;
    readonly mismatched: number;
    readonly unavailable: number;
    readonly errored: number;
    readonly notApplicable: number;
  };
  readonly score: {
    readonly earnedPoints: number;
    readonly earned: number;
    readonly unavailablePoints: number;
  };
}

export interface AttemptSourceTree {
  readonly roots: readonly AttemptSourceTreeNode[];
  readonly entries: readonly AttemptSourceTreeEntry[];
  readonly unmapped: readonly AttemptSourceUnownedUnmapped[];
  readonly summary: AttemptSourceTreeSummary;
}
