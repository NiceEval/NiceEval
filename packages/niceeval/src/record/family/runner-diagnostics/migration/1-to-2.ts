import { Effect, Either, Schema } from "effect";

import {
  defineRecordMigration,
  recordAttachmentIssue,
  type RecordAttachmentIssue,
  type RecordMigrationDocument,
} from "../../../attachment/index.ts";
import { RecordExactParseOptions } from "../../../codec/core.ts";
import {
  Sha256DigestSchema,
  SourceItemIdSchema,
} from "../../../codec/identifiers.ts";
import {
  EmptyArraySchema,
  PositiveSafeIntegerSchema,
  SafeIdentifierSchema,
  SafeTextSchema,
} from "../../common.ts";
import { TurnIdSchema } from "../../source-receipt/codec.ts";
import {
  SourceReceiptStageSchema,
  SourceSegmentIdSchema,
  hasCanonicalSourceSegments,
} from "../../source-receipt/index.ts";
import { sourcesRecordAttachment } from "../../sources/definition.ts";

const HistoricalSourceRetentionTargetSchema = Schema.Literal(
  "turn",
  "turn-item",
  "usage-observation",
  "turn-context",
  "command",
  "stdout",
  "stderr",
  "activity",
  "diagnostic",
  "diagnostic-cause",
  "payload-byte",
  "blob-byte",
);

const HistoricalSourceReceiptLimitationSchema = Schema.Union(
  Schema.Struct({
    code: Schema.Literal("capture-failed", "capture-interrupted"),
    stage: SourceReceiptStageSchema,
    target: HistoricalSourceRetentionTargetSchema,
  }),
  Schema.Struct({
    code: Schema.Literal("collection-cap-reached", "unsupported-input"),
    target: HistoricalSourceRetentionTargetSchema,
    omittedAtLeast: PositiveSafeIntegerSchema,
  }),
  Schema.Struct({
    code: Schema.Literal(
      "text-truncated",
      "redacted",
      "invalid-utf8-replaced",
      "unsafe-control-stripped",
    ),
    target: HistoricalSourceRetentionTargetSchema,
    replacementOrOmittedCount: PositiveSafeIntegerSchema,
  }),
);

type HistoricalSourceReceiptLimitation =
  typeof HistoricalSourceReceiptLimitationSchema.Type;

function limitationKey(value: object): string {
  return JSON.stringify(value);
}

function canonicalLimitations(
  values: readonly HistoricalSourceReceiptLimitation[],
): boolean {
  let previous: string | undefined;
  const seen = new Set<string>();
  for (const value of values) {
    const key = limitationKey(value);
    if (seen.has(key) || previous !== undefined && previous >= key) return false;
    seen.add(key);
    previous = key;
  }
  return true;
}

const HistoricalSourceReceiptCollectionSchema = Schema.Union(
  Schema.Struct({
    state: Schema.Literal("complete"),
    limitations: EmptyArraySchema,
  }),
  Schema.Struct({
    state: Schema.Literal("partial"),
    limitations: Schema.NonEmptyArray(HistoricalSourceReceiptLimitationSchema).pipe(
      Schema.filter(canonicalLimitations),
    ),
  }),
);

const HistoricalSourcePositionSchema = Schema.Struct({
  line: PositiveSafeIntegerSchema,
  column: PositiveSafeIntegerSchema,
});

const HistoricalSourceFrameSchema = Schema.Struct({
  sourceItemId: SourceItemIdSchema,
  sha256: Sha256DigestSchema,
  start: HistoricalSourcePositionSchema,
  end: HistoricalSourcePositionSchema,
});

const HistoricalDiagnosticBase = {
  segmentId: SourceSegmentIdSchema,
  diagnosticId: SafeIdentifierSchema,
  sequence: PositiveSafeIntegerSchema,
  turnId: Schema.NullOr(TurnIdSchema),
  kind: Schema.Literal("advisory", "execution-error"),
  code: SafeIdentifierSchema,
  summary: SafeTextSchema,
  causes: Schema.Array(
    Schema.Struct({ code: SafeIdentifierSchema, summary: SafeTextSchema }),
  ),
  redaction: Schema.Union(
    Schema.Struct({ state: Schema.Literal("none") }),
    Schema.Struct({
      state: Schema.Literal("applied"),
      replacements: PositiveSafeIntegerSchema,
    }),
  ),
  sourceFrame: Schema.NullOr(HistoricalSourceFrameSchema),
} as const;

const HistoricalAttemptRunnerDiagnosticReceiptSchema = Schema.Struct({
  ...HistoricalDiagnosticBase,
  phase: Schema.Literal(
    "attempt.setup",
    "sandbox.prepare",
    "agent.ensure",
    "eval.run",
    "agent.send",
    "sandbox.command",
    "assertion.evaluate",
    "verdict.fold",
    "attempt.teardown",
  ),
});

const HistoricalRunRunnerDiagnosticReceiptSchema = Schema.Struct({
  ...HistoricalDiagnosticBase,
  phase: Schema.Literal(
    "run.setup",
    "run.discovery",
    "run.plan",
    "run.dispatch",
    "run.teardown",
  ),
});

