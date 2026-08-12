import { createHash } from "node:crypto";
import { Either } from "effect";
import {
  assertionsAttachmentFamilyV1,
  projectAssertionsDocumentV1,
  type AssertionEntryReadV1,
  type ScoreContributionV1,
  type SealedAssertionResultV1,
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
} from "../projection/projector.ts";
import {
  assertionSourceSitesAttachmentFamilyV1,
  sourcesAttachmentFamilyV1,
} from "./attachment.ts";
import type {
  AssertionSourceFileFrameV1,
  AssertionSourceFrameV1,
  AssertionSourceOccurrenceV1,
  AssertionSourceSendOccurrenceV1,
  AssertionSourceSendSiteV1,
  AssertionSourceSiteV1,
  AssertionSourceSitesDocumentV1,
  AssertionSourceSitesEntryV1,
  AssertionSourceTraceV1,
  SourceFileItemId,
  SourcePackageItemId,
  SourcesDocumentV1,
} from "./model.ts";
import type {
  AssertionSourceEntry,
  AssertionSourceEntryValue,
  AssertionSourceFileFrame,
  AssertionSourceFrame,
  AssertionSourceOccurrence,
  AssertionSourceResult,
  AssertionSourceScore,
  AssertionSourceSendOccurrence,
  AssertionSourceSendSite,
  AssertionSourceSite,
  AssertionSourceSitesEntry,
  AssertionSourceSitesProjection,
  AssertionSourceTrace,
  AssertionsSourceProjection,
  SourceFileProjection,
  SourcePackageProjection,
  SourcesProjection,
} from "./projection-model.ts";

const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true });

const noThirdPartyCriterionRegistryV1: ThirdPartyCriterionRegistryV1 = Object.freeze({
  lookup: () => undefined,
});

function projectAssertionScore(value: ScoreContributionV1): AssertionSourceScore {
  switch (value.state) {
    case "not-scored":
      return Object.freeze({ state: "not-scored" });
    case "earned":
      return Object.freeze({
        state: "earned",
        points: value.points,
        earned: value.earned,
      });
    case "unavailable":
      return Object.freeze({
        state: "unavailable",
        points: value.points,
        reason: value.reason,
      });
  }
}

function projectAssertionResult(value: SealedAssertionResultV1): AssertionSourceResult {
  switch (value.state) {
    case "matched":
      return Object.freeze({
        state: "matched",
        gate: value.gate,
        score: projectAssertionScore(value.score),
      });
    case "mismatched":
      return Object.freeze({
        state: "mismatched",
        reason: value.reason,
        gate: value.gate,
        score: projectAssertionScore(value.score),
      });
    case "unavailable":
      return Object.freeze({
        state: "unavailable",
        reason: value.reason,
        gate: value.gate,
        score: projectAssertionScore(value.score),
      });
    case "errored":
      return Object.freeze({
        state: "errored",
        reason: value.reason,
        gate: value.gate,
        score: projectAssertionScore(value.score),
      });
    case "not-applicable":
      return Object.freeze({
        state: "not-applicable",
        reason: value.reason,
        gate: value.gate,
        score: projectAssertionScore(value.score),
      });
  }
}

function projectAssertionEntryValue(
  value: AssertionEntryReadV1<RecordBlobRef>["entry"],
): AssertionSourceEntryValue {
  return Object.freeze({
    entryId: value.entryId,
    display: Object.freeze({
      ...(value.display.key === undefined ? {} : { key: value.display.key }),
      ...(value.display.label === undefined ? {} : { label: value.display.label }),
      groupPath: Object.freeze([...value.display.groupPath]),
    }),
    result: projectAssertionResult(value.result),
  });
}

function projectAssertionEntry(
  value: AssertionEntryReadV1<RecordBlobRef>,
): AssertionSourceEntry {
  const entry = projectAssertionEntryValue(value.entry);
  switch (value.state) {
    case "available":
      return Object.freeze({ state: "available", entry });
    case "unsupported":
      return Object.freeze({ state: "unsupported", entry, reason: value.reason });
    case "invalid":
      return Object.freeze({ state: "invalid", entry, reason: value.reason });
  }
}

