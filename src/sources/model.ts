import type { Brand } from "effect";
import type {
  AssertionEntryId,
  AssertionEntryReadV1,
} from "../assertions/record/model.ts";
import type { RecordBlobRef } from "../record/attachment/index.ts";
import type { SlotId } from "../record/model/identifiers.ts";
import type {
  AttemptOriginRunProjectedEntry,
  AttemptSlotProjectedEntry,
  ProjectedRecordAttachmentResult,
  ProjectedSample,
} from "../projection/index.ts";
import type {
  AnalysisSample,
  CoreInvalidAnalysisSlot,
  ExcludedAnalysisSlot,
  IncludedAnalysisSlot,
  NotRecordedAnalysisSlot,
} from "../sample/index.ts";

/** Opaque manifest identity for one package in one Run-owned Sources snapshot. */
export const SOURCE_PACKAGE_ITEM_ID_BRAND =
  "@niceeval/sources/SourcePackageItemId" as const;

/** Opaque manifest identity for one file inside one package item. */
export const SOURCE_FILE_ITEM_ID_BRAND =
  "@niceeval/sources/SourceFileItemId" as const;

/** A lower-case SHA-256 hex digest of canonical UTF-8 source text. */
export const SHA256_DIGEST_BRAND = "@niceeval/sources/Sha256Digest" as const;

/** A package-relative portable display path inside a source package. */
export const CANONICAL_SOURCE_PATH_V1_BRAND =
  "@niceeval/sources/CanonicalSourcePathV1" as const;

export type SourcePackageItemId = string & Brand.Brand<typeof SOURCE_PACKAGE_ITEM_ID_BRAND>;
export type SourceFileItemId = string & Brand.Brand<typeof SOURCE_FILE_ITEM_ID_BRAND>;
export type Sha256Digest = string & Brand.Brand<typeof SHA256_DIGEST_BRAND>;
export type CanonicalSourcePathV1 =
  string & Brand.Brand<typeof CANONICAL_SOURCE_PATH_V1_BRAND>;

export interface SourcePackageItemRefV1 {
  readonly kind: "package";
  readonly packageItemId: SourcePackageItemId;
}

export interface SourceFileItemRefV1 {
  readonly kind: "file";
  readonly packageItemId: SourcePackageItemId;
  readonly fileItemId: SourceFileItemId;
  readonly sha256: Sha256Digest;
}

/** A persisted source file carries its bytes only through this Attachment's closure. */
export interface SourceFileV1<BlobRef = RecordBlobRef> {
  readonly fileItemId: SourceFileItemId;
  readonly path: CanonicalSourcePathV1;
  readonly sha256: Sha256Digest;
  readonly blob: BlobRef;
}

/** A source package is a display grouping, never a cross-Run lookup key. */
export interface SourcePackageV1<BlobRef = RecordBlobRef> {
  readonly packageItemId: SourcePackageItemId;
  readonly label: string;
  readonly files: readonly SourceFileV1<BlobRef>[];
}

/** The Run-owned durable Sources payload. */
export interface SourcesDocumentV1<BlobRef = RecordBlobRef> {
  readonly packages: readonly SourcePackageV1<BlobRef>[];
}

export interface SourceCoordinateV1 {
  readonly line: number;
  readonly column: number;
}

export interface AssertionSourcePackageFrameV1 {
  readonly target: SourcePackageItemRefV1;
}

export interface AssertionSourceFileFrameV1 {
  readonly target: SourceFileItemRefV1;
  readonly coordinate: SourceCoordinateV1;
}

export type AssertionSourceFrameV1 =
  | AssertionSourcePackageFrameV1
  | AssertionSourceFileFrameV1;

export interface AssertionSourceTraceV1 {
  readonly frames:
    | readonly [AssertionSourceFileFrameV1]
    | readonly [
        AssertionSourceFileFrameV1,
        ...AssertionSourceFrameV1[],
        AssertionSourceFileFrameV1,
      ];
}

export type AssertionSourceRoleV1 =
  | "declaration"
  | "threshold"
  | "score"
  | "gate"
  | "optional"
  | "stop";

export type AssertionSourceOccurrenceV1 =
  | {
      readonly sourceOrder: number;
      readonly role: Exclude<AssertionSourceRoleV1, "stop">;
    }
  | {
      readonly sourceOrder: number;
      readonly role: "stop";
      readonly outcome: "continued" | "stopped" | "interrupted";
    };

