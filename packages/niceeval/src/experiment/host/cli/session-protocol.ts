import { Schema } from "effect";
import type {
  ExpiredSessionRecord,
  SessionExperimentRecord,
  SessionListDocument,
  SessionQueuedAttemptRecord,
  SessionRecord,
  SessionShowDocument,
} from "../../../runner/session.ts";
import type { InvocationCompletion } from "../../../runner/types.ts";

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
  reporterErrors: Schema.mutable(Schema.Array(Schema.Struct({
    reporter: Schema.String,
    required: Schema.Boolean,
    message: Schema.String,
  }))),
});

const SessionQueuedAttemptSchema: Schema.Codec<SessionQueuedAttemptRecord> = Schema.Struct({
  evalId: Schema.String,
  attempt: NonNegativeIntegerSchema,
  state: Schema.Literal("queued"),
  reason: Schema.Literal("provider-capacity"),
});

const SessionExperimentSchema: Schema.Codec<SessionExperimentRecord> = Schema.Struct({
  experimentId: Schema.String,
  runId: Schema.String,
  published: Schema.optional(Schema.Boolean),
  state: Schema.optional(Schema.Literals(["setup", "running", "waiting", "teardown"])),
  running: Schema.optional(NonNegativeIntegerSchema),
  queued: Schema.optional(NonNegativeIntegerSchema),
  elsewhere: Schema.optional(NonNegativeIntegerSchema),
  attempts: Schema.optional(Schema.mutable(Schema.Array(SessionQueuedAttemptSchema))),
});

const SessionRecordSchema: Schema.Codec<SessionRecord> = Schema.Struct({
  sessionId: Schema.String,
  pid: PositiveIntegerSchema,
  startedAt: TimestampSchema,
  status: Schema.Literals(["active", "completed", "incomplete", "interrupted"]),
  experiments: Schema.mutable(Schema.Array(SessionExperimentSchema)),
  heartbeatAt: Schema.optional(TimestampSchema),
  completedAt: Schema.optional(TimestampSchema),
  completion: Schema.optional(InvocationCompletionSchema),
});

const ExpiredSessionRecordSchema: Schema.Codec<ExpiredSessionRecord> = Schema.Struct({
  sessionId: Schema.String,
  pid: PositiveIntegerSchema,
  startedAt: TimestampSchema,
  heartbeatAt: Schema.optional(TimestampSchema),
});

/** The existing, unversioned `niceeval session list --json` document. */
export const SessionListDocumentSchema: Schema.Codec<SessionListDocument> = Schema.Struct({
  format: Schema.Literal("niceeval.sessions"),
  sessions: Schema.mutable(Schema.Array(SessionRecordSchema)),
  expired: Schema.mutable(Schema.Array(ExpiredSessionRecordSchema)),
});

/** The existing, unversioned `niceeval session show --json` document. */
export const SessionShowDocumentSchema: Schema.Codec<SessionShowDocument> = Schema.Struct({
  format: Schema.Literal("niceeval.session"),
  session: Schema.Union([SessionRecordSchema, ExpiredSessionRecordSchema]),
  expired: Schema.optional(Schema.Boolean),
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
