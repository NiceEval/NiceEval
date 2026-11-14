import { beforeCacheReplacementWarnings } from "./before-cache-collisions.ts";
import { randomUUID } from "node:crypto";
import { Deferred, Effect, Result, Option, Semaphore, Scope } from "effect";
import type { JsonValue, ScopedFeedback } from "../shared/types.ts";
import {
  mergeSandboxActionState,
  sandboxActionStateCovers,
  sandboxStepExecutionOf,
  type SandboxActionState,
} from "../sandbox/action.ts";
import { sandboxCapabilities, providerBoundaryEffect } from "../sandbox/backend.ts";
import type { MaterializedSandboxCase } from "../sandbox/case-types.ts";
import { createSandboxCommandTarget } from "../sandbox/operations.ts";
import {
  sandboxProviderBindingOf,
  type BeforeCacheArtifact,
  type BeforeCachePreparationContext,
  type BeforeCachePreparer,
} from "../sandbox/layer.ts";
import { liveSandboxRuntimeServices, type SandboxRuntimeMaterializeInput } from "../sandbox/runtime.ts";
import type { ScheduledSandboxBefore } from "../sandbox/link.ts";
import type { LinkedRunPlan } from "../sandbox/plan.ts";
import { plannedAgentDerivedNode, type PlannedAgentDerivedNode } from "../sandbox/remote-snapshot/agent-derived.ts";
import { ArtifactPrepareCoordinator, runAgentInstall, verifySandboxTargetPlatform } from "../agents/provisioner.ts";
import type { Attempt } from "./types.ts";
import { cacheKey } from "./fingerprint.ts";
import { executeSandboxAction } from "./attempt.ts";
import { plannedBeforeCacheActions, beforeCacheStep, type PlannedBeforeCacheAction } from "./before-cache-plan.ts";

export interface PreparedBeforeCacheUse {
  readonly context: BeforeCachePreparationContext;
  readonly artifact?: BeforeCacheArtifact;
  readonly satisfiedActionCount: number;
  readonly agentDerived?: true;
  readonly degraded?: {
    readonly reason: string;
    readonly operationId: string;
    readonly nodes?: readonly {
      readonly key: string;
      readonly actionId: string;
      readonly owner: string;
      readonly reason: string;
    }[];
  };
}

export interface BeforeCachePreparationResult {
  readonly preparedByPair: ReadonlyMap<string, PreparedBeforeCacheUse>;
  readonly failuresByPair: ReadonlyMap<string, Error>;
  readonly summary: BeforeCachePreparationSummary;
}

export interface BeforeCachePreparationSummary {
  readonly total: number;
  readonly hit: number;
  readonly prepared: number;
  readonly degraded: number;
  readonly failed: number;
}

export const SANDBOX_BEFORE_CACHE_ACTIVITY = "sandbox.before-cache.prepare" as const;

interface BeforeCachePreparationActivityBase {
  readonly id: string;
  readonly key: typeof SANDBOX_BEFORE_CACHE_ACTIVITY;
  readonly provider: string;
  readonly experimentId: string;
  readonly evalId: string;
  readonly attempts: number;
  readonly actionCount: number;
}

export type BeforeCachePreparationActivityEvent =
  | (BeforeCachePreparationActivityBase & {
      readonly status: "started";
      readonly phase: "lookup";
    })
  | (BeforeCachePreparationActivityBase & {
      readonly status: "progress";
      readonly phase: "materialize" | "action" | "capture" | "provider";
      readonly actionIndex: number;
      readonly actionId: string;
      readonly detail?: string;
    })
  | (BeforeCachePreparationActivityBase & {
      readonly status: "done";
      readonly outcome: "hit" | "prepared" | "degraded";
      readonly durationMs: number;
    })
  | (BeforeCachePreparationActivityBase & {
      readonly status: "failed";
      readonly outcome: "failed";
      readonly durationMs: number;
    });