export interface AssertionSourceSiteV1 {
  readonly trace: AssertionSourceTraceV1;
  readonly occurrences: readonly [
    AssertionSourceOccurrenceV1,
    ...AssertionSourceOccurrenceV1[],
  ];
}

export interface AssertionSourceSitesEntryV1 {
  readonly entryId: AssertionEntryId;
  readonly sites: readonly [AssertionSourceSiteV1, ...AssertionSourceSiteV1[]];
}

export type AssertionSourceSendStatusV1 =
  | "completed"
  | "failed"
  | "interrupted";

export interface AssertionSourceSendOccurrenceV1 {
  readonly sourceOrder: number;
  readonly label: string;
  readonly status: AssertionSourceSendStatusV1;
  readonly durationMs: number;
}

export interface AssertionSourceSendSiteV1 {
  readonly trace: AssertionSourceTraceV1;
  readonly occurrences: readonly [
    AssertionSourceSendOccurrenceV1,
    ...AssertionSourceSendOccurrenceV1[],
  ];
}

/** The Attempt-owned semantic join to the exact origin Run Sources snapshot. */
export interface AssertionSourceSitesDocumentV1 {
  readonly entries: readonly AssertionSourceSitesEntryV1[];
  readonly sendSites: readonly AssertionSourceSendSiteV1[];
}

/** A projector never leaks its blob capability into a source-navigation value. */
export interface AssertionsSourceProjectionV1 {
  readonly entries: readonly AssertionEntryReadV1<RecordBlobRef>[];
}

export type AssertionSourceSitesProjectionV1 = AssertionSourceSitesDocumentV1;

export interface SourceFileProjectionV1 {
  readonly ref: SourceFileItemRefV1;
  readonly path: string;
  readonly text: string;
}

export interface SourcePackageProjectionV1 {
  readonly ref: SourcePackageItemRefV1;
  readonly label: string;
  readonly files: readonly SourceFileProjectionV1[];
}

export interface SourcesProjectionV1 {
  readonly packages: readonly SourcePackageProjectionV1[];
}

export interface AttemptSourceTreeAssemblyInputV1 {
  readonly assertions: ProjectedSample<"attempt-slot", AssertionsSourceProjectionV1>;
  readonly sourceSites: ProjectedSample<
    "attempt-slot",
    AssertionSourceSitesProjectionV1
  >;
  readonly sources: ProjectedSample<"attempt-origin-run", SourcesProjectionV1>;
}

export type AttemptSourceTreeAssemblyIssueV1 =
  | { readonly code: "sample-mismatch" }
  | {
      readonly code: "slot-alignment-mismatch";
      readonly slotId: SlotId;
    };

export type AttemptSourceTreeAssemblyResultV1 =
  | {
      readonly state: "assembled";
      readonly value: AttemptSourceTreeSampleV1;
    }
  | {
      readonly state: "input-invalid";
      readonly issues: readonly [
        AttemptSourceTreeAssemblyIssueV1,
        ...AttemptSourceTreeAssemblyIssueV1[],
      ];
    };

export type AttemptSourceAssertionsAttachmentV1 = Extract<
  AttemptSlotProjectedEntry<AssertionsSourceProjectionV1>,
  { readonly state: "attachment-result" }
>;

export type AttemptSourceSitesAttachmentV1 = Extract<
  AttemptSlotProjectedEntry<AssertionSourceSitesProjectionV1>,
  { readonly state: "attachment-result" }
>;

export type AttemptSourcesAttachmentV1 = Extract<
  AttemptOriginRunProjectedEntry<SourcesProjectionV1>,
  { readonly state: "attachment-result" }
>;

export type AttemptSourceTreeSlotV1 =
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
      readonly assertions: AttemptSourceAssertionsAttachmentV1;
      readonly sourceSites: AttemptSourceSitesAttachmentV1;
      readonly sources: AttemptSourcesAttachmentV1;
      readonly tree: AttemptSourceTreeV1;
    };

export interface AttemptSourceTreeSampleV1 {
  readonly sample: AnalysisSample;
  readonly slots: readonly AttemptSourceTreeSlotV1[];
}

