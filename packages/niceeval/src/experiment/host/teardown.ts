import { resolve } from "node:path";
import { operationError } from "./operations.ts";

import { Clock, Effect, Result } from "effect";
import { ProjectStateDatabase } from "../../record/sqlite/project-state-database.ts";
import type { StateLeaseSet } from "../../record/sqlite/state-lease-repository.ts";
import { recoverRunForLeaseSet } from "../../run/host/lifecycle-adapter.ts";

import { cleanupCallback } from "../../runner/cleanup-timeout.ts";
import { discoverEvals, discoverExperimentSelection } from "../../runner/discover.ts";
import { resolveExperimentEvals } from "../../runner/eval-selection.ts";
import {
  beginExplicitSharedStateRecoveryEffect,
  finishLeaseSetAfterEffect,
  leaseSetNeedsAfter,
  readHeldStateLeaseSetsEffect,
  startLeaseSetAfterEffect,
  readSharedStateLeaseRecoveryTargetEffect,
  type SharedStateLeaseRecord,
} from "../../runner/shared-state-lease.ts";
import {
  isExactTeardownRegistrationOwnerTerminatedEffect,
  isOrphanedTeardownRegistration,
  readExactTeardownRegistrationEffect,
  readTeardownRegistrationsEffect,
  removeTeardownRegistrationIfPresentEffect,
} from "../../runner/teardown-registry.ts";
import type { DiscoveredExperiment, ExperimentHook, ExperimentHookContext } from "../../runner/types.ts";
import { matchExperimentSelector } from "../../shared/aggregate.ts";
import { ExperimentHostError, normalizeExperimentHostCause } from "./types.ts";

import type {
  ExperimentHostAfterEvent,
  ExperimentHostAfterObserver,
  ExperimentHostOperation,
  ExperimentHostSharedStateEvidence,
  ExperimentHostAfterInspection,
  ExperimentHostAfterInspectRequest,
  ExperimentHostAfterRequest,
  ExperimentHostAfterResult,
} from "./types.ts";

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
    cause: normalizeExperimentHostCause(cause),
    comparisons: undefined,
  });
}

interface TeardownSelection {
  readonly experimentIds: readonly string[];
  readonly selected: readonly {
    readonly experiment: DiscoveredExperiment;
    readonly selectedEvalIds: readonly string[];
  }[];
}

function selectTeardowns(input: {
  readonly cwd: string;
  readonly experimentSelector?: string | undefined;
}): Effect.Effect<TeardownSelection, unknown> {
  return Effect.gen(function* () {
    const evals = yield* discoverEvals(input.cwd);
    const selector = input.experimentSelector;
    const { experiments, experimentIds } = yield* discoverExperimentSelection(input.cwd, {
      select: (ids) => (selector === undefined ? ids : matchExperimentSelector(ids, selector)),
      freshImport: false,
      generation: undefined,
    });
    const matched =
      input.experimentSelector === undefined
        ? experiments
        : experiments.filter((experiment) =>
            matchExperimentSelector(experimentIds, input.experimentSelector!).includes(experiment.id),
          );
    return {
      experimentIds,
      selected: matched.map((experiment) => {
        const selection = resolveExperimentEvals({
          experimentId: experiment.id,
          validateModelRequirements: false,
          selector: experiment.evals,
          cliPatterns: [],
          evals,

          models: undefined,
          tag: undefined,
        });
        return {
          experiment,
          selectedEvalIds: selection.selectedEvalIds,
        };
      }),
    };
  });
}

function teardownOf(experiment: DiscoveredExperiment): ExperimentHook | undefined {
  return typeof experiment.after === "function" ? experiment.after : undefined;
}

function evidenceOf(record: SharedStateLeaseRecord): ExperimentHostSharedStateEvidence {
  return {
    key: record.key,
    experimentId: record.experimentId,
    ownerToken: record.ownerToken,
    host: record.host,
    pid: record.pid,
    processIdentity: record.processIdentity,
    heartbeatAt: record.heartbeatAt,
  };
}

function noExperimentMatch(selector: string, selection: TeardownSelection): ExperimentHostAfterInspection {
  return {
    status: "experiment-no-match" as const,
    selector,
    candidates: [...selection.experimentIds].sort(),
  };
}