export interface PrepareBeforeCachesOptions {
  readonly runIds: ReadonlyMap<string, string>;
  readonly onWarning?: (warning: ReturnType<typeof beforeCacheReplacementWarnings>[number]) => void;
  readonly signal?: AbortSignal;
  readonly onActivity?: (event: BeforeCachePreparationActivityEvent) => void;
  readonly maxConcurrency?: number;
  readonly artifactPrepare?: ArtifactPrepareCoordinator;
}

interface PreparationNode {
  readonly key: string;
  readonly parentKey?: string;
  readonly representative: Attempt;
  readonly recordRunId: string;
  readonly plan: Extract<LinkedRunPlan, { readonly _tag: "Sandbox" }>;
  readonly preparer: BeforeCachePreparer<void>;
  readonly context: BeforeCachePreparationContext;
  readonly planned: PlannedBeforeCacheAction | PlannedAgentDerivedNode;
  readonly actionIndex: number;
  readonly laneKey: string;
  readonly laneLimit: number;
}

interface PreparationTarget {
  readonly finalKey: string;
  readonly pairKeys: string[];
}

type PreparationWorkResult =
  | { readonly outcome: "hit" | "prepared"; readonly artifact: BeforeCacheArtifact }
  | { readonly outcome: "degraded"; readonly reason: string; readonly operationId: string };

function asError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

function continuousEligibleActions(
  plan: Extract<LinkedRunPlan, { readonly _tag: "Sandbox" }>,
  coverage: SandboxActionState,
): readonly Extract<ScheduledSandboxBefore, { readonly kind: "action" }>[] {
  const pair = plan.pair;
  if (pair.setupHooks.length > 0 || pair.teardownHooks.length > 0 || pair.pluginLifecycles.length > 0)
    return Object.freeze([]);

  const eligible: Extract<ScheduledSandboxBefore, { readonly kind: "action" }>[] = [];
  let cumulative: SandboxActionState | undefined;
  for (const entry of pair.before) {
    if (entry.kind !== "action" || entry.owner.kind === "agent") break;
    // Runtime env/stdin can carry credentials. Until action declarations have
    // an explicit non-sensitive proof, these dynamic input surfaces are barriers.
    if (
      entry.data.steps.some((step) => {
        const execution = sandboxStepExecutionOf(step);
        return execution.kind === "exec" && (execution.input.stdin !== undefined || execution.input.env !== undefined);
      })
    )
      break;
    cumulative = mergeSandboxActionState(cumulative, entry.data.plan.state);
    if (!sandboxActionStateCovers(coverage, cumulative)) break;
    eligible.push(entry);
  }
  return Object.freeze(eligible);
}

function preparationFeedback(progress: (message: string) => void): ScopedFeedback {
  const feedback: ScopedFeedback = {
    progress: ({ message }) => progress(message),
    diagnostic: () => undefined,
  };
  return Object.freeze(feedback);
}

function interruptOnAbort(signal: AbortSignal): Effect.Effect<never> {
  return Effect.callback<never>((resume) => {
    const onAbort = () => resume(Effect.interrupt);
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    return Effect.sync(() => signal.removeEventListener("abort", onAbort));
  });
}

function lookupPreparationNode(
  node: PreparationNode,
): Effect.Effect<PreparationWorkResult | undefined, Error, Scope.Scope> {
  return Effect.gen(function* () {
    const preparation = node.preparer;
    const lookup = yield* preparation
      .lookup(undefined, node.context, [beforeCacheStep(node.planned)])
      .pipe(Effect.mapError(asError));
    if (lookup._tag === "Miss") return undefined;
    if (lookup._tag === "Degraded")
      return {
        outcome: "degraded" as const,
        reason: lookup.reason,
        operationId: `before-cache-${randomUUID()}`,
      };
    const artifact = lookup.artifact;
    if (
      artifact.beforeCacheKey !== node.key ||
      artifact.declarationDigest !== node.planned.declaration.declarationDigest
    ) {
      return yield* Effect.fail(new Error("Provider returned a before-cache artifact outside the requested lineage."));
    }
    return Object.freeze({
      artifact,
      outcome: "hit" as const,
    });
  });
}

