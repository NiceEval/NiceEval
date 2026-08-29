import { randomUUID } from "node:crypto";
import { Deferred, Effect, Result, Option, Semaphore } from "effect";
import type { JsonValue, ScopedFeedback } from "../shared/types.ts";
import {
  mergeSandboxActionState,
  sandboxActionStateCovers,
  sandboxStepExecutionOf,
  type SandboxActionState,
} from "../sandbox/action.ts";
import { sandboxCapabilities } from "../sandbox/backend.ts";
import { createSandboxCommandTarget } from "../sandbox/operations.ts";
import {
  sandboxProviderBindingOf,
  type SandboxPreparedSetupPrefixArtifact,
  type SandboxProviderBinding,
} from "../sandbox/layer.ts";
import {
  acquireSandboxRunPlan,
  liveSandboxRuntimeServices,
  type SandboxRuntimeMaterializeInput,
} from "../sandbox/runtime.ts";
import type { ScheduledSandboxBefore } from "../sandbox/link.ts";
import type { LinkedRunPlan } from "../sandbox/plan.ts";
import type { Attempt } from "./types.ts";
import { cacheKey } from "./fingerprint.ts";
import { executeSandboxAction } from "./attempt.ts";
import {
  plannedSetupPrefixActions,
  setupPrefixOperation,
  type PlannedSetupPrefixAction,
} from "./setup-prefix-plan.ts";

export interface PreparedSetupPrefixUse {
  readonly artifact: SandboxPreparedSetupPrefixArtifact;
  readonly satisfiedActionCount: number;
}

export interface SetupPrefixPreparationResult {
  readonly preparedByPair: ReadonlyMap<string, PreparedSetupPrefixUse>;
  readonly failuresByPair: ReadonlyMap<string, Error>;
}

export const SANDBOX_SETUP_PREFIX_ACTIVITY = "sandbox.setup-prefix.prepare" as const;

interface SetupPrefixPreparationActivityBase {
  readonly id: string;
  readonly key: typeof SANDBOX_SETUP_PREFIX_ACTIVITY;
  readonly provider: string;
  readonly experimentId: string;
  readonly evalId: string;
  readonly attempts: number;
  readonly actionCount: number;
}

export type SetupPrefixPreparationActivityEvent =
  | SetupPrefixPreparationActivityBase & {
      readonly status: "started";
      readonly phase: "lookup";
    }
  | SetupPrefixPreparationActivityBase & {
      readonly status: "progress";
      readonly phase: "materialize" | "action" | "capture" | "provider";
      readonly actionIndex: number;
      readonly actionId: string;
      readonly detail?: string;
    }
  | SetupPrefixPreparationActivityBase & {
      readonly status: "done";
      readonly outcome: "hit" | "prepared";
      readonly durationMs: number;
    }
  | SetupPrefixPreparationActivityBase & {
      readonly status: "failed";
      readonly outcome: "failed";
      readonly durationMs: number;
    };

export interface PrepareSetupPrefixesOptions {
  readonly signal?: AbortSignal;
  readonly onActivity?: (event: SetupPrefixPreparationActivityEvent) => void;
  readonly maxConcurrency?: number;
}

interface PreparationNode {
  readonly key: string;
  readonly parentKey?: string;
  readonly representative: Attempt;
  readonly plan: Extract<LinkedRunPlan, { readonly _tag: "Sandbox" }>;
  readonly binding: SandboxProviderBinding;
  readonly planned: PlannedSetupPrefixAction;
  readonly actionIndex: number;
  readonly laneKey: string;
  readonly laneLimit: number;
}

interface PreparationTarget {
  readonly finalKey: string;
  readonly pairKeys: string[];
}

interface PreparationWorkResult {
  readonly use: PreparedSetupPrefixUse;
  readonly outcome: "hit" | "prepared";
}

function asError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

