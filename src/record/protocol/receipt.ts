import { Effect, Schema } from "effect";
import { canonicalJsonBytes, decodeCanonicalJsonBytes } from "./canonical.ts";
import {
  decodeProtocolSchema,
  DescriptorV1Schema,
  DigestV1Schema,
  GraphRootRefV1Schema,
  JsonSafeUnsignedIntegerSchema,
  NonEmptyProtocolStringSchema,
  RecordGraphRefV1Schema,
  RecordGraphViolationSchema,
} from "./core.ts";
import {
  AttemptIdSchema,
  AttemptLocatorSchema,
  attemptLocatorOfAttemptId,
} from "./entities.ts";
import {
  recordProtocolError,
  type RecordProtocolError,
} from "./errors.ts";
import { JsonValueSchema } from "./json.ts";
import { LifecyclePhaseSchema } from "./observation.ts";

export const RecordWriteOperationSchema = Schema.Literal(
  "create-writer",
  "begin-invocation",
  "begin-run",
  "reserve-attempt",
  "write-observation",
  "write-claim",
  "adopt",
  "finish",
  "put-object",
  "renew",
  "commit",
  "abort",
  "dispose",
);

export type RecordWriteOperation = Schema.Schema.Type<
  typeof RecordWriteOperationSchema
>;

function failureMeta<Operation extends Schema.Schema.Any>(
  operation: Operation,
) {
  return {
    operation,
    retryable: Schema.Boolean,
    cause: Schema.NullOr(Schema.Defect),
  };
}

export const RecordWriteFailureSchema = Schema.Union(
  Schema.Struct({
    ...failureMeta(RecordWriteOperationSchema),
    code: Schema.Literal("record-head-conflict"),
    expected: Schema.NullOr(GraphRootRefV1Schema),
    actual: Schema.NullOr(GraphRootRefV1Schema),
  }),
  Schema.Struct({
    ...failureMeta(RecordWriteOperationSchema),
    code: Schema.Literal("record-id-mismatch"),
    expectedRecordId: NonEmptyProtocolStringSchema,
    actualRecordId: NonEmptyProtocolStringSchema,
  }),
  Schema.Struct({
    ...failureMeta(RecordWriteOperationSchema),
    code: Schema.Literal("record-writer-busy"),
    openChildren: Schema.Array(NonEmptyProtocolStringSchema),
  }),
  Schema.Struct({
    ...failureMeta(RecordWriteOperationSchema),
    code: Schema.Literal("record-writer-closed"),
  }),
  Schema.Struct({
    ...failureMeta(Schema.Literal("finish", "abort")),
    code: Schema.Literal("writer-terminal-intent-conflict"),
    frozen: Schema.Literal("finish", "abort"),
    requested: Schema.Literal("finish", "abort"),
    frozenParameters: JsonValueSchema,
    requestedParameters: JsonValueSchema,
  }),
  Schema.Struct({
    ...failureMeta(RecordWriteOperationSchema),
    code: Schema.Literal("record-lease-lost"),
    transactionId: NonEmptyProtocolStringSchema,
  }),
  Schema.Struct({
    ...failureMeta(RecordWriteOperationSchema),
    code: Schema.Literal("record-graph-invalid"),
    violations: Schema.NonEmptyArray(RecordGraphViolationSchema),
  }),
  Schema.Struct({
    ...failureMeta(Schema.Literal("put-object")),
    code: Schema.Literal("record-typed-ref-byte-conflict"),
    ref: DescriptorV1Schema,
  }),
  Schema.Struct({
    ...failureMeta(Schema.Literal("put-object")),
    code: Schema.Literal("record-digest-collision"),
    digest: DigestV1Schema,
    refs: Schema.Array(DescriptorV1Schema),
  }),
  Schema.Struct({
    ...failureMeta(RecordWriteOperationSchema),
    code: Schema.Literal(
      "record-write-missing-object",
      "record-write-unsupported-digest",
    ),
    ref: Schema.optionalWith(DescriptorV1Schema, { exact: true }),
  }),
  Schema.Struct({
    ...failureMeta(RecordWriteOperationSchema),
    code: Schema.Literal("record-write-resource-limit"),
    limit: NonEmptyProtocolStringSchema,
  }),
  Schema.Struct({
    ...failureMeta(RecordWriteOperationSchema),
    code: Schema.Literal("record-write-permission-denied"),
  }),
  Schema.Struct({
    ...failureMeta(Schema.Literal("dispose")),
    code: Schema.Literal("record-write-cleanup-failed"),
  }),
  Schema.Struct({
    ...failureMeta(RecordWriteOperationSchema),
    code: Schema.Literal(
      "record-write-unavailable",
      "record-write-io-failure",
    ),
  }),
);