function materializePreparationNode(
  node: PreparationNode,
  parent: BeforeCacheArtifact | undefined,
  onProgress: (
    phase: "materialize" | "action" | "capture" | "provider",
    actionIndex: number,
    actionId: string,
    detail?: string,
  ) => void,
  inherited?: MaterializedSandboxCase,
  onPrepared?: (result: PreparationWorkResult, staging: MaterializedSandboxCase) => Effect.Effect<void>,
  artifactPrepare?: ArtifactPrepareCoordinator,
): Effect.Effect<PreparationWorkResult, Error, Scope.Scope> {
  return Effect.gen(function* () {
    const preparation = node.preparer;
    const runScope = yield* Effect.scope;
    if (node.parentKey !== undefined && parent === undefined) {
      return yield* Effect.fail(new Error(`Before cache node ${node.key} became ready without its parent artifact.`));
    }
    {
      const candidate = node.planned;
      const actionIndex = node.actionIndex;
      const actionId = "entry" in candidate ? candidate.entry.data.plan.id : "niceeval.agent-install";
      const feedback = preparationFeedback((message) => onProgress("provider", actionIndex, actionId, message));
      onProgress("materialize", actionIndex, actionId);
      const captured = yield* Effect.scoped(
        Effect.gen(function* () {
          const signal = yield* Effect.abortSignal;
          const runtimeInput: SandboxRuntimeMaterializeInput = {
            runId: node.recordRunId,
            plan: node.plan,
            evalId: node.representative.evalDef.id,
            deadline: { _tag: "Unlimited" },
            feedback,
            signal,
            hookContext: {
              experimentId: node.plan.pair.experimentId,
              signal,
              progress: feedback.progress,
              diagnostic: feedback.diagnostic,
            },
            buildLocators: new Map<string, JsonValue>(),
            beforeCachePreparationContext: node.context,
            ...(parent === undefined ? {} : { beforeCacheArtifact: parent }),
            provisionSlot: { _tag: "Detached" },
            admission: { _tag: "Detached" },
            services: liveSandboxRuntimeServices,
            release: { _tag: "Stop" },
          };
          const created =
            inherited === undefined
              ? yield* preparation
                  .materializeFrom(
                    undefined,
                    node.context,
                    "staging",
                    parent === undefined ? { _tag: "Base" } : { _tag: "Artifact", artifact: parent },
                    runtimeInput,
                  )
                  .pipe(Effect.mapError(asError))
              : { _tag: "Materialized" as const, sandbox: inherited, start: { _tag: "Restored" as const } };
          if (created._tag === "Degraded")
            return {
              outcome: "degraded" as const,
              reason: created.reason,
              operationId: `before-cache-${randomUUID()}`,
            };
          const owned = created.sandbox;
          if (inherited === undefined)
            yield* Effect.addFinalizer(() => providerBoundaryEffect(() => owned.group.stop()).pipe(Effect.orDie));
          if (parent !== undefined && created.start._tag === "FellBackToBase") {
            return {
              outcome: "degraded" as const,
              reason: "parent-unavailable",
              operationId: `before-cache-${randomUUID()}`,
            };
          }
          const commandTarget = createSandboxCommandTarget(owned.sandbox);
          const managed = sandboxCapabilities(owned.sandbox).managedProcess;
          const managedProcess = managed._tag === "Supported" ? managed.value : undefined;
          onProgress("action", actionIndex, actionId);
          if ("entry" in candidate) {
            yield* Effect.tryPromise({
              try: () =>
                executeSandboxAction(candidate.entry.data, commandTarget, managedProcess, signal, feedback.progress),
              catch: asError,
            });
          } else {
            const installed = yield* Effect.result(
              Effect.gen(function* () {
                yield* verifySandboxTargetPlatform(owned.sandbox, node.plan.providerPlan.target.platform);
                yield* runAgentInstall(candidate.installs, candidate.installers, owned.sandbox, {
                  coordinator: Option.fromNullishOr(artifactPrepare),
                  targetPlatform: node.plan.providerPlan.target.platform,
                  signal,
                  progress: feedback.progress,
                });
              }),
            );
            if (Result.isFailure(installed))
              return {
                outcome: "degraded" as const,
                reason: "agent-install-failed",
                operationId: `before-cache-${randomUUID()}`,
              };
          }
          onProgress("capture", actionIndex, actionId);
          const step = beforeCacheStep(candidate);
          const capture = yield* preparation
            .capture(undefined, node.context, owned, step)
            .pipe(Scope.provide(runScope), Effect.mapError(asError));
          if (capture._tag === "Degraded")
            return {
              outcome: "degraded" as const,
              reason: capture.reason,
              operationId: step.operationId,
            };
          const result = { outcome: "prepared" as const, artifact: capture.artifact };
          if (
            result.artifact.beforeCacheKey !== node.key ||
            result.artifact.declarationDigest !== candidate.declaration.declarationDigest
          ) {
            return yield* Effect.fail(new Error("Provider captured an artifact with the wrong before-cache identity."));
          }
          if (onPrepared !== undefined) yield* onPrepared(result, owned);
          return result;
        }),
      );
      if (captured.outcome === "degraded") return captured;
      return Object.freeze({
        artifact: captured.artifact,
        outcome: "prepared" as const,
      });
    }
  });
}
/**
 * Compile and complete every unique provider-native prefix before any Attempt
 * dispatch. Nodes are single-flight by complete BeforeCacheKey. A child becomes
 * ready after its parent's publication completes. A continuing child borrows
 * the parent's live staging while the parent retains its Scope and permits.
 */