function createAssertionsProjector(
  registry: ThirdPartyCriterionRegistryV1 = noThirdPartyCriterionRegistryV1,
): RecordAttachmentProjector<"attempt", AssertionsSourceProjection> {
  return defineRecordAttachmentProjector({
    attachment: assertionsAttachmentFamilyV1,
    project: (value): AssertionsSourceProjection => {
      const projected = projectAssertionsDocumentV1(value.payload, registry);
      return Object.freeze({
        entries: Object.freeze(projected.entries.map(projectAssertionEntry)),
      });
    },
  });
}

/** Fixed, package-created source-navigation Assertions projector. */
export const assertionsProjector = createAssertionsProjector();

function nonEmpty<Value>(
  values: readonly Value[],
  message: string,
): readonly [Value, ...Value[]] {
  const [first, ...rest] = values;
  if (first === undefined) throw new Error(message);
  return Object.freeze([first, ...rest]);
}

function isSnapshotFileFrame(
  frame: RecordAttachmentPayloadSnapshot<AssertionSourceFrameV1>,
): frame is RecordAttachmentPayloadSnapshot<AssertionSourceFileFrameV1> {
  return frame.target.kind === "file";
}

function isFileFrame(
  frame: AssertionSourceFrame,
): frame is AssertionSourceFileFrame {
  return frame.target.kind === "file";
}

function singletonFileFrame(
  frame: AssertionSourceFileFrame,
): readonly [AssertionSourceFileFrame] {
  return Object.freeze([frame]);
}

function traceFrames(
  first: AssertionSourceFileFrame,
  middle: readonly AssertionSourceFrame[],
  last: AssertionSourceFileFrame,
): readonly [
  AssertionSourceFileFrame,
  ...AssertionSourceFrame[],
  AssertionSourceFileFrame,
] {
  return Object.freeze([first, ...middle, last]);
}

