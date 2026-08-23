import { Clock, Effect, ParseResult, Schema } from "effect";
import type { FeedbackDocument } from "./codec.js";
import { FeedbackContentInvalid, type FeedbackError } from "./errors.js";
import type { FeedbackCheckReceipt } from "./repository.js";
import {
  FeedbackClosureSchema,
  FeedbackEnvelopeV1Schema,
  FeedbackMemoryRelationSchema,
  FeedbackV1Schema,
} from "./schema.js";
import { FeedbackStore } from "./services.js";

const NonEmpty = Schema.NonEmptyTrimmedString;
const Body = Schema.String.pipe(Schema.minLength(1));
const MutationFields = { dryRun: Schema.Boolean };

export const FeedbackCommandInputSchema = Schema.Union(
  Schema.Struct({
    operation: Schema.Literal("add"),
    ...MutationFields,
    document: Schema.Struct({ metadata: FeedbackV1Schema, body: Body }),
  }),
  Schema.Struct({
    operation: Schema.Literal("import"),
    ...MutationFields,
    envelope: FeedbackEnvelopeV1Schema,
    artifacts: NonEmpty,
  }),
  Schema.Struct({ operation: Schema.Literal("export"), id: NonEmpty }),
  Schema.Struct({ operation: Schema.Literal("list"), pattern: Schema.optional(NonEmpty) }),
  Schema.Struct({ operation: Schema.Literal("show"), id: NonEmpty }),
  Schema.Struct({
    operation: Schema.Literal("link"),
    ...MutationFields,
    id: NonEmpty,
    relation: FeedbackMemoryRelationSchema,
  }),
  Schema.Struct({
    operation: Schema.Literal("close"),
    ...MutationFields,
    id: NonEmpty,
    closure: FeedbackClosureSchema,
  }),
  Schema.Struct({ operation: Schema.Literal("reopen"), ...MutationFields, id: NonEmpty }),
  Schema.Struct({ operation: Schema.Literal("check") }),
);
export type FeedbackCommandInput = typeof FeedbackCommandInputSchema.Type;

export type FeedbackCommandOutcome =
  | { readonly domain: "feedback"; readonly operation: "add" | "import" | "link" | "close" | "reopen"; readonly dryRun: boolean; readonly feedback: typeof FeedbackV1Schema.Type }
  | { readonly domain: "feedback"; readonly operation: "export" | "show"; readonly document: FeedbackDocument }
  | { readonly domain: "feedback"; readonly operation: "list"; readonly feedback: readonly (typeof FeedbackV1Schema.Type)[] }
  | { readonly domain: "feedback"; readonly operation: "check"; readonly receipt: FeedbackCheckReceipt };

function decodeInput(input: unknown): Effect.Effect<FeedbackCommandInput, FeedbackContentInvalid> {
  return Schema.decodeUnknown(FeedbackCommandInputSchema, { errors: "all" })(input).pipe(
    Effect.mapError((error) => new FeedbackContentInvalid({
      operation: "decode command",
      message: ParseResult.TreeFormatter.formatErrorSync(error),
    })),
  );
}

export function runFeedbackCommand(
  input: unknown,
): Effect.Effect<FeedbackCommandOutcome, FeedbackError, FeedbackStore> {
  return decodeInput(input).pipe(Effect.flatMap((decoded) => Effect.gen(function*() {
    const store = yield* FeedbackStore;
    switch (decoded.operation) {
      case "add": {
        const feedback = yield* store.create(decoded.document, decoded.dryRun);
        return { domain: "feedback" as const, operation: decoded.operation, dryRun: decoded.dryRun, feedback };
      }
      case "import": {
        const millis = yield* Clock.currentTimeMillis;
        const feedback = yield* store.importEnvelope(
          decoded.envelope,
          decoded.artifacts,
          new Date(millis).toISOString(),
          decoded.dryRun,
        );
        return { domain: "feedback" as const, operation: decoded.operation, dryRun: decoded.dryRun, feedback };
      }
      case "export":
      case "show": {
        const document = yield* store.read(decoded.id);
        return { domain: "feedback" as const, operation: decoded.operation, document };
      }
      case "list": {
        const entries = yield* store.list();
        const needle = decoded.pattern?.toLocaleLowerCase();
        const feedback = entries.map((entry) => entry.metadata).filter((entry) => needle === undefined ||
          `${entry.id}\n${entry.title}\n${entry.observation}\n${entry.impact}`.toLocaleLowerCase().includes(needle));
        return { domain: "feedback" as const, operation: decoded.operation, feedback };
      }
      case "link": {
        const feedback = yield* store.link(decoded.id, decoded.relation, decoded.dryRun);
        return { domain: "feedback" as const, operation: decoded.operation, dryRun: decoded.dryRun, feedback };
      }
      case "close": {
        const feedback = yield* store.close(decoded.id, decoded.closure, decoded.dryRun);
        return { domain: "feedback" as const, operation: decoded.operation, dryRun: decoded.dryRun, feedback };
      }
      case "reopen": {
        const feedback = yield* store.reopen(decoded.id, decoded.dryRun);
        return { domain: "feedback" as const, operation: decoded.operation, dryRun: decoded.dryRun, feedback };
      }
      case "check": {
        const receipt = yield* store.check();
        return { domain: "feedback" as const, operation: decoded.operation, receipt };
      }
    }
  })));
}

/** Pure contribution; parsing, presentation, exit status, and Layer assembly belong to the root. */
export const feedbackCommandContribution = Object.freeze({
  name: "feedback",
  summary: "Record, relate, close, and validate repository feedback.",
  input: FeedbackCommandInputSchema,
  run: runFeedbackCommand,
});