function inspectExactRegistration(root: string, set: StateLeaseSet, currentHost: string) {
  return Effect.gen(function* () {
    const id = set.afterRegistrationId;
    if (id === null) return yield* Effect.fail(new Error("Lease set has no exact after registration."));
    const exact = yield* readExactTeardownRegistrationEffect(root, set.experimentId, set.owner.pid, id);
    if (
      exact === undefined ||
      exact.row.leaseSetId !== set.id ||
      !(yield* isExactTeardownRegistrationOwnerTerminatedEffect({
        registration: exact.registration,
        owner: set.owner,
        currentHost,
      }))
    ) {
      return yield* Effect.fail(
        new Error("The exact after registration does not match the terminated lease set owner."),
      );
    }
    return exact;
  });
}

function emit(observer: ExperimentHostAfterObserver | undefined, event: ExperimentHostAfterEvent): void {
  try {
    observer?.observe(event);
  } catch {
    // Feedback is transient and must never hold recovery authority closed.
  }
}

function hookContext(input: {
  readonly experimentId: string;
  readonly selectedEvalIds: readonly string[];
  readonly observer: ExperimentHostAfterObserver | undefined;
  readonly signal: AbortSignal | undefined;
}): ExperimentHookContext {
  return {
    experimentId: input.experimentId,
    selectedEvalIds: input.selectedEvalIds,
    signal: input.signal ?? new AbortController().signal,
    progress: (progress) =>
      emit(input.observer, {
        type: "experiment-progress",
        experimentId: input.experimentId,
        detail: progress.message,
      }),
    diagnostic: (diagnostic) =>
      emit(input.observer, {
        type: "diagnostic",
        code: diagnostic.code,
        level: diagnostic.level,
        message: diagnostic.message,
        data: diagnostic.data,
      }),
  };
}

function runAuthorTeardown(input: {
  readonly experiment: DiscoveredExperiment;
  readonly selectedEvalIds: readonly string[];
  readonly observer: ExperimentHostAfterObserver | undefined;
  readonly signal: AbortSignal | undefined;
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
      recovery: input.recovery,
    });
    const outcome = yield* Effect.result(
      cleanupCallback(() =>
        teardown(
          hookContext({
            experimentId: input.experiment.id,
            selectedEvalIds: input.selectedEvalIds,
            observer: input.observer,
            signal: input.signal,
          }),
        ),
      ),
    );
    const completedAt = yield* Clock.currentTimeMillis;
    emit(input.observer, {
      type: "experiment-hook",
      experimentId: input.experiment.id,
      hook: "teardown",
      status: Result.isSuccess(outcome) ? "done" : "failed",
      durationMs: Math.max(0, completedAt - startedAt),
      recovery: input.recovery,
    });
    return outcome;
  });
}

export function inspectTeardown(
  input: ExperimentHostAfterInspectRequest,
): Effect.Effect<ExperimentHostAfterInspection, ExperimentHostError, ProjectStateDatabase> {
  return closeOperation(
    "teardown-inspect",
    Effect.gen(function* () {
      const selection = yield* selectTeardowns(input);
      if (input.experimentSelector !== undefined && selection.selected.length === 0) {
        return noExperimentMatch(input.experimentSelector, selection);
      }
      const coordinationRoot = resolve(input.cwd, input.coordinationRoot ?? ".niceeval");
      if (input.recoveryKey !== undefined) {
        const recovery = yield* readSharedStateLeaseRecoveryTargetEffect(coordinationRoot, input.recoveryKey);
        if (recovery === undefined) {
          return { status: "no-evidence" as const, key: input.recoveryKey };
        }
        const { record, set } = recovery;
        const evidence = evidenceOf(record);
        if (selection.selected.length !== 1) {
          return {
            status: "selection-not-unique" as const,
            experimentIds: selection.selected.map(({ experiment }) => experiment.id),
            evidence,
          };
        }
        const target = selection.selected[0]!;
        if (target.experiment.id !== record.experimentId) {
          return {
            status: "experiment-mismatch" as const,
            selectedExperimentId: target.experiment.id,
            evidence,
          };
        }
        if (leaseSetNeedsAfter(set) && teardownOf(target.experiment) === undefined) {
          return {
            status: "after-required" as const,
            experimentId: target.experiment.id,
            evidence,
          };
        }
        const registrations = yield* readTeardownRegistrationsEffect(coordinationRoot);
        return {
          status: "ready" as const,
          experimentIds: [target.experiment.id],
          orphanedRegistrations: registrations.filter(
            ({ entry, leaseSetId }) =>
              leaseSetId === undefined &&
              entry.experimentId === target.experiment.id &&
              isOrphanedTeardownRegistration(entry, input.currentHost),
          ).length,
          evidence,
        };
      }

      const registrations = yield* readTeardownRegistrationsEffect(coordinationRoot);
      const selectedIds = new Set(selection.selected.map(({ experiment }) => experiment.id));
      return {
        status: "ready" as const,
        experimentIds: [...selectedIds],
        orphanedRegistrations: registrations.filter(
          ({ entry }) =>
            selectedIds.has(entry.experimentId) && isOrphanedTeardownRegistration(entry, input.currentHost),
        ).length,
        evidence: undefined,
      };
    }),
  );
}

