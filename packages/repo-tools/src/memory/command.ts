import { Effect, ParseResult, Schema } from "effect";
import { MemoryContentInvalid, type MemoryError } from "./errors.js";
import type { MemoryCheckReceipt } from "./repository.js";
import { MemoryV1Schema, ProblemResolutionSchema, PromotionSchema, type MemoryDocument } from "./schema.js";
import { MemoryStore } from "./services.js";

const NonEmpty = Schema.NonEmptyTrimmedString;
const Body = Schema.String.pipe(Schema.minLength(1));
const MutationFields = { dryRun: Schema.Boolean };

export const MemoryCommandInputSchema = Schema.Union(
  Schema.Struct({
    operation: Schema.Literal("add"),
    ...MutationFields,
    metadata: MemoryV1Schema,
    body: Body,
  }),
  Schema.Struct({ operation: Schema.Literal("list") }),
  Schema.Struct({ operation: Schema.Literal("show"), id: NonEmpty }),
  Schema.Struct({ operation: Schema.Literal("search"), pattern: NonEmpty }),
  Schema.Struct({
    operation: Schema.Literal("resolve"),
    ...MutationFields,
    id: NonEmpty,
    resolution: ProblemResolutionSchema,
  }),
  Schema.Struct({ operation: Schema.Literal("reopen"), ...MutationFields, id: NonEmpty }),
  Schema.Struct({ operation: Schema.Literal("supersede"), ...MutationFields, id: NonEmpty, by: NonEmpty }),
  Schema.Struct({
    operation: Schema.Literal("promote"),
    ...MutationFields,
    id: NonEmpty,
    promotion: PromotionSchema,
    commit: NonEmpty,
  }),
  Schema.Struct({ operation: Schema.Literal("check") }),
);
export type MemoryCommandInput = typeof MemoryCommandInputSchema.Type;

export type MemoryCommandOutcome =
  | { readonly domain: "memory"; readonly operation: "add" | "resolve" | "reopen" | "supersede" | "promote"; readonly dryRun: boolean; readonly memory: typeof MemoryV1Schema.Type }
  | { readonly domain: "memory"; readonly operation: "list" | "search"; readonly memories: readonly MemoryDocument[] }
  | { readonly domain: "memory"; readonly operation: "show"; readonly memory: MemoryDocument }
  | { readonly domain: "memory"; readonly operation: "check"; readonly receipt: MemoryCheckReceipt };

function decodeInput(input: unknown): Effect.Effect<MemoryCommandInput, MemoryContentInvalid> {
  return Schema.decodeUnknown(MemoryCommandInputSchema, { errors: "all" })(input).pipe(
    Effect.mapError((error) => new MemoryContentInvalid({
      operation: "decode command",
      message: ParseResult.TreeFormatter.formatErrorSync(error),
    })),
  );
}

export function runMemoryCommand(
  input: unknown,
): Effect.Effect<MemoryCommandOutcome, MemoryError, MemoryStore> {
  return decodeInput(input).pipe(Effect.flatMap((decoded) => Effect.gen(function*() {
    const store = yield* MemoryStore;
    switch (decoded.operation) {
      case "add": {
        const memory = yield* store.create(decoded.metadata, decoded.body, decoded.dryRun);
        return { domain: "memory" as const, operation: decoded.operation, dryRun: decoded.dryRun, memory };
      }
      case "list": {
        const memories = yield* store.list();
        return { domain: "memory" as const, operation: decoded.operation, memories };
      }
      case "show": {
        const memory = yield* store.read(decoded.id);
        return { domain: "memory" as const, operation: decoded.operation, memory };
      }
      case "search": {
        const memories = yield* store.search(decoded.pattern);
        return { domain: "memory" as const, operation: decoded.operation, memories };
      }
      case "resolve": {
        const memory = yield* store.resolve(decoded.id, decoded.resolution, decoded.dryRun);
        return { domain: "memory" as const, operation: decoded.operation, dryRun: decoded.dryRun, memory };
      }
      case "reopen": {
        const memory = yield* store.reopen(decoded.id, decoded.dryRun);
        return { domain: "memory" as const, operation: decoded.operation, dryRun: decoded.dryRun, memory };
      }
      case "supersede": {
        const memory = yield* store.supersede(decoded.id, decoded.by, decoded.dryRun);
        return { domain: "memory" as const, operation: decoded.operation, dryRun: decoded.dryRun, memory };
      }
      case "promote": {
        const memory = yield* store.promote(
          decoded.id,
          decoded.promotion,
          decoded.commit,
          decoded.dryRun,
        );
        return { domain: "memory" as const, operation: decoded.operation, dryRun: decoded.dryRun, memory };
      }
      case "check": {
        const receipt = yield* store.check();
        return { domain: "memory" as const, operation: decoded.operation, receipt };
      }
    }
  })));
}

/** Pure contribution; parsing, presentation, exit status, and Layer assembly belong to the root. */
export const memoryCommandContribution = Object.freeze({
  name: "memory",
  summary: "Record, search, resolve, supersede, promote, and validate repository Memory.",
  input: MemoryCommandInputSchema,
  run: runMemoryCommand,
});