export type RecordWriteFailure = Schema.Schema.Type<
  typeof RecordWriteFailureSchema
>;

export const RecordCommitSchema = Schema.Union(
  Schema.Struct({
    state: Schema.Literal("not-recorded"),
    error: RecordWriteFailureSchema,
  }),
  Schema.Struct({
    state: Schema.Literal("partial"),
    graph: RecordGraphRefV1Schema,
    error: RecordWriteFailureSchema,
    durableThrough: Schema.Struct({
      schema: NonEmptyProtocolStringSchema,
      value: JsonValueSchema,
    }),
  }),
  Schema.Struct({
    state: Schema.Literal("complete"),
    graph: RecordGraphRefV1Schema,
  }),
);

export type RecordCommit = Schema.Schema.Type<typeof RecordCommitSchema>;

export const AttemptReceiptSchema = Schema.Struct({
  invocationId: NonEmptyProtocolStringSchema,
  originRunId: NonEmptyProtocolStringSchema,
  experimentId: NonEmptyProtocolStringSchema,
  attemptId: AttemptIdSchema,
  locator: AttemptLocatorSchema,
  evalId: NonEmptyProtocolStringSchema,
  ordinal: JsonSafeUnsignedIntegerSchema,
  execution: Schema.Literal("completed", "abandoned"),
  record: RecordCommitSchema,
});

export type AttemptReceipt = Schema.Schema.Type<typeof AttemptReceiptSchema>;
export const AttemptReceiptSnapshotSchema = AttemptReceiptSchema;
export type AttemptReceiptSnapshot = AttemptReceipt;

export const RunReceiptSchema = Schema.Struct({
  invocationId: NonEmptyProtocolStringSchema,
  runId: NonEmptyProtocolStringSchema,
  experimentId: NonEmptyProtocolStringSchema,
  completion: Schema.Literal("completed", "incomplete", "interrupted"),
  record: RecordCommitSchema,
  attempts: Schema.Array(AttemptReceiptSchema),
});

export type RunReceipt = Schema.Schema.Type<typeof RunReceiptSchema>;

const NonNegativeElapsedMsSchema = Schema.JsonNumber.pipe(
  Schema.filter((value) => value >= 0, {
    identifier: "NonNegativeElapsedMs",
    description: "a finite non-negative millisecond value",
  }),
);

export const LiveSnapshotSchema = Schema.Struct({
  invocationId: NonEmptyProtocolStringSchema,
  status: Schema.Literal("active", "complete", "incomplete", "interrupted"),
  observedAt: NonEmptyProtocolStringSchema,
  elapsedMs: NonNegativeElapsedMsSchema,
  basis: Schema.Array(Schema.Struct({
    streamId: NonEmptyProtocolStringSchema,
    throughSequence: Schema.NullOr(JsonSafeUnsignedIntegerSchema),
  })),
  counters: Schema.Struct({
    total: JsonSafeUnsignedIntegerSchema,
    reused: JsonSafeUnsignedIntegerSchema,
    running: JsonSafeUnsignedIntegerSchema,
    elsewhere: JsonSafeUnsignedIntegerSchema,
    queued: JsonSafeUnsignedIntegerSchema,
    passed: JsonSafeUnsignedIntegerSchema,
    failed: JsonSafeUnsignedIntegerSchema,
    errored: JsonSafeUnsignedIntegerSchema,
    skipped: JsonSafeUnsignedIntegerSchema,
  }),
  active: Schema.Array(Schema.Struct({
    runId: NonEmptyProtocolStringSchema,
    experimentId: NonEmptyProtocolStringSchema,
    attemptId: AttemptIdSchema,
    evalId: NonEmptyProtocolStringSchema,
    ordinal: JsonSafeUnsignedIntegerSchema,
    phase: LifecyclePhaseSchema,
    detail: Schema.optionalWith(Schema.String, { exact: true }),
    elapsedMs: NonNegativeElapsedMsSchema,
    locator: AttemptLocatorSchema,
  })),
});

export type LiveSnapshot = Schema.Schema.Type<typeof LiveSnapshotSchema>;

export const InvocationReceiptSchema = Schema.Struct({
  invocationId: NonEmptyProtocolStringSchema,
  completion: Schema.Literal("complete", "incomplete", "interrupted"),
  record: RecordCommitSchema,
  runs: Schema.Array(RunReceiptSchema),
  terminalSnapshot: LiveSnapshotSchema,
});

export type InvocationReceipt = Schema.Schema.Type<
  typeof InvocationReceiptSchema
>;