function runExplicitRecovery(
  input: ExperimentHostAfterRequest,
  selection: TeardownSelection,
  recovery: { readonly record: SharedStateLeaseRecord; readonly set: StateLeaseSet },
): Effect.Effect<ExperimentHostAfterResult, unknown, ProjectStateDatabase> {
  return Effect.gen(function* () {
    const { record, set } = recovery;
    const evidence = evidenceOf(record);
    if (selection.selected.length !== 1) {
      return {
        status: "selection-not-unique" as const,
        experimentIds: selection.selected.map(({ experiment }) => experiment.id),
        evidence,
      };
    }
    const target = selection.selected[0]!;
    if (target.experiment.id !== record.experimentId) {
      return {
        status: "experiment-mismatch" as const,
        selectedExperimentId: target.experiment.id,
        evidence,
      };
    }
    if (leaseSetNeedsAfter(set) && teardownOf(target.experiment) === undefined) {
      return {
        status: "after-required" as const,
        experimentId: target.experiment.id,
        evidence,
      };
    }
    if (
      input.ownerToken === undefined ||
      input.confirmOwnerTerminated !== true ||
      input.confirmRemoteQuiesced !== true
    ) {
      return { status: "recovery-confirmation-required" as const, evidence };
    }
    const coordinationRoot = resolve(input.cwd, input.coordinationRoot ?? ".niceeval");
    const begun = yield* beginExplicitSharedStateRecoveryEffect({
      niceevalRoot: coordinationRoot,
      key: record.key,
      ownerToken: input.ownerToken,
      localHost: input.currentHost,
      confirmOwnerTerminated: true,
      confirmRemoteQuiesced: true,
      afterAvailable: teardownOf(target.experiment) !== undefined,
    });
    if (begun._tag === "AfterRequired") {
      return {
        status: "after-required" as const,
        experimentId: begun.set.experimentId,
        evidence: evidenceOf(begun.record),
      };
    }
    if (begun._tag === "AlreadyReleased") {
      const registrationId = begun.set.afterRegistrationId;
      if (registrationId !== null) {
        const facets = yield* (yield* ProjectStateDatabase).bind(coordinationRoot);
        const retained = yield* Effect.tryPromise({
          try: () => facets.teardown.get(registrationId),
          catch: (cause) => recoveryOperationError("shared-state-recovery-already-released-registration-failed", cause),
        });
        if (retained !== undefined) {
          return yield* Effect.fail(
            recoveryOperationError(
              "shared-state-recovery-already-released-registration-failed",
              new Error("A released lease set unexpectedly retains an after registration."),
            ),
          );
        }
      }
      return {
        status: "already-released" as const,
        key: begun.record.key,
        experimentId: begun.record.experimentId,
        ownerToken: begun.record.ownerToken,
      };
    }
    yield* recoverRunForLeaseSet(coordinationRoot, begun.set.runId);
    if (begun.set.afterStatus === "pending" || begun.set.afterStatus === "running") {
      const registrationFailureCode = "shared-state-recovery-registration-failed";
      const { registration, row } = yield* inspectExactRegistration(
        coordinationRoot,
        begun.set,
        input.currentHost,
      ).pipe(Effect.mapError((cause) => recoveryOperationError(registrationFailureCode, cause)));
      if (teardownOf(target.experiment) === undefined) {
        return { status: "after-required" as const, experimentId: begun.set.experimentId, evidence };
      }
      yield* startLeaseSetAfterEffect(coordinationRoot, begun.authority).pipe(
        Effect.mapError((cause) => recoveryOperationError(registrationFailureCode, cause)),
      );
      const outcome = yield* runAuthorTeardown({
        experiment: target.experiment,
        selectedEvalIds: registration.selectedEvalIds,
        observer: input.observer,
        signal: input.signal,
        recovery: true,
      });
      if (outcome === false) return yield* Effect.fail(new Error("Recovery target lost its required after callback."));
      if (Result.isFailure(outcome)) {
        return {
          status: "recovery-teardown-failed" as const,
          evidence: evidenceOf(begun.record),
          error: outcome.failure instanceof Error ? outcome.failure.message : String(outcome.failure),
        };
      }
      yield* finishLeaseSetAfterEffect(coordinationRoot, begun.authority, row).pipe(
        Effect.mapError((cause) => recoveryOperationError(registrationFailureCode, cause)),
      );
    }
    yield* begun
      .release()
      .pipe(Effect.mapError((cause) => recoveryOperationError("shared-state-recovery-completion-failed", cause)));
    yield* (yield* ProjectStateDatabase).closeInvocationPortable(coordinationRoot);
    return {
      status: "recovered" as const,
      key: begun.record.key,
      experimentId: begun.record.experimentId,
      ownerToken: begun.record.ownerToken,
    };
  });
}

