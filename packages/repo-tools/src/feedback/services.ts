import { Cause, Context, Effect, Exit, FileSystem, Layer, Option } from "effect";

import { compileTrace, compileTraceUnderLease } from "../docs/trace/compiler.js";
import type { TraceError } from "../docs/trace/errors.js";
import type { RepoRef } from "../docs/trace/ref.js";
import {
  mutateTraceOwner,
  traceDigest,
  TraceMutationError,
  type TraceCoordinationError,
  type TraceMutationPreparation,
  type TraceMutationReceipt,
  withTraceReadLease,
} from "../docs/trace/relation-mutation.js";
import type { FeedbackDocument } from "./codec.js";
import type { FeedbackError } from "./errors.js";
import { feedbackEffect, FeedbackRepository, type FeedbackCheckReceipt, type StagedFeedback } from "./repository.js";
import type { FeedbackClosure, FeedbackEnvelopeV1, FeedbackMemoryRelation, FeedbackV2 } from "./schema.js";

export interface FeedbackMutationChanges {
  readonly created?: boolean;
  readonly memoryRelationAdded?: FeedbackMemoryRelation;
  readonly adoptionAdded?: RepoRef;
  readonly adoptionRetired?: { readonly target: RepoRef; readonly commit: string };
  readonly state?: { readonly from: "open" | "closed"; readonly to: "open" | "closed" };
}

export type FeedbackMutationReceipt = TraceMutationReceipt<FeedbackV2, FeedbackMutationChanges>;
export type FeedbackStoreError = FeedbackError | TraceError | TraceCoordinationError;

export interface FeedbackStoreService {
  readonly list: () => Effect.Effect<readonly FeedbackDocument[], FeedbackStoreError>;
  readonly read: (id: string) => Effect.Effect<FeedbackDocument, FeedbackStoreError>;
  readonly create: (document: FeedbackDocument, dryRun: boolean) => Effect.Effect<FeedbackMutationReceipt, FeedbackStoreError, FileSystem.FileSystem>;
  readonly importEnvelope: (
    envelope: FeedbackEnvelopeV1,
    artifactRoot: string,
    reportedAt: string,
    dryRun: boolean,
  ) => Effect.Effect<FeedbackMutationReceipt, FeedbackStoreError, FileSystem.FileSystem>;
  readonly link: (id: string, relation: FeedbackMemoryRelation, dryRun: boolean) => Effect.Effect<FeedbackMutationReceipt, FeedbackStoreError, FileSystem.FileSystem>;
  readonly adopt: (id: string, target: RepoRef, dryRun: boolean) => Effect.Effect<FeedbackMutationReceipt, FeedbackStoreError, FileSystem.FileSystem>;
  readonly retire: (id: string, target: RepoRef, dryRun: boolean) => Effect.Effect<FeedbackMutationReceipt, FeedbackStoreError, FileSystem.FileSystem>;
  readonly close: (id: string, closure: FeedbackClosure, dryRun: boolean) => Effect.Effect<FeedbackMutationReceipt, FeedbackStoreError, FileSystem.FileSystem>;
  readonly reopen: (id: string, dryRun: boolean) => Effect.Effect<FeedbackMutationReceipt, FeedbackStoreError, FileSystem.FileSystem>;
  readonly check: () => Effect.Effect<FeedbackCheckReceipt, FeedbackStoreError, FileSystem.FileSystem>;
}

export class FeedbackStore extends Context.Service<FeedbackStore, FeedbackStoreService>()("@niceeval/repo-tools/feedback/Store") {}

