import { createHash } from "node:crypto";
import { Either } from "effect";
import {
  assertionsAttachmentFamilyV1,
  projectAssertionsDocumentV1,
  type ThirdPartyCriterionRegistryV1,
} from "../assertions/record/index.ts";
import type {
  RecordAttachmentPayloadSnapshot,
  RecordAttachmentValue,
  RecordBlobRef,
} from "../record/attachment/index.ts";
import {
  defineRecordAttachmentProjector,
  type RecordAttachmentProjector,
} from "../projection/index.ts";
import {
  assertionSourceSitesAttachmentFamilyV1,
  sourcesAttachmentFamilyV1,
} from "./attachment.ts";
import type {
  AssertionSourceSitesDocumentV1,
  AssertionSourceSitesProjectionV1,
  AssertionSourceFrameV1,
  AssertionSourceFileFrameV1,
  AssertionSourceOccurrenceV1,
  AssertionSourceSendOccurrenceV1,
  AssertionSourceSendSiteV1,
  AssertionSourceSiteV1,
  AssertionSourceSitesEntryV1,
  AssertionSourceTraceV1,
  AssertionsSourceProjectionV1,
  SourceFileItemId,
  SourcePackageItemId,
  SourcesDocumentV1,
  SourcesProjectionV1,
} from "./model.ts";

const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true });

const noThirdPartyCriterionRegistryV1: ThirdPartyCriterionRegistryV1 = Object.freeze({
  lookup: () => undefined,
});

/**
 * The fixed source-navigation projector preserves each Assertion entry's
 * reader-local criterion state. A caller that has installed third-party
 * criterion definitions can opt into the same shape with its registry.
 */
export function createAssertionsProjectorV1(
  registry: ThirdPartyCriterionRegistryV1 = noThirdPartyCriterionRegistryV1,
): RecordAttachmentProjector<"attempt", AssertionsSourceProjectionV1> {
  return defineRecordAttachmentProjector({
    attachment: assertionsAttachmentFamilyV1,
    project: (value): AssertionsSourceProjectionV1 => Object.freeze({
      entries: Object.freeze(projectAssertionsDocumentV1(value.payload, registry).entries),
    }),
  });
}

/** Fixed, package-created source-navigation Assertions projector. */
export const assertionsProjector = createAssertionsProjectorV1();
export const assertionsProjectorV1 = assertionsProjector;

function nonEmpty<Value>(
  values: readonly Value[],
  message: string,
): readonly [Value, ...Value[]] {
  const [first, ...rest] = values;
  if (first === undefined) throw new Error(message);
  return Object.freeze([first, ...rest]);
}

function isSnapshotFileFrameV1(
  frame: RecordAttachmentPayloadSnapshot<AssertionSourceFrameV1>,
): frame is RecordAttachmentPayloadSnapshot<AssertionSourceFileFrameV1> {
  return frame.target.kind === "file";
}

function isFileFrameV1(
  frame: AssertionSourceFrameV1,
): frame is AssertionSourceFileFrameV1 {
  return frame.target.kind === "file";
}

function singletonFileFrameV1(
  frame: AssertionSourceFileFrameV1,
): readonly [AssertionSourceFileFrameV1] {
  return Object.freeze([frame]);
}

function traceFramesV1(
  first: AssertionSourceFileFrameV1,
  middle: readonly AssertionSourceFrameV1[],
  last: AssertionSourceFileFrameV1,
): readonly [
  AssertionSourceFileFrameV1,
  ...AssertionSourceFrameV1[],
  AssertionSourceFileFrameV1,
] {
  return Object.freeze([first, ...middle, last]);
}

function projectSourceFrameV1(
  frame: RecordAttachmentPayloadSnapshot<AssertionSourceFrameV1>,
): AssertionSourceFrameV1 {
  if (isSnapshotFileFrameV1(frame)) {
    return Object.freeze({
      target: Object.freeze({
        kind: "file",
        packageItemId: frame.target.packageItemId,
        fileItemId: frame.target.fileItemId,
        sha256: frame.target.sha256,
      }),
      coordinate: Object.freeze({
        line: frame.coordinate.line,
        column: frame.coordinate.column,
      }),
    });
  }
  return Object.freeze({
    target: Object.freeze({
      kind: "package",
      packageItemId: frame.target.packageItemId,
    }),
  });
}