export type AttemptSourceUnavailableAttachmentV1 =
  | {
      readonly attachment: "assertions";
      readonly result: Exclude<
        ProjectedRecordAttachmentResult<AssertionsSourceProjectionV1>,
        { readonly state: "available" }
      >;
    }
  | {
      readonly attachment: "source-sites";
      readonly result: Exclude<
        ProjectedRecordAttachmentResult<AssertionSourceSitesProjectionV1>,
        { readonly state: "available" }
      >;
    }
  | {
      readonly attachment: "sources";
      readonly result: Exclude<
        ProjectedRecordAttachmentResult<SourcesProjectionV1>,
        { readonly state: "available" }
      >;
    };

export type AttemptSourceUnmappedReasonV1 =
  | {
      readonly code: "attachment-not-available";
      readonly attachment: AttemptSourceUnavailableAttachmentV1;
    }
  | { readonly code: "source-sites-entry-missing" }
  | { readonly code: "source-sites-entry-orphan" }
  | { readonly code: "source-sites-entry-duplicate" }
  | { readonly code: "source-order-duplicate"; readonly sourceOrder: number }
  | {
      readonly code: "package-item-missing";
      readonly target: SourcePackageItemRefV1;
    }
  | {
      readonly code: "file-item-missing";
      readonly target: SourceFileItemRefV1;
    }
  | {
      readonly code: "file-digest-mismatch";
      readonly target: SourceFileItemRefV1;
    }
  | {
      readonly code: "coordinate-out-of-range";
      readonly coordinate: SourceCoordinateV1;
    }
  | { readonly code: "trace-malformed" };

export type AttemptSourceUnmappedV1 =
  | {
      readonly kind: "assertion-entry";
      readonly entry: AssertionEntryReadV1<RecordBlobRef>;
      readonly reason: AttemptSourceUnmappedReasonV1;
    }
  | {
      readonly kind: "assertion-site";
      readonly entryId: AssertionEntryId;
      readonly site: AssertionSourceSiteV1;
      readonly reason: AttemptSourceUnmappedReasonV1;
    }
  | {
      readonly kind: "orphan-assertion-site";
      readonly entryId: AssertionEntryId;
      readonly site: AssertionSourceSiteV1;
      readonly reason: AttemptSourceUnmappedReasonV1;
    }
  | {
      readonly kind: "send";
      readonly site: AssertionSourceSendSiteV1;
      readonly occurrence: AssertionSourceSendOccurrenceV1;
      readonly reason: AttemptSourceUnmappedReasonV1;
    };

export type AttemptSourceEntryUnmappedV1 = Extract<
  AttemptSourceUnmappedV1,
  { readonly kind: "assertion-entry" | "assertion-site" }
>;

export type AttemptSourceUnownedUnmappedV1 = Extract<
  AttemptSourceUnmappedV1,
  { readonly kind: "orphan-assertion-site" | "send" }
>;

export type AttemptSourceAnnotationV1 =
  | {
      readonly kind: "assertion";
      readonly entryId: AssertionEntryId;
      readonly occurrence: AssertionSourceOccurrenceV1;
    }
  | {
      readonly kind: "send";
      readonly occurrence: AssertionSourceSendOccurrenceV1;
    };

export interface AttemptSourceTreeLineV1 {
  readonly line: number;
  readonly text: string;
  readonly annotations: readonly AttemptSourceAnnotationV1[];
  readonly calls: readonly AttemptSourceTreeNodeV1[];
}

export interface AttemptSourceFileNodeV1 {
  readonly kind: "file";
  readonly file: SourceFileProjectionV1;
  readonly lines: readonly AttemptSourceTreeLineV1[];
}

export interface AttemptSourcePackageNodeV1 {
  readonly kind: "package";
  readonly package: SourcePackageProjectionV1;
  readonly calls: readonly AttemptSourceTreeNodeV1[];
}

export type AttemptSourceTreeNodeV1 =
  | AttemptSourceFileNodeV1
  | AttemptSourcePackageNodeV1;

export interface AttemptSourceTreeEntryV1 {
  readonly entry: AssertionEntryReadV1<RecordBlobRef>;
  readonly mappedSites: readonly AssertionSourceSiteV1[];
  readonly unmapped: readonly AttemptSourceEntryUnmappedV1[];
}

export interface AttemptSourceTreeSummaryV1 {
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

export interface AttemptSourceTreeV1 {
  readonly roots: readonly AttemptSourceTreeNodeV1[];
  readonly entries: readonly AttemptSourceTreeEntryV1[];
  readonly unmapped: readonly AttemptSourceUnownedUnmappedV1[];
  readonly summary: AttemptSourceTreeSummaryV1;
}
