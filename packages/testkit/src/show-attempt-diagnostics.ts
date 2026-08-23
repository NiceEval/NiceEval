import { Schema } from "effect";
import type { ProcessReceipt } from "./process.js";
import {
  decodeShowSchema,
  NonEmptyStringSchema,
  ShowAttemptEnvelopeFields,
  ShowSourceCollectionSchema,
  showSourceDependencySchema,
} from "./show-schema.js";
import { ShowTimingDetailSchema } from "./show-timing.js";

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

const ShowConversationDetailSchema = Schema.Struct({
  dependencies: Schema.Tuple(
    Schema.Literal("niceeval.agent-turns"),
    Schema.Literal("niceeval.turn-contexts"),
  ),
  collection: ShowSourceCollectionSchema,
  turns: Schema.Array(Schema.Unknown),
  items: Schema.Array(Schema.Unknown),
});

const ShowCommandsDetailSchema = Schema.Struct({
  dependencies: Schema.Tuple(Schema.Literal("niceeval.sandbox-commands")),
  collection: ShowSourceCollectionSchema,
  entries: Schema.Array(Schema.Unknown),
});

const ShowUsageDetailSchema = Schema.Struct({
  dependencies: Schema.Tuple(Schema.Literal("niceeval.agent-turns")),
  collection: ShowSourceCollectionSchema,
  observations: Schema.Array(Schema.Unknown),
});

const ShowDiagnosticsDetailSchema = Schema.Struct({
  dependencies: Schema.Tuple(Schema.Literal("niceeval.runner-diagnostics")),
  collection: ShowSourceCollectionSchema,
  diagnostics: Schema.Array(ShowAttemptDiagnosticSchema),
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
          sources: Schema.Struct({
            agentTurns: showSourceDependencySchema("niceeval.agent-turns"),
            turnContexts: showSourceDependencySchema("niceeval.turn-contexts"),
            sandboxCommands: showSourceDependencySchema("niceeval.sandbox-commands"),
            runnerActivities: showSourceDependencySchema("niceeval.runner-activities"),
            runnerDiagnostics: showSourceDependencySchema("niceeval.runner-diagnostics"),
          }),
          conversation: ShowConversationDetailSchema,
          commands: ShowCommandsDetailSchema,
          usage: ShowUsageDetailSchema,
          timing: ShowTimingDetailSchema,
          diagnostics: ShowDiagnosticsDetailSchema,
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
