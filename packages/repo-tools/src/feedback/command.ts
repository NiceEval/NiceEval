import { FileSystem } from "@effect/platform";
import { Clock, Effect, ParseResult, Schema } from "effect";

import type { FeedbackDocument } from "./codec.js";
import { FeedbackContentInvalid } from "./errors.js";
import type { FeedbackCheckReceipt } from "./repository.js";
import {
  FeedbackClosureSchema,
  FeedbackCreateSchema,
  FeedbackEnvelopeV1Schema,
  FeedbackMemoryRelationSchema,
  FeedbackV2Schema,
} from "./schema.js";
import { FeedbackStore, type FeedbackMutationReceipt, type FeedbackStoreError } from "./services.js";
import { RepoRefSchema } from "../docs/trace/ref.js";

const NonEmpty = Schema.NonEmptyTrimmedString;
const Body = Schema.String.pipe(Schema.minLength(1));
const MutationFields = { dryRun: Schema.Boolean };

export const FeedbackCommandInputSchema = Schema.Union(
  Schema.Struct({ operation: Schema.Literal("add"), ...MutationFields, document: Schema.Struct({ metadata: FeedbackCreateSchema, body: Body }) }),
  Schema.Struct({ operation: Schema.Literal("import"), ...MutationFields, envelope: FeedbackEnvelopeV1Schema, artifacts: NonEmpty }),
  Schema.Struct({ operation: Schema.Literal("export"), id: NonEmpty }),
  Schema.Struct({ operation: Schema.Literal("list"), pattern: Schema.optional(NonEmpty) }),
  Schema.Struct({ operation: Schema.Literal("show"), id: NonEmpty }),
  Schema.Struct({ operation: Schema.Literal("link"), ...MutationFields, id: NonEmpty, relation: FeedbackMemoryRelationSchema }),
  Schema.Struct({ operation: Schema.Literal("adopt"), ...MutationFields, id: NonEmpty, to: RepoRefSchema }),
  Schema.Struct({ operation: Schema.Literal("retire"), ...MutationFields, id: NonEmpty, from: RepoRefSchema }),
  Schema.Struct({ operation: Schema.Literal("close"), ...MutationFields, id: NonEmpty, closure: FeedbackClosureSchema }),
  Schema.Struct({ operation: Schema.Literal("reopen"), ...MutationFields, id: NonEmpty }),
  Schema.Struct({ operation: Schema.Literal("check") }),
);
export type FeedbackCommandInput = typeof FeedbackCommandInputSchema.Type;

type MutationOperation = "add" | "import" | "link" | "adopt" | "retire" | "close" | "reopen";
export type FeedbackCommandOutcome =
  | { readonly domain: "feedback"; readonly operation: MutationOperation; readonly dryRun: boolean; readonly feedback: typeof FeedbackV2Schema.Type; readonly receipt: FeedbackMutationReceipt }
  | { readonly domain: "feedback"; readonly operation: "export" | "show"; readonly document: FeedbackDocument }
  | { readonly domain: "feedback"; readonly operation: "list"; readonly feedback: readonly (typeof FeedbackV2Schema.Type)[] }
  | { readonly domain: "feedback"; readonly operation: "check"; readonly receipt: FeedbackCheckReceipt };

function decodeInput(input: unknown): Effect.Effect<FeedbackCommandInput, FeedbackContentInvalid> {
  return Schema.decodeUnknown(FeedbackCommandInputSchema, { errors: "all", onExcessProperty: "error" })(input).pipe(
    Effect.mapError((error) => new FeedbackContentInvalid({
      operation: "decode command",
      message: ParseResult.TreeFormatter.formatErrorSync(error),
    })),
  );
}

function mutationOutcome(operation: MutationOperation, dryRun: boolean, receipt: FeedbackMutationReceipt): FeedbackCommandOutcome {
  return { domain: "feedback", operation, dryRun, feedback: receipt.value, receipt };
}

export function runFeedbackCommand(
  input: unknown,
): Effect.Effect<FeedbackCommandOutcome, FeedbackStoreError | FeedbackContentInvalid, FeedbackStore | FileSystem.FileSystem> {
  return decodeInput(input).pipe(Effect.flatMap((decoded) => Effect.gen(function*() {
    const store = yield* FeedbackStore;
    switch (decoded.operation) {
      case "add": {
        const metadata = { ...decoded.document.metadata, adoptions: decoded.document.metadata.adoptions ?? { current: [], history: [] } };
        const receipt = yield* store.create({ metadata, body: decoded.document.body }, decoded.dryRun);
        return mutationOutcome(decoded.operation, decoded.dryRun, receipt);
      }
      case "import": {
        const millis = yield* Clock.currentTimeMillis;
        const receipt = yield* store.importEnvelope(decoded.envelope, decoded.artifacts, new Date(millis).toISOString(), decoded.dryRun);
        return mutationOutcome(decoded.operation, decoded.dryRun, receipt);
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
        const receipt = yield* store.link(decoded.id, decoded.relation, decoded.dryRun);
        return mutationOutcome(decoded.operation, decoded.dryRun, receipt);
      }
      case "adopt": {
        const receipt = yield* store.adopt(decoded.id, decoded.to, decoded.dryRun);
        return mutationOutcome(decoded.operation, decoded.dryRun, receipt);
      }
      case "retire": {
        const receipt = yield* store.retire(decoded.id, decoded.from, decoded.dryRun);
        return mutationOutcome(decoded.operation, decoded.dryRun, receipt);
      }
      case "close": {
        const receipt = yield* store.close(decoded.id, decoded.closure, decoded.dryRun);
        return mutationOutcome(decoded.operation, decoded.dryRun, receipt);
      }
      case "reopen": {
        const receipt = yield* store.reopen(decoded.id, decoded.dryRun);
        return mutationOutcome(decoded.operation, decoded.dryRun, receipt);
      }
      case "check": {
        const receipt = yield* store.check();
        return { domain: "feedback" as const, operation: decoded.operation, receipt };
      }
    }
  })));
}

export const feedbackCommandContribution = Object.freeze({
  name: "feedback",
  summary: "Record, relate, adopt, retire, close, and validate repository feedback.",
  input: FeedbackCommandInputSchema,
  run: runFeedbackCommand,
});