function projectSourceFrame(
  frame: RecordAttachmentPayloadSnapshot<AssertionSourceFrameV1>,
): AssertionSourceFrame {
  if (isSnapshotFileFrame(frame)) {
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

function projectSourceTrace(
  trace: RecordAttachmentPayloadSnapshot<AssertionSourceTraceV1>,
): AssertionSourceTrace {
  const frames = trace.frames.map(projectSourceFrame);
  const first = frames[0];
  const last = frames.at(-1);
  if (
    first === undefined ||
    last === undefined ||
    !isFileFrame(first) ||
    !isFileFrame(last)
  ) {
    throw new Error("Decoded assertion source trace lost its required file endpoints");
  }
  return frames.length === 1
    ? Object.freeze({ frames: singletonFileFrame(first) })
    : Object.freeze({ frames: traceFrames(first, frames.slice(1, -1), last) });
}

function projectAssertionOccurrence(
  occurrence: RecordAttachmentPayloadSnapshot<AssertionSourceOccurrenceV1>,
): AssertionSourceOccurrence {
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

function projectAssertionSourceSite(
  site: RecordAttachmentPayloadSnapshot<AssertionSourceSiteV1>,
): AssertionSourceSite {
  return Object.freeze({
    trace: projectSourceTrace(site.trace),
    occurrences: nonEmpty(
      site.occurrences.map(projectAssertionOccurrence),
      "Decoded assertion source site lost its occurrence",
    ),
  });
}

function projectSourceSitesEntry(
  entry: RecordAttachmentPayloadSnapshot<AssertionSourceSitesEntryV1>,
): AssertionSourceSitesEntry {
  return Object.freeze({
    entryId: entry.entryId,
    sites: nonEmpty(
      entry.sites.map(projectAssertionSourceSite),
      "Decoded assertion source-sites entry lost its site",
    ),
  });
}

function projectSendOccurrence(
  occurrence: RecordAttachmentPayloadSnapshot<AssertionSourceSendOccurrenceV1>,
): AssertionSourceSendOccurrence {
  return Object.freeze({
    sourceOrder: occurrence.sourceOrder,
    label: occurrence.label,
    status: occurrence.status,
    durationMs: occurrence.durationMs,
  });
}

function projectSendSite(
  site: RecordAttachmentPayloadSnapshot<AssertionSourceSendSiteV1>,
): AssertionSourceSendSite {
  return Object.freeze({
    trace: projectSourceTrace(site.trace),
    occurrences: nonEmpty(
      site.occurrences.map(projectSendOccurrence),
      "Decoded assertion source send site lost its occurrence",
    ),
  });
}

function projectAssertionSourceSitesDocument(
  document: RecordAttachmentPayloadSnapshot<AssertionSourceSitesDocumentV1>,
): AssertionSourceSitesProjection {
  return Object.freeze({
    entries: Object.freeze(document.entries.map(projectSourceSitesEntry)),
    sendSites: Object.freeze(document.sendSites.map(projectSendSite)),
  });
}

/** Fixed Attempt-owned source-site projector with a detached semantic view. */
export const assertionSourceSitesProjector: RecordAttachmentProjector<
  "attempt",
  AssertionSourceSitesProjection
> = defineRecordAttachmentProjector({
  attachment: assertionSourceSitesAttachmentFamilyV1,
  project: (value): AssertionSourceSitesProjection =>
    projectAssertionSourceSitesDocument(value.payload),
});

type SourcesProjectionError =
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
  code: SourcesProjectionError["code"],
  packageItemId: SourcePackageItemId,
  fileItemId: SourceFileItemId,
): SourcesProjectionError {
  return Object.freeze({ code, packageItemId, fileItemId });
}

function materializeSourceText(input: {
  readonly value: RecordAttachmentValue<SourcesDocumentV1<RecordBlobRef>>;
  readonly packageItemId: SourcePackageItemId;
  readonly fileItemId: SourceFileItemId;
  readonly ref: RecordBlobRef;
  readonly expectedDigest: string;
}): Either.Either<string, SourcesProjectionError> {
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
 * Validates Sources' semantic closure and produces a detached display view.
 * Durable schema evolution stays behind this adapter.
 */
function projectSourcesAttachmentValue(
  value: RecordAttachmentValue<SourcesDocumentV1<RecordBlobRef>>,
): Either.Either<SourcesProjection, SourcesProjectionError> {
  const packages: SourcePackageProjection[] = [];
  for (const sourcePackage of value.payload.packages) {
    const files: SourceFileProjection[] = [];
    for (const file of sourcePackage.files) {
      const text = materializeSourceText({
        value,
        packageItemId: sourcePackage.packageItemId,
        fileItemId: file.fileItemId,
        ref: file.blob,
        expectedDigest: file.sha256,
      });
      if (Either.isLeft(text)) return Either.left(text.left);
      files.push(Object.freeze({
        ref: Object.freeze({
          kind: "file",
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
        kind: "package",
        packageItemId: sourcePackage.packageItemId,
      }),
      label: sourcePackage.label,
      files: Object.freeze(files),
    }));
  }
  return Either.right(Object.freeze({ packages: Object.freeze(packages) }));
}

function requireSourcesProjection(
  value: RecordAttachmentValue<SourcesDocumentV1<RecordBlobRef>>,
): SourcesProjection {
  const projected = projectSourcesAttachmentValue(value);
  if (Either.isLeft(projected)) {
    throw new Error(`Sources Attachment semantic validation failed: ${projected.left.code}`);
  }
  return projected.right;
}

/** Fixed Run-owned source snapshot projector; it never consults the current worktree. */
export const sourcesProjector: RecordAttachmentProjector<"run", SourcesProjection> =
  defineRecordAttachmentProjector({
    attachment: sourcesAttachmentFamilyV1,
    project: requireSourcesProjection,
  });
