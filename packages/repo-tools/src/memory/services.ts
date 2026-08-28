import { Context, Effect, FileSystem, Layer } from "effect";

import { compileTrace, compileTraceUnderLease } from "../docs/trace/compiler.js";
import type { TraceError } from "../docs/trace/errors.js";
import type { RepoRef } from "../docs/trace/ref.js";
import {
  mutateTraceOwner,
  traceDigest,
  type TraceCoordinationError,
  type TraceMutationPreparation,
  type TraceMutationReceipt,
  withTraceReadLease,
} from "../docs/trace/relation-mutation.js";
import { decodeMemoryDocument } from "./codec.js";
import { LegacyMemoryReadOnly, MemoryReferenceConflict, type MemoryError } from "./errors.js";
import { memoryEffect, MemoryRepository, type MemoryAuthorSnapshot, type MemoryCheckReceipt } from "./repository.js";
import type { MemoryDocument, MemoryV1, ProblemResolution, PromotionKind } from "./schema.js";

export interface MemoryMutationChanges {
  readonly created?: boolean;
  readonly authorUpdated?: boolean;
  readonly state?: { readonly from: string; readonly to: string };
  readonly promotionAdded?: { readonly kind: PromotionKind; readonly target: RepoRef };
  readonly promotionRetired?: { readonly kind: PromotionKind; readonly target: RepoRef; readonly commit: string };
  readonly supersededBy?: string;
  readonly retiredBySupersede?: readonly { readonly kind: PromotionKind; readonly target: RepoRef; readonly commit: string }[];
}

export type MemoryMutationReceipt = TraceMutationReceipt<MemoryV1, MemoryMutationChanges>;
export type MemoryStoreError = MemoryError | TraceError | TraceCoordinationError;

export interface MemoryStoreService {
  readonly list: () => Effect.Effect<readonly MemoryDocument[], MemoryStoreError>;
  readonly read: (id: string) => Effect.Effect<MemoryDocument, MemoryStoreError>;
  readonly readAuthor: (id: string) => Effect.Effect<MemoryAuthorSnapshot, MemoryStoreError>;
  readonly search: (pattern: string) => Effect.Effect<readonly MemoryDocument[], MemoryStoreError>;
  readonly create: (metadata: MemoryV1, body: string, dryRun: boolean) => Effect.Effect<MemoryMutationReceipt, MemoryStoreError, FileSystem.FileSystem>;
  readonly setAuthor: (id: string, body: string, expectedOwnerDigest: string, expectedAuthorDigest: string, dryRun: boolean) => Effect.Effect<MemoryMutationReceipt, MemoryStoreError, FileSystem.FileSystem>;
  readonly resolve: (id: string, resolution: ProblemResolution, dryRun: boolean) => Effect.Effect<MemoryMutationReceipt, MemoryStoreError, FileSystem.FileSystem>;
  readonly reopen: (id: string, dryRun: boolean) => Effect.Effect<MemoryMutationReceipt, MemoryStoreError, FileSystem.FileSystem>;
  readonly supersede: (id: string, replacementId: string, dryRun: boolean) => Effect.Effect<MemoryMutationReceipt, MemoryStoreError, FileSystem.FileSystem>;
  readonly promote: (id: string, target: RepoRef, dryRun: boolean) => Effect.Effect<MemoryMutationReceipt, MemoryStoreError, FileSystem.FileSystem>;
  readonly retire: (id: string, target: RepoRef, dryRun: boolean) => Effect.Effect<MemoryMutationReceipt, MemoryStoreError, FileSystem.FileSystem>;
  readonly check: () => Effect.Effect<MemoryCheckReceipt, MemoryStoreError, FileSystem.FileSystem>;
}

export class MemoryStore extends Context.Service<MemoryStore, MemoryStoreService>()("@niceeval/repo-tools/memory/Store") {}

