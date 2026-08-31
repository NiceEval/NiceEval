import { resolve } from "node:path";

import { Clock, Effect, Result } from "effect";
import type { ProjectStateDatabase } from "../../record/sqlite/project-state-database.ts";

import { cleanupCallback } from "../../runner/cleanup-timeout.ts";
import { discoverEvals, discoverExperiments } from "../../runner/discover.ts";
import { resolveExperimentEvals } from "../../runner/eval-selection.ts";
import {
  beginExplicitSharedStateRecoveryEffect,
  completeExplicitSharedStateRecoveryEffect,
  readSharedStateLeaseRecoveryTargetEffect,
  type SharedStateLeaseRecord,
} from "../../runner/shared-state-lease.ts";
import {
  isExactTeardownRegistrationOwnerTerminatedEffect,
  isOrphanedTeardownRegistration,
  readExactTeardownRegistrationEffect,
  readTeardownRegistrationsEffect,
  removeTeardownRegistrationIfPresentEffect,
  teardownEntryId,
} from "../../runner/teardown-registry.ts";
import type {
  DiscoveredExperiment,
  ExperimentHook,
  ExperimentHookContext,
} from "../../runner/types.ts";
import { matchExperimentSelector } from "../../shared/aggregate.ts";
import { ExperimentHostError } from "./types.ts";

import type {
  ExperimentHostTeardownEvent,
  ExperimentHostTeardownObserver,
  ExperimentHostOperation,
  ExperimentHostSharedStateEvidence,
  ExperimentHostTeardownInspection,
  ExperimentHostTeardownInspectRequest,
  ExperimentHostTeardownRequest,
  ExperimentHostTeardownResult,
} from "./types.ts";

function operationError(
  operation: ExperimentHostOperation,
  cause: unknown,
): ExperimentHostError {
  if (cause instanceof ExperimentHostError) return cause;
  const code = typeof cause === "object" && cause !== null && typeof Reflect.get(cause, "code") === "string"
    ? String(Reflect.get(cause, "code"))
    : "experiment-host-operation-failed";
  return new ExperimentHostError({
    operation,
    code,
    message: cause instanceof Error ? cause.message : String(cause),
  });
}

