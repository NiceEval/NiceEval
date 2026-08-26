import { randomUUID } from "node:crypto";
import { Effect, Either, Option } from "effect";
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
}

interface PreparationWork {
  readonly finalKey: string;
  readonly representative: Attempt;
  readonly plan: Extract<LinkedRunPlan, { readonly _tag: "Sandbox" }>;
  readonly binding: SandboxProviderBinding;
  readonly planned: readonly PlannedSetupPrefixAction[];
  readonly pairKeys: string[];
  attemptCount: number;
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

function operationIndex(
  planned: readonly PlannedSetupPrefixAction[],
  artifact: SandboxPreparedSetupPrefixArtifact,
): number {
  return planned.findIndex((candidate) =>
    candidate.key === artifact.setupPrefixKey &&
    candidate.manifest.setupManifestDigest === artifact.manifestDigest
  );
}

function executePreparationWork(
  work: PreparationWork,
  signal: AbortSignal,
  onProgress: (
    phase: "materialize" | "action" | "capture" | "provider",
    actionIndex: number,
    actionId: string,
    detail?: string,
  ) => void,
): Effect.Effect<PreparationWorkResult, Error> {
  return Effect.gen(function* () {
    const preparation = work.binding.setupPrefixPreparation;
    if (preparation === undefined) {
      return yield* Effect.fail(
        new Error("Sandbox provider omitted its prepared setup-prefix runtime binding."),
      );
    }
    const operationsDeepestFirst = [...work.planned]
      .reverse()
      .map((planned) => setupPrefixOperation(planned));
    const lookup = yield* preparation.lookup(operationsDeepestFirst).pipe(Effect.mapError(asError));
    let ancestor = lookup._tag === "Hit" ? lookup.artifact : undefined;
    let ancestorIndex = ancestor === undefined ? -1 : operationIndex(work.planned, ancestor);
    if (ancestor !== undefined && ancestorIndex < 0) {
      return yield* Effect.fail(
        new Error("Provider returned a setup-prefix artifact outside the requested lineage."),
      );
    }
    if (ancestorIndex === work.planned.length - 1 && ancestor !== undefined) {
      return Object.freeze({
        use: Object.freeze({
          artifact: ancestor,
          satisfiedActionCount: work.planned.length,
        }),
        outcome: "hit" as const,
      });
    }

    for (let index = ancestorIndex + 1; index < work.planned.length; index++) {
      const candidate = work.planned[index]!;
      const parent = ancestor;
      const actionIndex = index + 1;
      const actionId = candidate.entry.data.plan.id;
      const feedback = preparationFeedback((message) =>
        onProgress("provider", actionIndex, actionId, message)
      );
      onProgress("materialize", actionIndex, actionId);
      const runtimeInput: SandboxRuntimeMaterializeInput = {
        plan: work.plan,
        evalId: work.representative.evalDef.id,
        deadline: { _tag: "Unlimited" },
        feedback,
        signal,
        hookContext: {
          experimentId: work.plan.pair.experimentId,
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
          ),
          catch: asError,
        });
        onProgress("capture", actionIndex, actionId);
        return yield* preparation.capture(owned, setupPrefixOperation(candidate)).pipe(
          Effect.mapError(asError),
        );
      }));
      if (operationIndex(work.planned, captured) !== index) {
        return yield* Effect.fail(
          new Error("Provider captured an artifact with the wrong setup-prefix identity."),
        );
      }
      ancestor = captured;
      ancestorIndex = index;
    }

    if (ancestor === undefined) {
      return yield* Effect.fail(new Error("Prepared setup-prefix work produced no artifact."));
    }
    return Object.freeze({
      use: Object.freeze({
        artifact: ancestor,
        satisfiedActionCount: work.planned.length,
      }),
      outcome: "prepared" as const,
    });
  });
}
/**
 * Compile and complete every unique provider-native prefix before any Attempt
 * dispatch. Work is serial so a capacity-one execution domain never deadlocks
 * a prepare VM against an Attempt VM.
 */
export function prepareSetupPrefixes(
  attempts: readonly Attempt[],
  judgePrecheckFailures: ReadonlyMap<string, string>,
  options: PrepareSetupPrefixesOptions = {},
): Effect.Effect<SetupPrefixPreparationResult> {
  return Effect.gen(function* () {
    const works = new Map<string, PreparationWork>();
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
      const finalKey = planned.at(-1)!.key;
      const existing = works.get(finalKey);
      if (existing === undefined) {
        works.set(finalKey, {
          finalKey,
          representative: attempt,
          plan: attempt.plan,
          binding,
          planned,
          pairKeys: [pairKey],
          attemptCount: 1,
        });
      } else {
        existing.attemptCount += 1;
        if (!existing.pairKeys.includes(pairKey)) existing.pairKeys.push(pairKey);
      }
    }

    const preparedByPair = new Map<string, PreparedSetupPrefixUse>();
    const failuresByPair = new Map<string, Error>();
    const preparationSignal = options.signal ?? new AbortController().signal;
    for (const work of works.values()) {
      const activity = {
        id: randomUUID(),
        key: SANDBOX_SETUP_PREFIX_ACTIVITY,
        provider: work.plan.providerPlan.provider,
        experimentId: work.plan.pair.experimentId,
        evalId: work.plan.pair.evalId,
        attempts: work.attemptCount,
        actionCount: work.planned.length,
      } as const;
      const startedAt = Date.now();
      options.onActivity?.({ ...activity, status: "started", phase: "lookup" });
      const result = yield* Effect.either(executePreparationWork(
        work,
        preparationSignal,
        (phase, actionIndex, actionId, detail) => options.onActivity?.({
          ...activity,
          status: "progress",
          phase,
          actionIndex,
          actionId,
          ...(detail === undefined ? {} : { detail }),
        }),
      ));
      const durationMs = Math.max(0, Date.now() - startedAt);
      if (Either.isLeft(result)) {
        options.onActivity?.({
          ...activity,
          status: "failed",
          outcome: "failed",
          durationMs,
        });
        for (const pairKey of work.pairKeys) failuresByPair.set(pairKey, result.left);
      } else {
        options.onActivity?.({
          ...activity,
          status: "done",
          outcome: result.right.outcome,
          durationMs,
        });
        for (const pairKey of work.pairKeys) preparedByPair.set(pairKey, result.right.use);
      }
    }
    return Object.freeze({ preparedByPair, failuresByPair });
  });
}
