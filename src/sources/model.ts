import type { Brand } from "effect";
import type { AssertionEntryId } from "../assertions/identity.ts";
import type { RecordBlobRef } from "../record/attachment/index.ts";
import type {
  Sha256Digest,
  SourceFileItemId,
  SourcePackageItemId,
} from "./identity.ts";

/** A package-relative portable display path inside a source package. */
export const CANONICAL_SOURCE_PATH_V1_BRAND =
  "@niceeval/sources/CanonicalSourcePathV1" as const;

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