function projectSourceTraceV1(
  trace: RecordAttachmentPayloadSnapshot<AssertionSourceTraceV1>,
): AssertionSourceTraceV1 {
  const frames = trace.frames.map(projectSourceFrameV1);
  const first = frames[0];
  const last = frames.at(-1);
  if (
    first === undefined ||
    last === undefined ||
    !isFileFrameV1(first) ||
    !isFileFrameV1(last)
  ) {
    throw new Error("Decoded assertion source trace lost its required file endpoints");
  }
  return frames.length === 1
    ? Object.freeze({ frames: singletonFileFrameV1(first) })
    : Object.freeze({ frames: traceFramesV1(first, frames.slice(1, -1), last) });
}

function projectAssertionOccurrenceV1(
  occurrence: RecordAttachmentPayloadSnapshot<AssertionSourceOccurrenceV1>,
): AssertionSourceOccurrenceV1 {
  return occurrence.role === "stop"
    ? Object.freeze({
        sourceOrder: occurrence.sourceOrder,
        role: "stop",
        outcome: occurrence.outcome,
      })
    : Object.freeze({
        sourceOrder: occurrence.sourceOrder,
        role: occurrence.role,
      });
}

function projectAssertionSourceSiteV1(
  site: RecordAttachmentPayloadSnapshot<AssertionSourceSiteV1>,
): AssertionSourceSiteV1 {
  return Object.freeze({
    trace: projectSourceTraceV1(site.trace),
    occurrences: nonEmpty(
      site.occurrences.map(projectAssertionOccurrenceV1),
      "Decoded assertion source site lost its occurrence",
    ),
  });
}

function projectSourceSitesEntryV1(
  entry: RecordAttachmentPayloadSnapshot<AssertionSourceSitesEntryV1>,
): AssertionSourceSitesEntryV1 {
  return Object.freeze({
    entryId: entry.entryId,
    sites: nonEmpty(
      entry.sites.map(projectAssertionSourceSiteV1),
      "Decoded assertion source-sites entry lost its site",
    ),
  });
}

function projectSendOccurrenceV1(
  occurrence: RecordAttachmentPayloadSnapshot<AssertionSourceSendOccurrenceV1>,
): AssertionSourceSendOccurrenceV1 {
  return Object.freeze({
    sourceOrder: occurrence.sourceOrder,
    label: occurrence.label,
    status: occurrence.status,
    durationMs: occurrence.durationMs,
  });
}

function projectSendSiteV1(
  site: RecordAttachmentPayloadSnapshot<AssertionSourceSendSiteV1>,
): AssertionSourceSendSiteV1 {
  return Object.freeze({
    trace: projectSourceTraceV1(site.trace),
    occurrences: nonEmpty(
      site.occurrences.map(projectSendOccurrenceV1),
      "Decoded assertion source send site lost its occurrence",
    ),
  });
}

function projectAssertionSourceSitesDocumentV1(
  document: RecordAttachmentPayloadSnapshot<AssertionSourceSitesDocumentV1>,
): AssertionSourceSitesDocumentV1 {
  return Object.freeze({
    entries: Object.freeze(document.entries.map(projectSourceSitesEntryV1)),
    sendSites: Object.freeze(document.sendSites.map(projectSendSiteV1)),
  });
}

/** This Attachment has no blob closure, so its exact decoded document is its neutral view. */
export const assertionSourceSitesProjector: RecordAttachmentProjector<
  "attempt",
  AssertionSourceSitesProjectionV1
> = defineRecordAttachmentProjector({
  attachment: assertionSourceSitesAttachmentFamilyV1,
  project: (value): AssertionSourceSitesProjectionV1 =>
    projectAssertionSourceSitesDocumentV1(value.payload),
});

export const assertionSourceSitesProjectorV1 = assertionSourceSitesProjector;

export type SourcesProjectionErrorV1 =
  | {
      readonly code: "source-blob-unavailable";
      readonly packageItemId: SourcePackageItemId;
      readonly fileItemId: SourceFileItemId;
    }
  | {
      readonly code: "source-blob-utf8-invalid";
      readonly packageItemId: SourcePackageItemId;
      readonly fileItemId: SourceFileItemId;
    }
  | {
      readonly code: "source-blob-line-endings-invalid";
      readonly packageItemId: SourcePackageItemId;
      readonly fileItemId: SourceFileItemId;
    }
  | {
      readonly code: "source-blob-digest-mismatch";
      readonly packageItemId: SourcePackageItemId;
      readonly fileItemId: SourceFileItemId;
    };