export function runTeardown(
  input: ExperimentHostAfterRequest,
): Effect.Effect<ExperimentHostAfterResult, ExperimentHostError, ProjectStateDatabase> {
  return closeOperation(
    "teardown-run",
    Effect.gen(function* () {
      const inspection = yield* inspectTeardown(input);
      if (inspection.status !== "ready") return inspection;
      const selection = yield* selectTeardowns(input);
      if (input.recoveryKey !== undefined) {
        if (inspection.evidence === undefined || selection.selected.length !== 1) return inspection;
        const recovery = yield* readSharedStateLeaseRecoveryTargetEffect(
          resolve(input.cwd, input.coordinationRoot ?? ".niceeval"),
          input.recoveryKey,
        );
        if (recovery === undefined) {
          return { status: "no-evidence" as const, key: input.recoveryKey };
        }
        return yield* runExplicitRecovery(input, selection, recovery);
      }

      const coordinationRoot = resolve(input.cwd, input.coordinationRoot ?? ".niceeval");
      const registrations = yield* readTeardownRegistrationsEffect(coordinationRoot);
      const results: import("./types.ts").ExperimentHostAfterExperimentResult[] = [];
      for (const target of selection.selected) {
        if (teardownOf(target.experiment) === undefined) {
          results.push({
            experimentId: target.experiment.id,
            executions: 0,
            outcome: "not-configured" as const,
          });
          continue;
        }
        const matching = registrations.filter(({ entry }) => entry.experimentId === target.experiment.id);
        const orphaned = matching.filter(
          ({ entry, leaseSetId }) =>
            leaseSetId === undefined && isOrphanedTeardownRegistration(entry, input.currentHost),
        );
        const claimed = yield* Effect.all(
          orphaned.map(({ id }) => removeTeardownRegistrationIfPresentEffect(coordinationRoot, id)),
          {
            concurrency: "unbounded",
          },
        );
        const heldSets = yield* readHeldStateLeaseSetsEffect(coordinationRoot, target.experiment.id);
        const executions = matching.length === 0 && heldSets.length === 0 ? 1 : claimed.filter(Boolean).length;
        let failure: string | undefined;
        for (let index = 0; index < executions; index += 1) {
          const outcome = yield* runAuthorTeardown({
            experiment: target.experiment,
            selectedEvalIds: target.selectedEvalIds,
            observer: input.observer,
            signal: input.signal,
            recovery: true,
          });
          if (outcome !== false && Result.isFailure(outcome)) {
            failure = outcome.failure instanceof Error ? outcome.failure.message : String(outcome.failure);
          }
        }
        results.push({
          experimentId: target.experiment.id,
          executions,
          ...(failure === undefined
            ? { outcome: "succeeded" as const }
            : { outcome: "failed" as const, error: failure }),
        });
      }
      return {
        status: "completed" as const,
        experiments: results,
      };
    }),
  );
}