export function prepareBeforeCaches(
  attempts: readonly Attempt[],
  options: PrepareBeforeCachesOptions,
): Effect.Effect<BeforeCachePreparationResult, Error, Scope.Scope> {
  const program = Effect.gen(function* () {
    const artifactPrepare = options.artifactPrepare ?? new ArtifactPrepareCoordinator();
    // The graph is shared by every Record Run in this Invocation. Its holds,
    // reservations and disabled-domain state must use that same ownership.
    const preparationId = randomUUID();
    const replacementScopes = new Map<LinkedRunPlan, JsonValue>();
    const nodes = new Map<string, PreparationNode>();
    const targets = new Map<string, PreparationTarget>();
    const contextsByPair = new Map<string, BeforeCachePreparationContext>();
    const dependents = new Map<string, Map<string, { readonly experimentId: string; readonly evalId: string }>>();
    const preparedByPair = new Map<string, PreparedBeforeCacheUse>();
    const failuresByPair = new Map<string, Error>();
    for (const attempt of attempts) {
      const pairKey = cacheKey(attempt.run, attempt.evalDef.id);
      if (
        attempt.run.sandboxBeforeCache === "bypass" ||
        attempt.plan._tag !== "Sandbox" ||
        attempt.plan.providerPlan.capabilities.beforeCache._tag !== "RunPrepared" ||
        attempt.plan.providerPlan.build.buildKeys.length > 0
      )
        continue;
      if (contextsByPair.has(pairKey)) continue;
      const binding = Option.getOrUndefined(sandboxProviderBindingOf(attempt.plan.providerPlan));
      if (binding === undefined || binding.beforeCache._tag !== "RunPrepared") {
        return yield* Effect.fail(new Error("RunPrepared plan has no matching provider binding."));
      }
      const preparation = binding.beforeCache.preparer;
      const runId = options.runIds.get(attempt.run.experimentId);
      if (runId === undefined)
        return yield* Effect.fail(new Error("Before cache preparation has no Record Run identity."));
      const context = Object.freeze({
        providerId: binding.moduleId,
        runId: preparationId,
        materializeBase: binding.materialize,
      });
      contextsByPair.set(pairKey, context);
      const eligible = yield* Effect.result(preparation.eligibility(undefined, context));
      if (Result.isFailure(eligible)) {
        failuresByPair.set(pairKey, asError(eligible.failure));
        continue;
      }
      const eligibility = eligible.success;
      if (eligibility._tag === "Degraded") {
        preparedByPair.set(pairKey, {
          context,
          satisfiedActionCount: 0,
          degraded: { reason: eligibility.reason, operationId: `before-cache-${randomUUID()}` },
        });
        continue;
      }
      if (eligibility._tag !== "Eligible") continue;
      if (eligibility.replacementScope !== undefined)
        replacementScopes.set(attempt.plan, { ...eligibility.replacementScope });
      const entries = continuousEligibleActions(attempt.plan, eligibility.coverage);
      const planned = plannedBeforeCacheActions(attempt.plan, entries, eligibility);
      const agent = attempt.run.agent;
      const derived =
        preparation.supportsAgentDerived === true && agent?.kind === "sandbox"
          ? plannedAgentDerivedNode(attempt.plan, eligibility, agent.install, agent.installers, planned.at(-1))
          : undefined;
      const candidates = derived === undefined ? planned : [...planned, derived];
      if (candidates.length === 0) continue;
      for (let index = 0; index < candidates.length; index++) {
        const candidate = candidates[index]!;
        const incoming: PreparationNode = {
          key: candidate.key,
          ...(index === 0 ? {} : { parentKey: candidates[index - 1]!.key }),
          representative: attempt,
          recordRunId: runId,
          plan: attempt.plan,
          preparer: preparation,
          context,
          planned: candidate,
          actionIndex: Math.min(index + 1, planned.length),
          laneKey: attempt.plan.providerPlan.scheduling.lane.key,
          laneLimit: attempt.plan.providerPlan.scheduling.lane.limit,
        };
        let consumers = dependents.get(candidate.key);
        if (consumers === undefined) {
          consumers = new Map();
          dependents.set(candidate.key, consumers);
        }
        consumers.set(pairKey, { experimentId: attempt.run.experimentId, evalId: attempt.evalDef.id });
        const existing = nodes.get(candidate.key);
        if (existing === undefined) {
          nodes.set(candidate.key, incoming);
        } else if (
          existing.parentKey !== incoming.parentKey ||
          existing.planned.declaration.declarationDigest !== incoming.planned.declaration.declarationDigest ||
          existing.plan.providerPlan.provider !== incoming.plan.providerPlan.provider ||
          existing.laneKey !== incoming.laneKey ||
          existing.laneLimit !== incoming.laneLimit
        ) {
          return yield* Effect.fail(
            new Error(
              `Conflicting before-cache node identity for ${candidate.key}; preparation was rejected before I/O.`,
            ),
          );
        }
      }
      const finalKey = candidates.at(-1)!.key;
      const existingTarget = targets.get(finalKey);
      if (existingTarget === undefined) {
        targets.set(finalKey, { finalKey, pairKeys: [pairKey] });
      } else {
        if (!existingTarget.pairKeys.includes(pairKey)) existingTarget.pairKeys.push(pairKey);
      }
    }

    for (const warning of beforeCacheReplacementWarnings([...replacementScopes.keys()], replacementScopes))
      options.onWarning?.(warning);

    // Validate the complete graph before the first provider lookup or materialization.
    for (const node of nodes.values()) {
      const seen = new Set<string>();
      let cursor: PreparationNode | undefined = node;
      while (cursor !== undefined) {
        if (seen.has(cursor.key)) {
          return yield* Effect.fail(
            new Error(`Before cache DAG cycle at ${cursor.key}; preparation was rejected before I/O.`),
          );
        }
        seen.add(cursor.key);
        cursor = cursor.parentKey === undefined ? undefined : nodes.get(cursor.parentKey);
        if (cursor === undefined && node.parentKey !== undefined && !seen.has(node.parentKey)) {
          return yield* Effect.fail(new Error(`Before cache DAG node ${node.key} is not reachable from Base.`));
        }
      }
    }

    const globalGate = yield* Semaphore.make(Math.max(1, options.maxConcurrency ?? 2));
    const laneGates = new Map<string, Semaphore.Semaphore>();
    for (const node of nodes.values()) {
      if (!laneGates.has(node.laneKey)) laneGates.set(node.laneKey, yield* Semaphore.make(node.laneLimit));
    }
    type NodeResult = Result.Result<PreparationWorkResult, Error>;
    const completions = new Map<string, Deferred.Deferred<NodeResult>>();
    const retirements = new Map<string, Deferred.Deferred<void>>();
    for (const node of nodes.values()) {
      completions.set(node.key, yield* Deferred.make<NodeResult>());
      retirements.set(node.key, yield* Deferred.make<void>());
    }
    const claimed = new Set<string>();
    const stagingOffers = new Map<string, MaterializedSandboxCase>();
    const outcomes = new Map<string, "hit" | "prepared" | "degraded" | "failed">();

    const resolveNode = (key: string): Effect.Effect<NodeResult, never, Scope.Scope> =>
      Effect.suspend(() => {
        const completion = completions.get(key)!;
        if (claimed.has(key)) return Deferred.await(completion);
        claimed.add(key);
        const node = nodes.get(key)!;
        return Effect.gen(function* () {
          const activity = {
            id: randomUUID(),
            key: SANDBOX_BEFORE_CACHE_ACTIVITY,
            provider: node.plan.providerPlan.provider,
            experimentId: node.plan.pair.experimentId,
            evalId: node.plan.pair.evalId,
            attempts: 1,
            actionCount: node.actionIndex,
          } as const;
          const activities = [...dependents.get(node.key)!.values()].map((pair) => ({
            ...activity,
            ...pair,
            id: randomUUID(),
          }));
          const emit = (event: BeforeCachePreparationActivityEvent) => {
            for (const consumer of activities) options.onActivity?.({ ...event, ...consumer });
          };
          const startedAt = Date.now();
          let finished = false;
          emit({ ...activity, status: "started", phase: "lookup" });
          const finish = (result: NodeResult): Effect.Effect<NodeResult> =>
            Effect.gen(function* () {
              if (finished) return result;
              finished = true;
              outcomes.set(node.key, Result.isFailure(result) ? "failed" : result.success.outcome);
              const durationMs = Math.max(0, Date.now() - startedAt);
              emit(
                Result.isFailure(result)
                  ? { ...activity, status: "failed", outcome: "failed", durationMs }
                  : { ...activity, status: "done", outcome: result.success.outcome, durationMs },
              );
              yield* Deferred.succeed(completion, result);
              return result;
            });
          const parentResult = node.parentKey === undefined ? undefined : yield* resolveNode(node.parentKey);
          if (parentResult !== undefined && Result.isFailure(parentResult))
            return yield* finish(Result.fail(parentResult.failure));
          if (
            parentResult !== undefined &&
            Result.isSuccess(parentResult) &&
            parentResult.success.outcome === "degraded"
          ) {
            return yield* finish(
              Result.succeed({
                outcome: "degraded",
                reason: "parent-unavailable",
                operationId: parentResult.success.operationId,
              }),
            );
          }
          const parent =
            parentResult !== undefined && Result.isSuccess(parentResult) && parentResult.success.outcome !== "degraded"
              ? parentResult.success.artifact
              : undefined;
          const laneGate = laneGates.get(node.laneKey)!;
          const inherited = stagingOffers.get(node.key);
          stagingOffers.delete(node.key);
          const withGate = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
            inherited === undefined ? globalGate.withPermits(1)(laneGate.withPermits(1)(effect)) : effect;
          const lookup = yield* Effect.result(withGate(lookupPreparationNode(node)));
          if (Result.isFailure(lookup)) return yield* finish(Result.fail(lookup.failure));
          if (lookup.success !== undefined) return yield* finish(Result.succeed(lookup.success));
          const result = yield* Effect.result(
            withGate(
              materializePreparationNode(
                node,
                parent,
                (phase, actionIndex, actionId, detail) =>
                  emit({
                    ...activity,
                    status: "progress",
                    phase,
                    actionIndex,
                    actionId,
                    ...(detail === undefined ? {} : { detail }),
                  }),
                inherited,
                (prepared, staging) =>
                  Effect.gen(function* () {
                    if (!node.preparer.continuesStaging) return;
                    const child = [...nodes.values()]
                      .filter((candidate) => candidate.parentKey === node.key)
                      .sort((left, right) => left.key.localeCompare(right.key))[0];
                    if (child === undefined) return;
                    stagingOffers.set(child.key, staging);
                    // Publish the parent before waking the child, while its staging Scope
                    // and both concurrency permits remain owned by this chain.
                    yield* finish(Result.succeed(prepared));
                    // Publication wakes descendants, but does not retire their borrowed
                    // staging. Keep the ancestor Scope open through the entire continuation.
                    yield* Deferred.await(retirements.get(child.key)!);
                  }),
                artifactPrepare,
              ),
            ),
          );
          return yield* finish(result);
        }).pipe(Effect.ensuring(Deferred.succeed(retirements.get(node.key)!, undefined)));
      });

    const terminal = new Map<string, NodeResult>(
      yield* Effect.all(
        [...nodes.keys()].map((key) => resolveNode(key).pipe(Effect.map((result) => [key, result] as const))),
        { concurrency: "unbounded" },
      ),
    );

    for (const target of targets.values()) {
      const result = terminal.get(target.finalKey)!;
      if (Result.isFailure(result)) {
        for (const pairKey of target.pairKeys) failuresByPair.set(pairKey, result.failure);
        continue;
      }
      let cursor: PreparationNode | undefined = nodes.get(target.finalKey);
      let use: Omit<PreparedBeforeCacheUse, "context"> = { satisfiedActionCount: 0 };
      const degradedNodes: NonNullable<NonNullable<PreparedBeforeCacheUse["degraded"]>["nodes"]>[number][] = [];
      while (cursor !== undefined) {
        const ancestor = terminal.get(cursor.key)!;
        if (Result.isSuccess(ancestor) && ancestor.success.outcome !== "degraded") {
          use = {
            artifact: ancestor.success.artifact,
            satisfiedActionCount: cursor.actionIndex,
            ...("installs" in cursor.planned ? { agentDerived: true as const } : {}),
          };
          break;
        }
        if (Result.isSuccess(ancestor) && ancestor.success.outcome === "degraded") {
          const planned = cursor.planned;
          degradedNodes.push({
            key: cursor.key,
            actionId: "entry" in planned ? planned.entry.id : "niceeval.agent-install",
            owner: "entry" in planned ? `${planned.entry.owner.kind}:${planned.entry.owner.id}` : "agent",
            reason: ancestor.success.reason,
          });
        }
        cursor = cursor.parentKey === undefined ? undefined : nodes.get(cursor.parentKey);
      }
      if (result.success.outcome === "degraded")
        use = {
          ...use,
          degraded: {
            reason: result.success.reason,
            operationId: result.success.operationId,
            nodes: degradedNodes.reverse(),
          },
        };
      for (const pairKey of target.pairKeys)
        preparedByPair.set(pairKey, Object.freeze({ ...use, context: contextsByPair.get(pairKey)! }));
    }
    const settled = [...outcomes.values()];
    return Object.freeze({
      preparedByPair,
      failuresByPair,
      summary: Object.freeze({
        total: nodes.size,
        hit: settled.filter((outcome) => outcome === "hit").length,
        prepared: settled.filter((outcome) => outcome === "prepared").length,
        degraded: settled.filter((outcome) => outcome === "degraded").length,
        failed: settled.filter((outcome) => outcome === "failed").length,
      }),
    });
  });
  return options.signal === undefined ? program : Effect.raceFirst(program, interruptOnAbort(options.signal));
}
