import { Context, type Effect, Layer } from "effect";
import type { MemoryError } from "./errors.js";
import { memoryEffect, MemoryRepository, type MemoryCheckReceipt } from "./repository.js";
import type { MemoryDocument, MemoryV1, ProblemResolution, Promotion } from "./schema.js";

export interface MemoryStoreService {
  readonly list: () => Effect.Effect<readonly MemoryDocument[], MemoryError>;
  readonly read: (id: string) => Effect.Effect<MemoryDocument, MemoryError>;
  readonly search: (pattern: string) => Effect.Effect<readonly MemoryDocument[], MemoryError>;
  readonly create: (metadata: MemoryV1, body: string, dryRun: boolean) => Effect.Effect<MemoryV1, MemoryError>;
  readonly resolve: (id: string, resolution: ProblemResolution, dryRun: boolean) => Effect.Effect<MemoryV1, MemoryError>;
  readonly reopen: (id: string, dryRun: boolean) => Effect.Effect<MemoryV1, MemoryError>;
  readonly supersede: (id: string, replacementId: string, dryRun: boolean) => Effect.Effect<MemoryV1, MemoryError>;
  readonly promote: (id: string, promotion: Promotion, commit: string, dryRun: boolean) => Effect.Effect<MemoryV1, MemoryError>;
  readonly check: () => Effect.Effect<MemoryCheckReceipt, MemoryError>;
}

export class MemoryStore extends Context.Tag("@niceeval/repo-tools/memory/Store")<
  MemoryStore,
  MemoryStoreService
>() {}

/** Node filesystem adapter; applications provide it once at their composition edge. */
export const NodeMemoryStoreLive = (root: string) =>
  Layer.succeed(MemoryStore, (() => {
    const repository = new MemoryRepository(root);
    return {
      list: () => memoryEffect("list", () => repository.list()),
      read: (id) => memoryEffect("read", () => repository.read(id)),
      search: (pattern) => memoryEffect("search", () => repository.search(pattern)),
      create: (metadata, body, dryRun) => memoryEffect("add", () => repository.create(metadata, body, dryRun)),
      resolve: (id, resolution, dryRun) => memoryEffect("resolve", () => repository.resolve(id, resolution, dryRun)),
      reopen: (id, dryRun) => memoryEffect("reopen", () => repository.reopen(id, dryRun)),
      supersede: (id, replacementId, dryRun) => memoryEffect("supersede", () =>
        repository.supersede(id, replacementId, dryRun)),
      promote: (id, promotion, commit, dryRun) => memoryEffect("promote", () =>
        repository.promote(id, promotion, commit, dryRun)),
      check: () => memoryEffect("check", () => repository.check()),
    } satisfies MemoryStoreService;
  })());