/** Node filesystem adapter; applications provide it once at their composition edge. */
export const NodeMemoryStoreLive = (root: string) => Layer.succeed(MemoryStore, (() => {
  const repository = new MemoryRepository(root);

  const prepareUnderLease = (
    target?: RepoRef,
    extraPaths: readonly string[] = [],
    regressionMemory?: string,
  ): Effect.Effect<TraceMutationPreparation, MemoryStoreError, FileSystem.FileSystem> =>
    compileTraceUnderLease(root).pipe(
      Effect.flatMap((snapshot) => memoryEffect("trace preparation", () => {
        const regressionTarget = regressionMemory === undefined ? undefined : `memory/${regressionMemory}.md`;
        const fixedEvidence = regressionTarget === undefined
          ? { selectors: [] as readonly string[], preimagePaths: [] as readonly string[] }
          : repository.validateFixedEvidence(snapshot, regressionTarget);
        const guardedPaths = [...new Set([...extraPaths, ...fixedEvidence.preimagePaths])].sort();
        const extra = guardedPaths.map((path) => {
          const source = repository.targetSource(path);
          return { path: source.absolutePath, digest: traceDigest(source.source) };
        });
        const evidence = regressionMemory === undefined ? {} : { regressionOwners: fixedEvidence.selectors };
        if (target === undefined) return { generation: snapshot.generation, snapshotDigest: snapshot.digest, preimages: extra, ...evidence };
        const source = repository.targetSource(target);
        const validated = repository.validateTarget(snapshot, target);
        return {
          generation: snapshot.generation,
          snapshotDigest: snapshot.digest,
          target: validated,
          preimages: [...extra, { path: source.absolutePath, digest: traceDigest(source.source) }],
          ...evidence,
        };
      })),
    );

  const mutate = <Changes>(options: {
    readonly id: string;
    readonly operation: string;
    readonly dryRun: boolean;
    readonly target?: RepoRef;
    readonly extraPaths?: readonly string[];
    readonly regressionMemory?: string;
    readonly plan: (
      source: string | undefined,
      commit: string,
      preparation: TraceMutationPreparation,
    ) => { readonly bytes: string; readonly metadata: MemoryV1; readonly changes: Changes };
  }): Effect.Effect<TraceMutationReceipt<MemoryV1, Changes>, MemoryStoreError, FileSystem.FileSystem> =>
    mutateTraceOwner({
      root,
      operation: options.operation,
      ownerPath: repository.ownerPath(options.id),
      dryRun: options.dryRun,
      prepareUnderLease: prepareUnderLease(options.target, options.extraPaths, options.regressionMemory),
      plan: ({ source, headCommit, preparation }) => memoryEffect(options.operation, () => {
        const planned = options.plan(source, headCommit, preparation);
        return { bytes: planned.bytes, value: planned.metadata, changes: planned.changes };
      }),
    });

  return {
    list: () => withTraceReadLease(root, () => memoryEffect("list", () => repository.list())),
    read: (id) => withTraceReadLease(root, () => memoryEffect("read", () => repository.read(id))),
    readAuthor: (id) => withTraceReadLease(root, () => memoryEffect("read author", () => repository.readAuthorSnapshot(id))),
    search: (pattern) => withTraceReadLease(root, () => memoryEffect("search", () => repository.search(pattern))),
    create: (metadata, body, dryRun) => mutate({
      id: metadata.id,
      operation: "memory-add",
      dryRun,
      plan: () => ({ ...repository.planCreate(metadata, body), changes: { created: true } }),
    }),
    setAuthor: (id, body, expectedOwnerDigest, expectedAuthorDigest, dryRun) => mutate({
      id,
      operation: "memory-author-set",
      dryRun,
      plan: (source) => ({
        ...repository.planAuthorSet(id, source, body, expectedOwnerDigest, expectedAuthorDigest),
        changes: { authorUpdated: true },
      }),
    }),
    resolve: (id, resolution, dryRun) => mutate({
      id,
      operation: "memory-resolve",
      dryRun,
      ...(resolution.kind === "fixed" ? { regressionMemory: id } : {}),
      plan: (source, _commit, preparation) => ({
        ...repository.planResolve(id, source, resolution, preparation.regressionOwners ?? []),
        changes: { state: { from: "open", to: "resolved" } },
      }),
    }),
    reopen: (id, dryRun) => mutate({
      id,
      operation: "memory-reopen",
      dryRun,
      plan: (source, commit) => ({ ...repository.planReopen(id, source, commit), changes: { state: { from: "resolved", to: "open" } } }),
    }),
    supersede: (id, replacementId, dryRun) => mutate({
      id,
      operation: "memory-supersede",
      dryRun,
      extraPaths: [repository.ownerPath(replacementId)],
      plan: (source, commit) => {
        if (source === undefined) {
          throw new MemoryReferenceConflict({
            operation: "supersede",
            path: repository.ownerPath(id),
            message: "Memory disappeared during supersede planning",
          });
        }
        const current = decodeMemoryDocument(repository.ownerPath(id), id, source);
        if ("legacy" in current) {
          throw new LegacyMemoryReadOnly({
            operation: "supersede",
            path: repository.ownerPath(id),
            message: "legacy Memory is read-only; convert it explicitly while preserving its body",
          });
        }
        const replacement = repository.read(replacementId);
        if ("legacy" in replacement) {
          throw new LegacyMemoryReadOnly({
            operation: "supersede",
            path: repository.ownerPath(replacementId),
            message: "replacement must be structured Memory",
          });
        }
        const retiredBySupersede = current.metadata.promotions.flatMap((promotion) =>
          promotion.current.map((target) => ({ kind: promotion.kind, target, commit })),
        );
        return {
          ...repository.planSupersede(id, source, replacement.metadata, commit),
          changes: { supersededBy: replacementId, retiredBySupersede },
        };
      },
    }),
    promote: (id, target, dryRun) => mutate({
      id,
      operation: "memory-promote",
      dryRun,
      target,
      plan: (source, _commit, preparation) => {
        const kind = preparation.target?.kind;
        if (kind !== "roadmap" && kind !== "feature" && kind !== "use-case" && kind !== "engineering") {
          throw new MemoryReferenceConflict({ operation: "promote", message: "promotion target kind was not prepared" });
        }
        return { ...repository.planPromote(id, source, kind, target), changes: { promotionAdded: { kind, target } } };
      },
    }),
    retire: (id, target, dryRun) => mutate({
      id,
      operation: "memory-retire",
      dryRun,
      target,
      plan: (source, commit, preparation) => {
        const kind = preparation.target?.kind;
        if (kind !== "roadmap" && kind !== "feature" && kind !== "use-case" && kind !== "engineering") {
          throw new MemoryReferenceConflict({ operation: "retire", message: "promotion target kind was not prepared" });
        }
        return {
          ...repository.planRetire(id, source, kind, target, commit),
          changes: { promotionRetired: { kind, target, commit } },
        };
      },
    }),
    check: () => compileTrace(root).pipe(
      Effect.flatMap((snapshot) => memoryEffect("check", () => repository.check(snapshot))),
    ),
  } satisfies MemoryStoreService;
})());
