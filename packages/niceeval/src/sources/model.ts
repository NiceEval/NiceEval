import type { Brand } from "effect";
import type { AssertionEntryId } from "../assertions/identity.ts";
import type { RecordBlobRef } from "../record/attachment/index.ts";
import type {
  Sha256Digest,
  SourceFileItemId,
  SourcePackageItemId,
} from "./identity.ts";

/** A package-relative portable display path inside a source package. */
export const CANONICAL_SOURCE_PATH__BRAND =
  "@niceeval/sources/CanonicalSourcePath" as const;

export type CanonicalSourcePath =
  string & Brand.Brand<typeof CANONICAL_SOURCE_PATH__BRAND>;

export interface SourcePackageItemRef {
  readonly kind: "package";
  readonly packageItemId: SourcePackageItemId;
}

export interface SourceFileItemRef {
  readonly kind: "file";
  readonly packageItemId: SourcePackageItemId;
  readonly fileItemId: SourceFileItemId;
  readonly sha256: Sha256Digest;
}

/** A persisted source file carries its bytes only through this Attachment's closure. */
export interface SourceFile<BlobRef = RecordBlobRef> {
  readonly fileItemId: SourceFileItemId;
  readonly path: CanonicalSourcePath;
  readonly sha256: Sha256Digest;
  readonly blob: BlobRef;
}

/** A source package is a display grouping, never a cross-Run lookup key. */
export interface SourcePackage<BlobRef = RecordBlobRef> {
  readonly packageItemId: SourcePackageItemId;
  readonly label: string;
  readonly files: readonly SourceFile<BlobRef>[];
}

/** The Run-owned durable Sources payload. */
export interface SourcesDocument<BlobRef = RecordBlobRef> {
  readonly packages: readonly SourcePackage<BlobRef>[];
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

/** The Attempt-owned semantic join to the exact origin Run Sources snapshot. */
export interface AssertionSourceSitesDocument {
  readonly entries: readonly AssertionSourceSitesEntry[];
  readonly sendSites: readonly AssertionSourceSendSite[];
}
