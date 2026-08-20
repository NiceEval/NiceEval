import { Schema } from "effect";
import type { ProcessReceipt } from "./process.js";
import {
  decodeShowSchema,
  NonEmptyStringSchema,
  ShowAttemptEnvelopeFields,
} from "./show-schema.js";

const ShowAttemptDiagnosticOutputSchema = Schema.Struct({
  code: NonEmptyStringSchema,
  kind: NonEmptyStringSchema,
  phase: NonEmptyStringSchema,
  summary: Schema.String,
});

const ShowAttemptDiagnosticSchema = Schema.Struct({
  ...ShowAttemptDiagnosticOutputSchema.fields,
  diagnosticId: NonEmptyStringSchema,
  causes: Schema.Array(Schema.Unknown),
  redaction: Schema.Unknown,
  sourceFrame: Schema.Unknown,
});

const ShowAttemptDiagnosticsDocumentSchema = Schema.Struct({
  ...ShowAttemptEnvelopeFields,
  data: Schema.Struct({
    kind: Schema.Literal("attempt"),
    evidence: Schema.Unknown,
    observability: Schema.Struct({
      kind: Schema.Literal("domain-view"),
      identity: Schema.Unknown,
      refs: Schema.Array(Schema.Unknown),
      issues: Schema.Array(Schema.Unknown),
      view: Schema.Literal("attempt-observability"),
      entries: Schema.Tuple(Schema.Struct({
        attempt: Schema.Unknown,
        state: Schema.Literal("available"),
        view: Schema.Literal("attempt-observability"),
        detail: Schema.Struct({
          conversation: Schema.Unknown,
          commands: Schema.Unknown,
          usage: Schema.Unknown,
          timing: Schema.Unknown,
          diagnostics: Schema.Struct({
            collection: Schema.Unknown,
            diagnostics: Schema.Array(ShowAttemptDiagnosticSchema),
          }),
        }),
      })),
    }),
    fileChanges: Schema.Unknown,
  }),
});

export type ShowAttemptDiagnostic = Schema.Schema.Type<typeof ShowAttemptDiagnosticOutputSchema>;

/** Strictly read stable diagnostic facts from public `niceeval show @locator --json`. */
export function decodeShowAttemptDiagnostics(receipt: ProcessReceipt): readonly ShowAttemptDiagnostic[] {
  const document = decodeShowSchema(
    ShowAttemptDiagnosticsDocumentSchema,
    receipt,
    "decodeShowAttemptDiagnostics()",
  );
  return document.data.observability.entries[0].detail.diagnostics.diagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    kind: diagnostic.kind,
    phase: diagnostic.phase,
    summary: diagnostic.summary,
  }));
}