/** Node filesystem adapter; applications provide it once at their composition edge. */
export const NodeFeedbackStoreLive = (root: string) => Layer.succeed(FeedbackStore, (() => {
  const repository = new FeedbackRepository({ root });

  const prepareUnderLease = (
    target?: RepoRef,
    extraPaths: readonly string[] = [],
    regressionMemory?: string,
  ): Effect.Effect<TraceMutationPreparation, FeedbackStoreError, FileSystem.FileSystem> =>
    compileTraceUnderLease(root).pipe(
      Effect.flatMap((snapshot) => feedbackEffect("trace preparation", () => {
        const regressionTarget = regressionMemory === undefined ? undefined : `memory/${regressionMemory}.md`;
        const regressionOwners = regressionTarget === undefined ? [] : snapshot.tests
          .filter((test) => test.regressions.some((reference) => reference.split("#", 1)[0] === regressionTarget))
          .map((test) => test.path)
          .sort();
        const guardedPaths = [...new Set([...extraPaths, ...regressionOwners])].sort();
        const extra = guardedPaths.map((path) => {
          const targetSource = repository.targetSource(path);
          return { path: targetSource.absolutePath, digest: traceDigest(targetSource.source) };
        });
        const evidence = regressionMemory === undefined ? {} : { regressionOwners };
        if (target === undefined) return { generation: snapshot.generation, snapshotDigest: snapshot.digest, preimages: extra, ...evidence };
        const targetSource = repository.targetSource(target);
        const validated = repository.validateTarget(snapshot, target);
        return {
          generation: snapshot.generation,
          snapshotDigest: snapshot.digest,
          target: validated,
          preimages: [...extra, { path: targetSource.absolutePath, digest: traceDigest(targetSource.source) }],
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
    readonly plan: (source: string | undefined, commit: string, preparation: TraceMutationPreparation) => {
      readonly bytes: string;
      readonly metadata: FeedbackV2;
      readonly changes: Changes;
    };
    readonly staged?: StagedFeedback;
  }): Effect.Effect<TraceMutationReceipt<FeedbackV2, Changes>, FeedbackStoreError, FileSystem.FileSystem> =>
    mutateTraceOwner({
      root,
      operation: options.operation,
      ownerPath: repository.ownerPath(options.id),
      dryRun: options.dryRun,
      prepareUnderLease: prepareUnderLease(options.target, options.extraPaths, options.regressionMemory),
      plan: ({ source, headCommit, preparation }) => feedbackEffect(options.operation, () => {
        const planned = options.plan(source, headCommit, preparation);
        return { bytes: planned.bytes, value: planned.metadata, changes: planned.changes };
      }),
      ...(options.staged === undefined ? {} : {
        publication: {
          kind: "new-feedback-directory" as const,
          stagePath: options.staged.stage,
          targetPath: options.staged.target,
        },
      }),
    });

  const preserveStage = <E>(exit: Exit.Exit<unknown, E>): boolean => {
    if (Exit.isSuccess(exit)) return false;
    const failure = Option.getOrUndefined(Cause.findErrorOption(exit.cause));
    return failure instanceof TraceMutationError &&
      (failure.operation === "recover-after-failure" || failure.phase === "rollback");
  };

  const resumeExit = <A, E>(exit: Exit.Exit<A, E>): Effect.Effect<A, E> =>
    Exit.isFailure(exit) ? Effect.failCause(exit.cause) : Effect.succeed(exit.value);

  const withStaged = <A, E, R>(
    document: FeedbackDocument,
    artifacts: readonly { readonly relativePath: string; readonly sourcePath: string }[],
    use: (staged: StagedFeedback) => Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E | FeedbackError, R> => Effect.uninterruptibleMask((restore) => Effect.gen(function*() {
    const staged = yield* feedbackEffect("stage", () => repository.stage(document, artifacts));
    const useExit = yield* Effect.exit(restore(use(staged)));
    if (preserveStage(useExit)) return yield* resumeExit(useExit);
    const cleanupExit = yield* Effect.exit(feedbackEffect("stage cleanup", () => repository.cleanupStage(staged)));
    if (Exit.isFailure(cleanupExit)) {
      if (Exit.isFailure(useExit)) return yield* Effect.failCause(Cause.combine(useExit.cause, cleanupExit.cause));
      return yield* Effect.failCause(cleanupExit.cause);
    }
    return yield* resumeExit(useExit);
  }));

  return {
    list: () => withTraceReadLease(root, () => feedbackEffect("list", () => repository.list())),
    read: (id) => withTraceReadLease(root, () => feedbackEffect("read", () => repository.read(id))),
    create: (document, dryRun) => {
      const run = (staged?: StagedFeedback) => mutate({
        id: document.metadata.id,
        operation: "feedback-add",
        dryRun,
        extraPaths: document.metadata.memoryRelations.map((relation) => `memory/${relation.memory}.md`),
        plan: () => {
          const planned = repository.planCreate(document);
          return { ...planned, changes: { created: true } };
        },
        ...(staged === undefined ? {} : { staged }),
      });
      return dryRun ? run() : withStaged(document, [], run);
    },
    importEnvelope: (envelope, artifactRoot, reportedAt, dryRun) => Effect.gen(function*() {
      const prepared = yield* withTraceReadLease(root, () =>
        feedbackEffect("import", () => repository.prepareImport(envelope, artifactRoot, reportedAt)));
      if (prepared.existing !== undefined) {
        return yield* mutate({
          id: prepared.existing.id,
          operation: "feedback-import",
          dryRun,
          plan: (source) => {
            if (source === undefined) throw new Error("idempotent import target disappeared");
            return { bytes: source, metadata: prepared.existing!, changes: {} };
          },
        });
      }
      if (dryRun) return yield* mutate({
        id: prepared.document.metadata.id,
        operation: "feedback-import",
        dryRun: true,
        plan: () => ({
          ...repository.planCreate(prepared.document),
          changes: { created: true },
        }),
      });
      return yield* withStaged(prepared.document, prepared.artifacts, (staged) => mutate({
          id: prepared.document.metadata.id,
          operation: "feedback-import",
          dryRun: false,
          plan: () => ({ ...repository.planCreate(prepared.document), changes: { created: true } }),
          staged,
        }));
    }),
    link: (id, relation, dryRun) => mutate({
      id,
      operation: "feedback-link",
      dryRun,
      extraPaths: [`memory/${relation.memory}.md`],
      plan: (source) => ({ ...repository.planLink(id, source, relation), changes: { memoryRelationAdded: relation } }),
    }),
    adopt: (id, target, dryRun) => mutate({
      id,
      operation: "feedback-adopt",
      dryRun,
      target,
      plan: (source) => ({ ...repository.planAdopt(id, source, target), changes: { adoptionAdded: target } }),
    }),
    retire: (id, target, dryRun) => mutate({
      id,
      operation: "feedback-retire",
      dryRun,
      target,
      plan: (source, commit) => ({
        ...repository.planRetire(id, source, target, commit),
        changes: { adoptionRetired: { target, commit } },
      }),
    }),
    close: (id, closure, dryRun) => mutate({
      id,
      operation: "feedback-close",
      dryRun,
      extraPaths: closure.kind === "duplicate"
        ? [repository.ownerPath(closure.canonical)]
        : closure.kind === "fixed" || closure.kind === "delivered" || closure.kind === "declined"
        ? [`memory/${closure.memory}.md`]
        : [],
      ...(closure.kind === "fixed" ? { regressionMemory: closure.memory } : {}),
      plan: (source, _commit, preparation) => ({
        ...repository.planClose(id, source, closure, preparation.regressionOwners ?? []),
        changes: { state: { from: "open", to: "closed" } },
      }),
    }),
    reopen: (id, dryRun) => mutate({
      id,
      operation: "feedback-reopen",
      dryRun,
      plan: (source) => ({ ...repository.planReopen(id, source), changes: { state: { from: "closed", to: "open" } } }),
    }),
    check: () => compileTrace(root).pipe(
      Effect.flatMap((snapshot) => feedbackEffect("check", () => repository.check(snapshot))),
    ),
  } satisfies FeedbackStoreService;
})());