const AttemptRunnerDiagnosticsRevision1Schema = Schema.Struct({
  collection: Schema.propertySignature(HistoricalSourceReceiptCollectionSchema).pipe(
    Schema.fromKey("collection-data"),
  ),
  segments: Schema.propertySignature(
    Schema.Array(HistoricalAttemptRunnerDiagnosticReceiptSchema),
  ).pipe(Schema.fromKey("segments-data")),
});

const RunRunnerDiagnosticsRevision1Schema = Schema.Struct({
  collection: Schema.propertySignature(HistoricalSourceReceiptCollectionSchema).pipe(
    Schema.fromKey("collection-data"),
  ),
  segments: Schema.propertySignature(
    Schema.Array(HistoricalRunRunnerDiagnosticReceiptSchema),
  ).pipe(Schema.fromKey("segments-data")),
});

type AttemptRunnerDiagnosticsRevision1 =
  typeof AttemptRunnerDiagnosticsRevision1Schema.Type;
type RunRunnerDiagnosticsRevision1 = typeof RunRunnerDiagnosticsRevision1Schema.Type;
type RunnerDiagnosticsRevision1 =
  | { readonly owner: "attempt"; readonly value: AttemptRunnerDiagnosticsRevision1 }
  | { readonly owner: "run"; readonly value: RunRunnerDiagnosticsRevision1 };

function currentLimitation(limitation: HistoricalSourceReceiptLimitation) {
  if (limitation.target === "payload-byte") {
    return Object.freeze({ ...limitation, target: "value-byte" as const });
  }
  if (limitation.target === "blob-byte") {
    return Object.freeze({ ...limitation, target: "content-byte" as const });
  }
  return limitation;
}

function currentCollection(
  collection: AttemptRunnerDiagnosticsRevision1["collection"],
) {
  if (collection.state === "complete") return collection;
  return Object.freeze({
    ...collection,
    limitations: Object.freeze(
      collection.limitations
        .map(currentLimitation)
        .sort((left, right) => {
          const leftKey = limitationKey(left);
          const rightKey = limitationKey(right);
          return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
        }),
    ),
  });
}

function invalid(path: readonly string[] = []): RecordAttachmentIssue {
  return recordAttachmentIssue("record-attachment-schema-invalid", path);
}

function validateRevision1(
  value: AttemptRunnerDiagnosticsRevision1 | RunRunnerDiagnosticsRevision1,
): RecordAttachmentIssue | undefined {
  if (!hasCanonicalSourceSegments(value.segments)) return invalid(["segments"]);
  const diagnosticIds = new Set<string>();
  for (const [index, diagnostic] of value.segments.entries()) {
    if (diagnosticIds.has(diagnostic.diagnosticId)) {
      return invalid(["segments", String(index), "diagnosticId"]);
    }
    diagnosticIds.add(diagnostic.diagnosticId);
    const frame = diagnostic.sourceFrame;
    if (
      frame !== null &&
      (frame.start.line > frame.end.line ||
        frame.start.line === frame.end.line && frame.start.column > frame.end.column)
    ) {
      return invalid(["segments", String(index), "sourceFrame"]);
    }
  }
  for (const [index, limitation] of currentCollection(value.collection).limitations.entries()) {
    if (
      (limitation.code === "capture-failed" || limitation.code === "capture-interrupted") &&
        limitation.stage !== "runner-diagnostic-sink" &&
        limitation.stage !== "attempt-finalizer" &&
        limitation.stage !== "run-teardown" ||
      !["diagnostic", "diagnostic-cause", "value-byte"].includes(limitation.target)
    ) {
      return invalid(["collection", "limitations", String(index)]);
    }
  }
  return undefined;
}

function parseRunnerDiagnosticsRevision1(
  document: RecordMigrationDocument,
): Either.Either<RunnerDiagnosticsRevision1, RecordAttachmentIssue> {
  if (document.contents.length !== 0) return Either.left(invalid());
  const attempt = Schema.decodeUnknownEither(
    AttemptRunnerDiagnosticsRevision1Schema,
    RecordExactParseOptions,
  )(document.value);
  if (Either.isRight(attempt) && validateRevision1(attempt.right) === undefined) {
    return Either.right(Object.freeze({ owner: "attempt" as const, value: attempt.right }));
  }
  const run = Schema.decodeUnknownEither(
    RunRunnerDiagnosticsRevision1Schema,
    RecordExactParseOptions,
  )(document.value);
  if (Either.isLeft(run)) return Either.left(invalid());
  const issue = validateRevision1(run.right);
  return issue === undefined
    ? Either.right(Object.freeze({ owner: "run" as const, value: run.right }))
    : Either.left(issue);
}

export const runnerDiagnosticsV1ToV2 = defineRecordMigration({
  from: 1,
  to: 2,
  parse: parseRunnerDiagnosticsRevision1,
  migrate: ({ value: previous, build }) => {
    const references: ReturnType<typeof build.reference.to>[] = [];
    const segments = previous.value.segments.map((diagnostic) => {
      if (diagnostic.sourceFrame === null) return diagnostic;
      const sourceFrame = build.reference.to(
        sourcesRecordAttachment,
        diagnostic.sourceFrame,
      );
      references.push(sourceFrame);
      return Object.freeze({ ...diagnostic, sourceFrame });
    });
    return Effect.succeed(Object.freeze({
      value: Object.freeze({
        collection: currentCollection(previous.value.collection),
        segments: Object.freeze(segments),
      }),
      references: Object.freeze(references),
      impact: Object.freeze([]),
    }));
  },
});