function invariantError(
  operation: string,
  path: readonly string[],
  message: string,
): RecordProtocolError {
  return recordProtocolError({
    code: "receipt-invalid",
    operation,
    path,
    message,
  });
}

export function validateAttemptReceipt(
  receipt: AttemptReceipt,
): Effect.Effect<void, RecordProtocolError> {
  return attemptLocatorOfAttemptId(receipt.attemptId).pipe(
    Effect.flatMap((expected) => expected === receipt.locator
      ? Effect.void
      : Effect.fail(invariantError(
        "validate-attempt-receipt",
        ["locator"],
        "Attempt receipt locator must be the full canonical encoding of attemptId",
      ))),
  );
}

export function validateRunReceipt(
  receipt: RunReceipt,
): Effect.Effect<void, RecordProtocolError> {
  return Effect.gen(function*() {
    for (let index = 0; index < receipt.attempts.length; index += 1) {
      const attempt = receipt.attempts[index];
      if (
        attempt.invocationId !== receipt.invocationId
        || attempt.originRunId !== receipt.runId
        || attempt.experimentId !== receipt.experimentId
      ) {
        return yield* Effect.fail(invariantError(
          "validate-run-receipt",
          ["attempts", String(index)],
          "Attempt receipt identity must agree with its containing Run receipt",
        ));
      }
      yield* validateAttemptReceipt(attempt);
    }
  });
}

export function validateLiveSnapshot(
  snapshot: LiveSnapshot,
): Effect.Effect<void, RecordProtocolError> {
  const counters = snapshot.counters;
  const expected = counters.reused
    + counters.running
    + counters.elsewhere
    + counters.queued
    + counters.passed
    + counters.failed
    + counters.errored
    + counters.skipped;
  if (!Number.isSafeInteger(expected) || expected !== counters.total) {
    return Effect.fail(invariantError(
      "validate-live-snapshot",
      ["counters", "total"],
      "Live counters must satisfy the frozen total equation without integer overflow",
    ));
  }
  return Effect.gen(function*() {
    for (let index = 0; index < snapshot.active.length; index += 1) {
      const active = snapshot.active[index];
      const expectedLocator = yield* attemptLocatorOfAttemptId(active.attemptId);
      if (expectedLocator !== active.locator) {
        return yield* Effect.fail(invariantError(
          "validate-live-snapshot",
          ["active", String(index), "locator"],
          "Active Attempt locator must encode the listed attemptId",
        ));
      }
    }
  });
}

export function validateInvocationReceipt(
  receipt: InvocationReceipt,
): Effect.Effect<void, RecordProtocolError> {
  return Effect.gen(function*() {
    if (
      receipt.terminalSnapshot.invocationId !== receipt.invocationId
      || receipt.terminalSnapshot.status !== receipt.completion
    ) {
      return yield* Effect.fail(invariantError(
        "validate-invocation-receipt",
        ["terminalSnapshot"],
        "Terminal snapshot identity and status must match the Invocation receipt",
      ));
    }
    yield* validateLiveSnapshot(receipt.terminalSnapshot);
    for (let index = 0; index < receipt.runs.length; index += 1) {
      const run = receipt.runs[index];
      if (run.invocationId !== receipt.invocationId) {
        return yield* Effect.fail(invariantError(
          "validate-invocation-receipt",
          ["runs", String(index), "invocationId"],
          "Run receipt must belong to the containing Invocation",
        ));
      }
      yield* validateRunReceipt(run);
    }
  });
}

export function encodeInvocationReceiptBytes(
  input: unknown,
): Effect.Effect<Uint8Array, RecordProtocolError> {
  return Effect.gen(function*() {
    const receipt = yield* decodeProtocolSchema(
      InvocationReceiptSchema,
      input,
      "encode-invocation-receipt",
    );
    yield* validateInvocationReceipt(receipt);
    const encoded = yield* Schema.encodeUnknown(InvocationReceiptSchema, {
      errors: "all",
      onExcessProperty: "error",
    })(receipt).pipe(
      Effect.mapError((cause) => invariantError(
        "encode-invocation-receipt",
        [],
        String(cause),
      )),
    );
    return yield* canonicalJsonBytes(encoded);
  });
}

export function decodeInvocationReceiptBytes(
  input: unknown,
): Effect.Effect<InvocationReceipt, RecordProtocolError> {
  return Effect.gen(function*() {
    const json = yield* decodeCanonicalJsonBytes(input);
    const receipt = yield* decodeProtocolSchema(
      InvocationReceiptSchema,
      json,
      "decode-invocation-receipt",
    );
    yield* validateInvocationReceipt(receipt);
    return receipt;
  });
}