function continuousEligibleActions(
  plan: Extract<LinkedRunPlan, { readonly _tag: "Sandbox" }>,
  coverage: SandboxActionState,
): readonly Extract<ScheduledSandboxBefore, { readonly kind: "action" }>[] {
  const pair = plan.pair;
  if (
    pair.setupHooks.length > 0 ||
    pair.teardownHooks.length > 0 ||
    pair.pluginLifecycles.length > 0
  ) return Object.freeze([]);

  const eligible: Extract<ScheduledSandboxBefore, { readonly kind: "action" }>[] = [];
  let cumulative: SandboxActionState | undefined;
  for (const entry of pair.before) {
    if (entry.kind !== "action" || entry.owner.kind === "agent") break;
    // Runtime env/stdin can carry credentials. Until action declarations have
    // an explicit non-sensitive proof, these dynamic input surfaces are barriers.
    if (entry.data.steps.some((step) => {
      const execution = sandboxStepExecutionOf(step);
      return execution.kind === "exec" &&
        (execution.input.stdin !== undefined || execution.input.env !== undefined);
    })) break;
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

function executePreparationNode(
  node: PreparationNode,
  parent: SandboxPreparedSetupPrefixArtifact | undefined,
  signal: AbortSignal,
  onProgress: (
    phase: "materialize" | "action" | "capture" | "provider",
    actionIndex: number,
    actionId: string,
    detail?: string,
  ) => void,
): Effect.Effect<PreparationWorkResult, Error> {
  return Effect.gen(function* () {
    const preparation = node.binding.setupPrefixPreparation;
    if (preparation === undefined) {
      return yield* Effect.fail(
        new Error("Sandbox provider omitted its prepared setup-prefix runtime binding."),
      );
    }
    const lookup = yield* preparation.lookup([setupPrefixOperation(node.planned)]).pipe(Effect.mapError(asError));
    if (lookup._tag === "Hit") {
      const artifact = lookup.artifact;
      if (
        artifact.setupPrefixKey !== node.key ||
        artifact.manifestDigest !== node.planned.manifest.setupManifestDigest
      ) {
        return yield* Effect.fail(new Error("Provider returned a setup-prefix artifact outside the requested lineage."));
      }
      return Object.freeze({
        use: Object.freeze({ artifact, satisfiedActionCount: node.actionIndex }),
        outcome: "hit" as const,
      });
    }
    if (node.parentKey !== undefined && parent === undefined) {
      return yield* Effect.fail(
        new Error(`Setup-prefix node ${node.key} became ready without its parent artifact.`),
      );
    }
    {
      const candidate = node.planned;
      const actionIndex = node.actionIndex;
      const actionId = candidate.entry.data.plan.id;
      const feedback = preparationFeedback((message) =>
        onProgress("provider", actionIndex, actionId, message)
      );
      onProgress("materialize", actionIndex, actionId);
      const runtimeInput: SandboxRuntimeMaterializeInput = {
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
        ...(parent === undefined ? {} : { setupPrefixArtifact: parent.locator }),
        provisionSlot: { _tag: "Detached" },
        admission: { _tag: "Detached" },
        services: liveSandboxRuntimeServices,
        release: { _tag: "Stop" },
      };
      const captured = yield* Effect.scoped(Effect.gen(function* () {
        const owned = yield* acquireSandboxRunPlan(runtimeInput).pipe(Effect.mapError(asError));
        const commandTarget = createSandboxCommandTarget(owned.sandbox);
        const managed = sandboxCapabilities(owned.sandbox).managedProcess;
        const managedProcess = managed._tag === "Supported" ? managed.value : undefined;
        onProgress("action", actionIndex, actionId);
        yield* Effect.tryPromise({
          try: () => executeSandboxAction(
            candidate.entry.data,
            commandTarget,
            managedProcess,
            signal,
            feedback.progress,
          ),
          catch: asError,
        });
        onProgress("capture", actionIndex, actionId);
        return yield* preparation.capture(owned, setupPrefixOperation(candidate)).pipe(
          Effect.mapError(asError),
        );
      }));
      if (
        captured.setupPrefixKey !== node.key ||
        captured.manifestDigest !== candidate.manifest.setupManifestDigest
      ) {
        return yield* Effect.fail(
          new Error("Provider captured an artifact with the wrong setup-prefix identity."),
        );
      }
      return Object.freeze({
        use: Object.freeze({ artifact: captured, satisfiedActionCount: actionIndex }),
        outcome: "prepared" as const,
      });
    }
  });
}
/**
 * Compile and complete every unique provider-native prefix before any Attempt
 * dispatch. Nodes are single-flight by complete SetupPrefixKey. A child becomes
 * ready only after its parent's publication effect and scoped materialization
 * have both completed.
 */
export function prepareSetupPrefixes(
  attempts: readonly Attempt[],
  judgePrecheckFailures: ReadonlyMap<string, string>,
  options: PrepareSetupPrefixesOptions = {},
): Effect.Effect<SetupPrefixPreparationResult, Error> {
  return Effect.gen(function* () {
    const nodes = new Map<string, PreparationNode>();
    const targets = new Map<string, PreparationTarget>();
    for (const attempt of attempts) {
      const pairKey = cacheKey(attempt.run, attempt.evalDef.id);
      if (
        attempt.run.sandboxSetupCache === "bypass" ||
        judgePrecheckFailures.has(pairKey) ||
        attempt.plan._tag !== "Sandbox" ||
        attempt.plan.providerPlan.capabilities.setupPrefix._tag !== "PreparedArtifact" ||
        attempt.plan.providerPlan.build.buildKeys.length > 0
      ) continue;
      const binding = Option.getOrUndefined(sandboxProviderBindingOf(attempt.plan.providerPlan));
      const preparation = binding?.setupPrefixPreparation;
      if (binding === undefined || preparation === undefined) continue;
      let eligibility;
      try {
        eligibility = preparation.eligibility();
      } catch {
        continue;
      }
      if (eligibility._tag !== "Eligible") continue;
      const entries = continuousEligibleActions(attempt.plan, eligibility.coverage);
      if (entries.length === 0) continue;
      const planned = plannedSetupPrefixActions(attempt.plan, entries, eligibility);
      for (let index = 0; index < planned.length; index++) {
        const candidate = planned[index]!;
        const incoming: PreparationNode = {
          key: candidate.key,
          ...(index === 0 ? {} : { parentKey: planned[index - 1]!.key }),
          representative: attempt,
          plan: attempt.plan,
          binding,
          planned: candidate,
          actionIndex: index + 1,
          laneKey: attempt.plan.providerPlan.scheduling.lane.key,
          laneLimit: attempt.plan.providerPlan.scheduling.lane.limit,
        };
        const existing = nodes.get(candidate.key);
        if (existing === undefined) {
          nodes.set(candidate.key, incoming);
        } else if (
          existing.parentKey !== incoming.parentKey ||
          existing.planned.manifest.setupManifestDigest !== incoming.planned.manifest.setupManifestDigest ||
          existing.plan.providerPlan.provider !== incoming.plan.providerPlan.provider ||
          existing.laneKey !== incoming.laneKey ||
          existing.laneLimit !== incoming.laneLimit
        ) {
          return yield* Effect.fail(new Error(
            `Conflicting setup-prefix node identity for ${candidate.key}; preparation was rejected before I/O.`,
          ));
        }
      }
      const finalKey = planned.at(-1)!.key;
      const existingTarget = targets.get(finalKey);
      if (existingTarget === undefined) {
        targets.set(finalKey, { finalKey, pairKeys: [pairKey] });
      } else {
        if (!existingTarget.pairKeys.includes(pairKey)) existingTarget.pairKeys.push(pairKey);
      }
    }

    // Validate the complete graph before the first provider lookup or materialization.
    for (const node of nodes.values()) {
      const seen = new Set<string>();
      let cursor: PreparationNode | undefined = node;
      while (cursor !== undefined) {
        if (seen.has(cursor.key)) {
          return yield* Effect.fail(new Error(`Setup-prefix DAG cycle at ${cursor.key}; preparation was rejected before I/O.`));
        }
        seen.add(cursor.key);
        cursor = cursor.parentKey === undefined ? undefined : nodes.get(cursor.parentKey);
        if (cursor === undefined && node.parentKey !== undefined && !seen.has(node.parentKey)) {
          return yield* Effect.fail(new Error(`Setup-prefix DAG node ${node.key} is not reachable from Base.`));
        }
      }
    }

    const preparedByPair = new Map<string, PreparedSetupPrefixUse>();
    const failuresByPair = new Map<string, Error>();
    const preparationSignal = options.signal ?? new AbortController().signal;
    const globalGate = yield* Semaphore.make(Math.max(1, options.maxConcurrency ?? 2));
    const laneGates = new Map<string, Semaphore.Semaphore>();
    for (const node of nodes.values()) {
      if (!laneGates.has(node.laneKey)) laneGates.set(node.laneKey, yield* Semaphore.make(node.laneLimit));
    }
    type NodeResult = Result.Result<PreparationWorkResult, Error>;
    const completions = new Map<string, Deferred.Deferred<NodeResult>>();
    for (const node of nodes.values()) completions.set(node.key, yield* Deferred.make<NodeResult>());
    const settled = yield* Effect.all([...nodes.values()].map((node) => Effect.gen(function* () {
      const parentResult = node.parentKey === undefined
        ? undefined
        : yield* Deferred.await(completions.get(node.parentKey)!);
      if (parentResult !== undefined && Result.isFailure(parentResult)) {
        const blocked = Result.fail(parentResult.failure);
        yield* Deferred.succeed(completions.get(node.key)!, blocked);
        return [node.key, blocked] as const;
      }
      const activity = {
        id: randomUUID(), key: SANDBOX_SETUP_PREFIX_ACTIVITY,
        provider: node.plan.providerPlan.provider,
        experimentId: node.plan.pair.experimentId, evalId: node.plan.pair.evalId,
        attempts: 1, actionCount: node.actionIndex,
      } as const;
      const startedAt = Date.now();
      options.onActivity?.({ ...activity, status: "started", phase: "lookup" });
      const parent = parentResult !== undefined && Result.isSuccess(parentResult)
        ? parentResult.success.use.artifact
        : undefined;
      const laneGate = laneGates.get(node.laneKey)!;
      const result = yield* Effect.result(globalGate.withPermits(1)(laneGate.withPermits(1)(
        executePreparationNode(node, parent, preparationSignal, (phase, actionIndex, actionId, detail) =>
          options.onActivity?.({ ...activity, status: "progress", phase, actionIndex, actionId,
            ...(detail === undefined ? {} : { detail }) }),
        ),
      )));
      const durationMs = Math.max(0, Date.now() - startedAt);
      options.onActivity?.(Result.isFailure(result)
        ? { ...activity, status: "failed", outcome: "failed", durationMs }
        : { ...activity, status: "done", outcome: result.success.outcome, durationMs });
      yield* Deferred.succeed(completions.get(node.key)!, result);
      return [node.key, result] as const;
    })), { concurrency: "unbounded" });
    const terminal = new Map<string, NodeResult>(settled);

    for (const target of targets.values()) {
      const result = terminal.get(target.finalKey)!;
      if (Result.isFailure(result)) {
        for (const pairKey of target.pairKeys) failuresByPair.set(pairKey, result.failure);
      } else {
        for (const pairKey of target.pairKeys) preparedByPair.set(pairKey, result.success.use);
      }
    }
    return Object.freeze({ preparedByPair, failuresByPair });
  });
}
