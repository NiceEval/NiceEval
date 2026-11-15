import { SessionActiveAttemptsSchema } from "../../../runner/session.ts";
import { Effect, Schema } from "effect";
import type {
  ExpiredSessionRecord,
  SessionExperimentRecord,
  SessionListDocument,
  SessionQueuedAttemptRecord,
  SessionRecord,
  SessionShowDocument,
} from "../../../runner/session.ts";
import type { InvocationCompletion } from "../../../runner/types.ts";

function optionalFact<S extends Schema.Constraint>(schema: S) {
  return Schema.UndefinedOr(schema).pipe(Schema.withDecodingDefault(Effect.succeed(undefined)));
}

const NonNegativeIntegerSchema = Schema.Number.pipe(
  Schema.check(Schema.makeFilter((value) => Number.isSafeInteger(value) && value >= 0)),
);
const PositiveIntegerSchema = Schema.Number.pipe(
  Schema.check(Schema.makeFilter((value) => Number.isSafeInteger(value) && value > 0)),
);
const TimestampSchema = Schema.String.pipe(
  Schema.check(Schema.makeFilter((value) => Number.isFinite(Date.parse(value)))),
);

const InvocationCompletionSchema: Schema.Codec<InvocationCompletion> = Schema.Struct({
  status: Schema.Literals(["complete", "incomplete", "interrupted"]),
  unstarted: NonNegativeIntegerSchema,
  earlyExitUnstarted: NonNegativeIntegerSchema,
  reporterErrors: Schema.mutable(
    Schema.Array(
      Schema.Struct({
        reporter: Schema.String,
        required: Schema.Boolean,
        message: Schema.String,
      }),
    ),
  ),
});

const SessionQueuedAttemptSchema: Schema.Codec<SessionQueuedAttemptRecord> = Schema.Struct({
  evalId: Schema.String,
  attempt: NonNegativeIntegerSchema,
  state: Schema.Literal("queued"),
  reason: Schema.Literal("provider-capacity"),
});

const SessionExperimentSchema: Schema.Codec<SessionExperimentRecord, unknown> = Schema.Struct({
  experimentId: Schema.String,
  runId: Schema.String,
  published: optionalFact(Schema.Boolean),
  state: optionalFact(Schema.Literals(["setup", "running", "waiting", "teardown"])),
  running: optionalFact(NonNegativeIntegerSchema),
  queued: optionalFact(NonNegativeIntegerSchema),
  elsewhere: optionalFact(NonNegativeIntegerSchema),
  activeAttempts: optionalFact(SessionActiveAttemptsSchema),
  attempts: optionalFact(Schema.mutable(Schema.Array(SessionQueuedAttemptSchema))),
});

const SessionRecordFields = {
  sessionId: Schema.String,
  pid: PositiveIntegerSchema,
  startedAt: TimestampSchema,
};
const SessionRecordSchema: Schema.Codec<SessionRecord, unknown> = Schema.Union([
  Schema.Struct({
    ...SessionRecordFields,
    status: Schema.Literal("active"),
    experiments: Schema.mutable(Schema.Array(SessionExperimentSchema)),
    heartbeatAt: optionalFact(TimestampSchema),
  }),
  Schema.Struct({
    ...SessionRecordFields,
    status: Schema.Literals(["completed", "incomplete", "interrupted"]),
    experiments: Schema.mutable(Schema.Array(SessionExperimentSchema)),
    completedAt: optionalFact(TimestampSchema),
    completion: optionalFact(InvocationCompletionSchema),
  }),
]);

const ExpiredSessionRecordSchema: Schema.Codec<ExpiredSessionRecord, unknown> = Schema.Struct({
  sessionId: Schema.String,
  pid: PositiveIntegerSchema,
  startedAt: TimestampSchema,
  heartbeatAt: optionalFact(TimestampSchema),
});

/** The `niceeval session list --json` document. */
export const SessionListDocumentSchema: Schema.Codec<SessionListDocument, unknown> = Schema.Struct({
  sessions: Schema.mutable(Schema.Array(SessionRecordSchema)),
  expired: Schema.mutable(Schema.Array(ExpiredSessionRecordSchema)),
});

/** The `niceeval session show --json` document. */
export const SessionShowDocumentSchema: Schema.Codec<SessionShowDocument, unknown> = Schema.Struct({
  session: Schema.Union([SessionRecordSchema, ExpiredSessionRecordSchema]),
  expired: optionalFact(Schema.Boolean),
});

/** Strictly decode the sole document written by `niceeval session list --json`. */
export function decodeSessionListDocument(input: unknown): SessionListDocument {
  return Schema.decodeUnknownSync(SessionListDocumentSchema, {
    errors: "all",
    onExcessProperty: "error",
  })(input);
}

/** Strictly decode the sole document written by `niceeval session show --json`. */
export function decodeSessionShowDocument(input: unknown): SessionShowDocument {
  return Schema.decodeUnknownSync(SessionShowDocumentSchema, {
    errors: "all",
    onExcessProperty: "error",
  })(input);
}
