import { Effect, FileSystem, Schema } from "effect";

import { RepoRefSchema } from "../docs/trace/ref.js";
import { MemoryContentInvalid } from "./errors.js";
import type { MemoryCheckReceipt } from "./repository.js";
import { MemoryV1Schema, ProblemResolutionSchema, type MemoryDocument } from "./schema.js";
import { MemoryStore, type MemoryMutationReceipt, type MemoryStoreError } from "./services.js";

const NonEmpty = Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1));
const Body = Schema.NonEmptyString;
const MutationFields = { dryRun: Schema.Boolean };

export const MemoryCommandInputSchema = Schema.Union([
  Schema.Struct({ operation: Schema.Literal("add"), ...MutationFields, metadata: MemoryV1Schema, body: Body }),
  Schema.Struct({ operation: Schema.Literal("list") }),
  Schema.Struct({ operation: Schema.Literal("show"), id: NonEmpty }),
  Schema.Struct({ operation: Schema.Literal("search"), pattern: NonEmpty }),
  Schema.Struct({ operation: Schema.Literal("resolve"), ...MutationFields, id: NonEmpty, resolution: ProblemResolutionSchema }),
  Schema.Struct({ operation: Schema.Literal("reopen"), ...MutationFields, id: NonEmpty }),
  Schema.Struct({ operation: Schema.Literal("supersede"), ...MutationFields, id: NonEmpty, by: NonEmpty }),
  Schema.Struct({ operation: Schema.Literal("promote"), ...MutationFields, id: NonEmpty, to: RepoRefSchema }),
  Schema.Struct({ operation: Schema.Literal("retire"), ...MutationFields, id: NonEmpty, from: RepoRefSchema }),
  Schema.Struct({ operation: Schema.Literal("check") }),
]);
export type MemoryCommandInput = typeof MemoryCommandInputSchema.Type;

type MutationOperation = "add" | "resolve" | "reopen" | "supersede" | "promote" | "retire";
export type MemoryCommandOutcome =
  | { readonly domain: "memory"; readonly operation: MutationOperation; readonly dryRun: boolean; readonly memory: typeof MemoryV1Schema.Type; readonly receipt: MemoryMutationReceipt }
  | { readonly domain: "memory"; readonly operation: "list" | "search"; readonly memories: readonly MemoryDocument[] }
  | { readonly domain: "memory"; readonly operation: "show"; readonly memory: MemoryDocument }
  | { readonly domain: "memory"; readonly operation: "check"; readonly receipt: MemoryCheckReceipt };

function decodeInput(input: unknown): Effect.Effect<MemoryCommandInput, MemoryContentInvalid> {
  return Schema.decodeUnknownEffect(MemoryCommandInputSchema, { errors: "all", onExcessProperty: "error" })(input).pipe(
    Effect.mapError((error) => new MemoryContentInvalid({
      operation: "decode command",
      message: String(error),
    })),
  );
}

function mutationOutcome(operation: MutationOperation, dryRun: boolean, receipt: MemoryMutationReceipt): MemoryCommandOutcome {
  return { domain: "memory", operation, dryRun, memory: receipt.value, receipt };
}

export function runMemoryCommand(
  input: unknown,
): Effect.Effect<MemoryCommandOutcome, MemoryStoreError | MemoryContentInvalid, MemoryStore | FileSystem.FileSystem> {
  return decodeInput(input).pipe(Effect.flatMap((decoded) => Effect.gen(function*() {
    const store = yield* MemoryStore;
    switch (decoded.operation) {
      case "add": {
        const receipt = yield* store.create(decoded.metadata, decoded.body, decoded.dryRun);
        return mutationOutcome(decoded.operation, decoded.dryRun, receipt);
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
        const receipt = yield* store.resolve(decoded.id, decoded.resolution, decoded.dryRun);
        return mutationOutcome(decoded.operation, decoded.dryRun, receipt);
      }
      case "reopen": {
        const receipt = yield* store.reopen(decoded.id, decoded.dryRun);
        return mutationOutcome(decoded.operation, decoded.dryRun, receipt);
      }
      case "supersede": {
        const receipt = yield* store.supersede(decoded.id, decoded.by, decoded.dryRun);
        return mutationOutcome(decoded.operation, decoded.dryRun, receipt);
      }
      case "promote": {
        const receipt = yield* store.promote(decoded.id, decoded.to, decoded.dryRun);
        return mutationOutcome(decoded.operation, decoded.dryRun, receipt);
      }
      case "retire": {
        const receipt = yield* store.retire(decoded.id, decoded.from, decoded.dryRun);
        return mutationOutcome(decoded.operation, decoded.dryRun, receipt);
      }
      case "check": {
        const receipt = yield* store.check();
        return { domain: "memory" as const, operation: decoded.operation, receipt };
      }
    }
  })));
}

export const memoryCommandContribution = Object.freeze({
  name: "memory",
  summary: "Record, search, resolve, supersede, promote, retire, and validate repository Memory.",
  input: MemoryCommandInputSchema,
  run: runMemoryCommand,
});
