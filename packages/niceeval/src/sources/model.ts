import type { Brand } from "effect";
import type { AssertionEntryId } from "../assertions/identity.ts";
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

/** A source file delegates content representation to its caller. */
export interface SourceFile<Content> {
  readonly fileItemId: SourceFileItemId;
  readonly path: CanonicalSourcePath;
  readonly sha256: Sha256Digest;
  readonly content: Content;
}

/** A source package is a display grouping, never a cross-Run lookup key. */
export interface SourcePackage<Content> {
  readonly packageItemId: SourcePackageItemId;
  readonly label: string;
  readonly files: readonly SourceFile<Content>[];
}

/** A storage-neutral source capture document. */
export interface SourcesDocument<Content> {
  readonly packages: readonly SourcePackage<Content>[];
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