function closeOperation<A, E, R>(
  operation: ExperimentHostOperation,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, ExperimentHostError, R> {
  return effect.pipe(Effect.mapError((cause) => operationError(operation, cause)));
}

function recoveryOperationError(code: string, cause: unknown): ExperimentHostError {
  return new ExperimentHostError({
    operation: "teardown-run",
    code,
    message: cause instanceof Error ? cause.message : String(cause),
  });
}

interface TeardownSelection {
  readonly experimentIds: readonly string[];
  readonly selected: readonly {
    readonly experiment: DiscoveredExperiment;
    readonly selectedEvalIds: readonly string[];
  }[];
}

function freezeArray<A>(values: Iterable<A>): readonly A[] {
  return Object.freeze([...values]);
}

function selectTeardowns(input: {
  readonly cwd: string;
  readonly experimentSelector?: string;
}): Effect.Effect<TeardownSelection, unknown> {
  return Effect.gen(function* () {
    const evals = yield* discoverEvals(input.cwd);
    const experiments = yield* discoverExperiments(input.cwd);
    const experimentIds = freezeArray(experiments.map((experiment) => experiment.id));
    const matched = input.experimentSelector === undefined
      ? experiments
      : experiments.filter((experiment) =>
          matchExperimentSelector(experimentIds, input.experimentSelector!).includes(experiment.id));
    return Object.freeze({
      experimentIds,
      selected: freezeArray(matched.map((experiment) => {
        const selection = resolveExperimentEvals({
          experimentId: experiment.id,
          selector: experiment.evals,
          cliPatterns: [],
          evals,
        });
        return Object.freeze({
          experiment,
          selectedEvalIds: freezeArray(selection.selectedEvalIds),
        });
      })),
    });
  });
}

function teardownOf(experiment: DiscoveredExperiment): ExperimentHook | undefined {
  return typeof experiment.teardown === "function" ? experiment.teardown : undefined;
}

function evidenceOf(record: SharedStateLeaseRecord): ExperimentHostSharedStateEvidence {
  return Object.freeze({
    key: record.key,
    experimentId: record.experimentId,
    ownerToken: record.ownerToken,
    host: record.host,
    pid: record.pid,
    processIdentity: record.processIdentity,
    heartbeatAt: record.heartbeatAt,
  });
}

function noExperimentMatch(
  selector: string,
  selection: TeardownSelection,
): ExperimentHostTeardownInspection {
  return Object.freeze({
    status: "experiment-no-match" as const,
    selector,
    candidates: freezeArray([...selection.experimentIds].sort()),
  });
}

function inspectExactRegistration(input: {
  readonly coordinationRoot: string;
  readonly record: SharedStateLeaseRecord;
  readonly currentHost: string;
}): Effect.Effect<boolean, unknown, ProjectStateDatabase> {
  const id = teardownEntryId(input.record.experimentId, input.record.pid);
  return Effect.gen(function* () {
    const registration = yield* readExactTeardownRegistrationEffect(
      input.coordinationRoot,
      input.record.experimentId,
      input.record.pid,
    );
    if (registration === undefined) return false;
    if (registration.host !== input.record.host) {
      return yield* Effect.fail(new Error(
        `teardown registration ${JSON.stringify(id)} belongs to host ${JSON.stringify(registration.host)}, ` +
        `not immutable sharedState owner host ${JSON.stringify(input.record.host)}`,
      ));
    }
    const terminated = yield* isExactTeardownRegistrationOwnerTerminatedEffect({
      registration,
      owner: input.record,
      currentHost: input.currentHost,
    });
    if (!terminated) {
      return yield* Effect.fail(new Error(
        `teardown registration ${JSON.stringify(id)} still belongs to a live exact sharedState owner`,
      ));
    }
    return true;
  });
}

function clearExactRegistration(input: {
  readonly coordinationRoot: string;
  readonly record: SharedStateLeaseRecord;
  readonly currentHost: string;
  readonly expectedRegistration: boolean;
}): Effect.Effect<void, unknown, ProjectStateDatabase> {
  const id = teardownEntryId(input.record.experimentId, input.record.pid);
  return Effect.gen(function* () {
    const present = yield* inspectExactRegistration(input);
    if (!present) {
      if (input.expectedRegistration) {
        return yield* Effect.fail(new Error(
          `teardown registration ${JSON.stringify(id)} disappeared before recovery could clear it`,
        ));
      }
      return;
    }
    if (!input.expectedRegistration) {
      return yield* Effect.fail(new Error(
        `teardown registration ${JSON.stringify(id)} appeared after recovery was claimed`,
      ));
    }
    if (!(yield* removeTeardownRegistrationIfPresentEffect(input.coordinationRoot, id))) {
      return yield* Effect.fail(new Error(
        `teardown registration ${JSON.stringify(id)} changed before recovery could clear it`,
      ));
    }
  });
}

function emit(observer: ExperimentHostTeardownObserver | undefined, event: ExperimentHostTeardownEvent): void {
  try {
    observer?.observe(Object.freeze(event));
  } catch {
    // Feedback is transient and must never hold recovery authority closed.
  }
}

function hookContext(input: {
  readonly experimentId: string;
  readonly selectedEvalIds: readonly string[];
  readonly observer?: ExperimentHostTeardownObserver;
  readonly signal?: AbortSignal;
}): ExperimentHookContext {
  return {
    experimentId: input.experimentId,
    selectedEvalIds: input.selectedEvalIds,
    signal: input.signal ?? new AbortController().signal,
    progress: (progress) => emit(input.observer, {
      type: "experiment-progress",
      experimentId: input.experimentId,
      detail: progress.message,
    }),
    diagnostic: (diagnostic) => emit(input.observer, {
      type: "diagnostic",
      code: diagnostic.code,
      level: diagnostic.level,
      message: diagnostic.message,
      ...(diagnostic.data === undefined ? {} : { data: Object.freeze({ ...diagnostic.data }) }),
    }),
  };
}

function runAuthorTeardown(input: {
  readonly experiment: DiscoveredExperiment;
  readonly selectedEvalIds: readonly string[];
  readonly observer?: ExperimentHostTeardownObserver;
  readonly signal?: AbortSignal;
  readonly recovery: boolean;
}) {
  const teardown = teardownOf(input.experiment);
  if (teardown === undefined) return Effect.succeed(false as const);
  return Effect.gen(function* () {
    const startedAt = yield* Clock.currentTimeMillis;
    emit(input.observer, {
      type: "experiment-hook",
      experimentId: input.experiment.id,
      hook: "teardown",
      status: "started",
      ...(input.recovery ? { recovery: true } : {}),
    });
    const outcome = yield* Effect.result(cleanupCallback(() => teardown(hookContext({
      experimentId: input.experiment.id,
      selectedEvalIds: input.selectedEvalIds,
      ...(input.observer === undefined ? {} : { observer: input.observer }),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    }))));
    const completedAt = yield* Clock.currentTimeMillis;
    emit(input.observer, {
      type: "experiment-hook",
      experimentId: input.experiment.id,
      hook: "teardown",
      status: Result.isSuccess(outcome) ? "done" : "failed",
      durationMs: Math.max(0, completedAt - startedAt),
    });
    return outcome;
  });
}

export function inspectTeardown(
  input: ExperimentHostTeardownInspectRequest,
): Effect.Effect<ExperimentHostTeardownInspection, ExperimentHostError, ProjectStateDatabase> {
  return closeOperation("teardown-inspect", Effect.gen(function* () {
    const selection = yield* selectTeardowns(input);
    if (input.experimentSelector !== undefined && selection.selected.length === 0) {
      return noExperimentMatch(input.experimentSelector, selection);
    }
    const coordinationRoot = resolve(input.cwd, input.coordinationRoot ?? ".niceeval");
    if (input.recoveryKey !== undefined) {
      const record = yield* readSharedStateLeaseRecoveryTargetEffect(coordinationRoot, input.recoveryKey);
      if (record === undefined) {
        return Object.freeze({ status: "no-evidence" as const, key: input.recoveryKey });
      }
      const evidence = evidenceOf(record);
      if (selection.selected.length !== 1) {
        return Object.freeze({
          status: "selection-not-unique" as const,
          experimentIds: freezeArray(selection.selected.map(({ experiment }) => experiment.id)),
          evidence,
        });
      }
      const target = selection.selected[0]!;
      if (target.experiment.id !== record.experimentId) {
        return Object.freeze({
          status: "experiment-mismatch" as const,
          selectedExperimentId: target.experiment.id,
          evidence,
        });
      }
      if (teardownOf(target.experiment) === undefined) {
        return Object.freeze({
          status: "teardown-required" as const,
          experimentId: target.experiment.id,
          evidence,
        });
      }
      const registrations = yield* readTeardownRegistrationsEffect(coordinationRoot);
      return Object.freeze({
        status: "ready" as const,
        experimentIds: Object.freeze([target.experiment.id]),
        orphanedRegistrations: registrations.filter(({ entry }) =>
          entry.experimentId === target.experiment.id &&
          isOrphanedTeardownRegistration(entry, input.currentHost)).length,
        evidence,
      });
    }

    const registrations = yield* readTeardownRegistrationsEffect(coordinationRoot);
    const selectedIds = new Set(selection.selected.map(({ experiment }) => experiment.id));
    return Object.freeze({
      status: "ready" as const,
      experimentIds: freezeArray(selectedIds),
      orphanedRegistrations: registrations.filter(({ entry }) =>
        selectedIds.has(entry.experimentId) &&
        isOrphanedTeardownRegistration(entry, input.currentHost)).length,
    });
  }));
}

function runExplicitRecovery(
  input: ExperimentHostTeardownRequest,
  selection: TeardownSelection,
  record: SharedStateLeaseRecord,
): Effect.Effect<ExperimentHostTeardownResult, unknown, ProjectStateDatabase> {
  return Effect.gen(function* () {
    const evidence = evidenceOf(record);
    if (selection.selected.length !== 1) {
      return Object.freeze({
        status: "selection-not-unique" as const,
        experimentIds: freezeArray(selection.selected.map(({ experiment }) => experiment.id)),
        evidence,
      });
    }
    const target = selection.selected[0]!;
    if (target.experiment.id !== record.experimentId) {
      return Object.freeze({
        status: "experiment-mismatch" as const,
        selectedExperimentId: target.experiment.id,
        evidence,
      });
    }
    if (teardownOf(target.experiment) === undefined) {
      return Object.freeze({
        status: "teardown-required" as const,
        experimentId: target.experiment.id,
        evidence,
      });
    }
    if (
      input.ownerToken === undefined ||
      input.confirmOwnerTerminated !== true ||
      input.confirmRemoteQuiesced !== true
    ) {
      return Object.freeze({ status: "recovery-confirmation-required" as const, evidence });
    }
    const coordinationRoot = resolve(input.cwd, input.coordinationRoot ?? ".niceeval");
    const begun = yield* beginExplicitSharedStateRecoveryEffect({
      niceevalRoot: coordinationRoot,
      key: record.key,
      ownerToken: input.ownerToken,
      localHost: input.currentHost,
      confirmOwnerTerminated: true,
      confirmRemoteQuiesced: true,
    });
    const claimedEvidence = evidenceOf(begun.record);
    const registrationFailureCode = begun._tag === "AlreadyReleased"
      ? "shared-state-recovery-already-released-registration-failed"
      : "shared-state-recovery-registration-failed";
    const registrationWasPresent = yield* inspectExactRegistration({
      coordinationRoot,
      record: begun.record,
      currentHost: input.currentHost,
    }).pipe(Effect.mapError((cause) => recoveryOperationError(registrationFailureCode, cause)));
    if (begun._tag === "AlreadyReleased") {
      yield* clearExactRegistration({
        coordinationRoot,
        record: begun.record,
        currentHost: input.currentHost,
        expectedRegistration: registrationWasPresent,
      }).pipe(Effect.mapError((cause) => recoveryOperationError(registrationFailureCode, cause)));
      return Object.freeze({
        status: "already-released" as const,
        key: begun.record.key,
        experimentId: begun.record.experimentId,
        ownerToken: begun.record.ownerToken,
      });
    }

    const outcome = yield* runAuthorTeardown({
      experiment: target.experiment,
      selectedEvalIds: target.selectedEvalIds,
      ...(input.observer === undefined ? {} : { observer: input.observer }),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      recovery: true,
    });
    if (outcome === false) {
      return yield* Effect.fail(new Error("Recovery target lost its required teardown callback."));
    }
    if (Result.isFailure(outcome)) {
      return Object.freeze({
        status: "recovery-teardown-failed" as const,
        evidence: claimedEvidence,
        error: outcome.failure instanceof Error ? outcome.failure.message : String(outcome.failure),
      });
    }
    yield* clearExactRegistration({
      coordinationRoot,
      record: begun.record,
      currentHost: input.currentHost,
      expectedRegistration: registrationWasPresent,
    }).pipe(Effect.mapError((cause) => recoveryOperationError(registrationFailureCode, cause)));
    yield* completeExplicitSharedStateRecoveryEffect({
      niceevalRoot: coordinationRoot,
      key: begun.record.key,
      ownerToken: begun.record.ownerToken,
      recoveryId: begun.recoveryId,
      localHost: input.currentHost,
    }).pipe(Effect.mapError((cause) => recoveryOperationError(
      "shared-state-recovery-completion-failed",
      cause,
    )));
    return Object.freeze({
      status: "recovered" as const,
      key: begun.record.key,
      experimentId: begun.record.experimentId,
      ownerToken: begun.record.ownerToken,
    });
  });
}

export function runTeardown(
  input: ExperimentHostTeardownRequest,
): Effect.Effect<ExperimentHostTeardownResult, ExperimentHostError, ProjectStateDatabase> {
  return closeOperation("teardown-run", Effect.gen(function* () {
    const inspection = yield* inspectTeardown(input);
    if (inspection.status !== "ready") return inspection;
    const selection = yield* selectTeardowns(input);
    if (input.recoveryKey !== undefined) {
      if (inspection.evidence === undefined || selection.selected.length !== 1) return inspection;
      const record = yield* readSharedStateLeaseRecoveryTargetEffect(
        resolve(input.cwd, input.coordinationRoot ?? ".niceeval"),
        input.recoveryKey,
      );
      if (record === undefined) {
        return Object.freeze({ status: "no-evidence" as const, key: input.recoveryKey });
      }
      return yield* runExplicitRecovery(input, selection, record);
    }

    const coordinationRoot = resolve(input.cwd, input.coordinationRoot ?? ".niceeval");
    const registrations = yield* readTeardownRegistrationsEffect(coordinationRoot);
    const results: Array<{
      readonly experimentId: string;
      readonly executions: number;
      readonly outcome: "succeeded" | "failed" | "not-configured";
      readonly error?: string;
    }> = [];
    for (const target of selection.selected) {
      if (teardownOf(target.experiment) === undefined) {
        results.push(Object.freeze({
          experimentId: target.experiment.id,
          executions: 0,
          outcome: "not-configured" as const,
        }));
        continue;
      }
      const matching = registrations.filter(({ entry }) => entry.experimentId === target.experiment.id);
      const orphaned = matching.filter(({ entry }) =>
        isOrphanedTeardownRegistration(entry, input.currentHost));
      const claimed = yield* Effect.all(orphaned.map(({ id }) =>
        removeTeardownRegistrationIfPresentEffect(coordinationRoot, id)), {
        concurrency: "unbounded",
      });
      const executions = matching.length === 0 ? 1 : claimed.filter(Boolean).length;
      let failure: string | undefined;
      for (let index = 0; index < executions; index += 1) {
        const outcome = yield* runAuthorTeardown({
          experiment: target.experiment,
          selectedEvalIds: target.selectedEvalIds,
          ...(input.observer === undefined ? {} : { observer: input.observer }),
          ...(input.signal === undefined ? {} : { signal: input.signal }),
          recovery: true,
        });
        if (outcome !== false && Result.isFailure(outcome)) {
          failure = outcome.failure instanceof Error ? outcome.failure.message : String(outcome.failure);
        }
      }
      results.push(Object.freeze({
        experimentId: target.experiment.id,
        executions,
        outcome: failure === undefined ? "succeeded" as const : "failed" as const,
        ...(failure === undefined ? {} : { error: failure }),
      }));
    }
    return Object.freeze({
      status: "completed" as const,
      experiments: freezeArray(results),
    });
  }));
}