function sourceProjectionError(
  code: SourcesProjectionErrorV1["code"],
  packageItemId: SourcePackageItemId,
  fileItemId: SourceFileItemId,
): SourcesProjectionErrorV1 {
  return Object.freeze({ code, packageItemId, fileItemId });
}

function materializeSourceTextV1(input: {
  readonly value: RecordAttachmentValue<SourcesDocumentV1<RecordBlobRef>>;
  readonly packageItemId: SourcePackageItemId;
  readonly fileItemId: SourceFileItemId;
  readonly ref: RecordBlobRef;
  readonly expectedDigest: string;
}): Either.Either<string, SourcesProjectionErrorV1> {
  const bytes = input.value.blobs.bytes(input.ref);
  if (Either.isLeft(bytes)) {
    return Either.left(
      sourceProjectionError("source-blob-unavailable", input.packageItemId, input.fileItemId),
    );
  }
  let text: string;
  try {
    text = STRICT_UTF8.decode(bytes.right);
  } catch {
    return Either.left(
      sourceProjectionError("source-blob-utf8-invalid", input.packageItemId, input.fileItemId),
    );
  }
  if (text.includes("\r")) {
    return Either.left(
      sourceProjectionError(
        "source-blob-line-endings-invalid",
        input.packageItemId,
        input.fileItemId,
      ),
    );
  }
  const digest = createHash("sha256").update(text, "utf8").digest("hex");
  return digest === input.expectedDigest
    ? Either.right(text)
    : Either.left(
        sourceProjectionError(
          "source-blob-digest-mismatch",
          input.packageItemId,
          input.fileItemId,
        ),
      );
}

/**
 * Validates the Sources-only semantic closure that generic Record blob
 * validation cannot inspect: strict UTF-8, canonical LF, and the exact digest.
 */
export function projectSourcesAttachmentValueV1(
  value: RecordAttachmentValue<SourcesDocumentV1<RecordBlobRef>>,
): Either.Either<SourcesProjectionV1, SourcesProjectionErrorV1> {
  const packages: SourcesProjectionV1["packages"][number][] = [];
  for (const sourcePackage of value.payload.packages) {
    const files: SourcesProjectionV1["packages"][number]["files"][number][] = [];
    for (const file of sourcePackage.files) {
      const text = materializeSourceTextV1({
        value,
        packageItemId: sourcePackage.packageItemId,
        fileItemId: file.fileItemId,
        ref: file.blob,
        expectedDigest: file.sha256,
      });
      if (Either.isLeft(text)) return Either.left(text.left);
      files.push(Object.freeze({
        ref: Object.freeze({
          kind: "file" as const,
          packageItemId: sourcePackage.packageItemId,
          fileItemId: file.fileItemId,
          sha256: file.sha256,
        }),
        path: file.path,
        text: text.right,
      }));
    }
    packages.push(Object.freeze({
      ref: Object.freeze({
        kind: "package" as const,
        packageItemId: sourcePackage.packageItemId,
      }),
      label: sourcePackage.label,
      files: Object.freeze(files),
    }));
  }
  return Either.right(Object.freeze({ packages: Object.freeze(packages) }));
}

/**
 * Record integration forms `available` only after Sources closure validation.
 * This defensive check keeps an integration bug a defect instead of silently
 * presenting a substituted snapshot as a valid source tree.
 */
function requireSourcesProjectionV1(
  value: RecordAttachmentValue<SourcesDocumentV1<RecordBlobRef>>,
): SourcesProjectionV1 {
  const projected = projectSourcesAttachmentValueV1(value);
  if (Either.isLeft(projected)) {
    throw new Error(`Sources Attachment semantic validation failed: ${projected.left.code}`);
  }
  return projected.right;
}

/** Fixed Run-owned source snapshot projector; it never consults the current worktree. */
export const sourcesProjector: RecordAttachmentProjector<"run", SourcesProjectionV1> =
  defineRecordAttachmentProjector({
    attachment: sourcesAttachmentFamilyV1,
    project: requireSourcesProjectionV1,
  });

export const sourcesProjectorV1 = sourcesProjector;
