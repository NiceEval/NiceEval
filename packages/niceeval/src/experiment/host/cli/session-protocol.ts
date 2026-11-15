import { Schema } from "effect";
import {
  ExpiredSessionPayloadSchema,
  SessionRecordPayloadSchema,
  sessionRecordToJson,
  type SessionListDocument as InternalSessionListDocument,
  type SessionShowDocument as InternalSessionShowDocument,
} from "../../../runner/session.ts";
import { omitUndefined } from "../../../shared/omit-undefined.ts";

/** CLI JSON observes key omission, independently of the internal Session values. */
export const SessionListDocumentSchema = Schema.Struct({
  sessions: Schema.mutable(Schema.Array(SessionRecordPayloadSchema)),
  expired: Schema.mutable(Schema.Array(ExpiredSessionPayloadSchema)),
});

/** The `niceeval invocation list --json` payload. */
export type SessionListDocument = typeof SessionListDocumentSchema.Type;

/** CLI JSON omits expired unless the selected Session has expired. */
export const SessionShowDocumentSchema = Schema.Struct({
  session: Schema.Union([SessionRecordPayloadSchema, ExpiredSessionPayloadSchema]),
  expired: Schema.optionalKey(Schema.Boolean),
});

/** The `niceeval invocation show --json` payload. */
export type SessionShowDocument = typeof SessionShowDocumentSchema.Type;

/** Encode the internal list at the CLI JSON boundary. */
export function sessionListDocumentToJson(document: InternalSessionListDocument): SessionListDocument {
  return {
    sessions: document.sessions.map(sessionRecordToJson),
    expired: document.expired.map((session) => omitUndefined(session)),
  };
}

/** Encode the internal selection without leaking internal lifecycle tags or undefined keys. */
export function sessionShowDocumentToJson(document: InternalSessionShowDocument): SessionShowDocument {
  return omitUndefined({
    session:
      "experiments" in document.session ? sessionRecordToJson(document.session) : omitUndefined(document.session),
    expired: document.expired,
  });
}

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
