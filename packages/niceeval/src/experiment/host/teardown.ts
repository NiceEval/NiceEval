import { resolve } from "node:path";
import { operationError } from "./operations.ts";

import { Clock, Effect, Result } from "effect";
import type { TeardownRetirement } from "../../record/sqlite/registry-repository.ts";
import { SqliteRecordError } from "../../record/sqlite/errors.ts";
import type { ProjectStateDatabase } from "../../record/sqlite/project-state-database.ts";

import { cleanupCallback } from "../../runner/cleanup-timeout.ts";
import { discoverEvals, discoverExperimentSelection } from "../../runner/discover.ts";
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

function inspectExactRegistration(input: {
  readonly coordinationRoot: string;
  readonly record: SharedStateLeaseRecord;
  readonly currentHost: string;
}): Effect.Effect<TeardownRetirement, unknown, ProjectStateDatabase> {
  const id = teardownEntryId(input.record.experimentId, input.record.pid);
  return Effect.gen(function* () {
    const exact = yield* readExactTeardownRegistrationEffect(
      input.coordinationRoot,
      input.record.experimentId,
      input.record.pid,
    );
    if (exact === undefined) return { id, generation: null };
    const { registration, row } = exact;
    if (registration.host !== input.record.host) {
      return yield* Effect.fail(
        new Error(
          `teardown registration ${JSON.stringify(id)} belongs to host ${JSON.stringify(registration.host)}, ` +
            `not immutable sharedState owner host ${JSON.stringify(input.record.host)}`,
        ),
      );
    }
    const terminated = yield* isExactTeardownRegistrationOwnerTerminatedEffect({
      registration,
      owner: input.record,
      currentHost: input.currentHost,
    });
    if (!terminated) {
      return yield* Effect.fail(
        new Error(`teardown registration ${JSON.stringify(id)} still belongs to a live exact sharedState owner`),
      );
    }
    return row;
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
    const present = (yield* inspectExactRegistration(input)).generation !== null;
    if (!present) {
      if (input.expectedRegistration) {
        return yield* Effect.fail(
          new Error(`teardown registration ${JSON.stringify(id)} disappeared before recovery could clear it`),
        );
      }
      return;
    }
    if (!input.expectedRegistration) {
      return yield* Effect.fail(
        new Error(`teardown registration ${JSON.stringify(id)} appeared after recovery was claimed`),
      );
    }
    if (!(yield* removeTeardownRegistrationIfPresentEffect(input.coordinationRoot, id))) {
      return yield* Effect.fail(
        new Error(`teardown registration ${JSON.stringify(id)} changed before recovery could clear it`),
      );
    }
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
        const record = yield* readSharedStateLeaseRecoveryTargetEffect(coordinationRoot, input.recoveryKey);
        if (record === undefined) {
          return { status: "no-evidence" as const, key: input.recoveryKey };
        }
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
        if (teardownOf(target.experiment) === undefined) {
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
            ({ entry }) =>
              entry.experimentId === target.experiment.id && isOrphanedTeardownRegistration(entry, input.currentHost),
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
  record: SharedStateLeaseRecord,
): Effect.Effect<ExperimentHostAfterResult, unknown, ProjectStateDatabase> {
  return Effect.gen(function* () {
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
    if (teardownOf(target.experiment) === undefined) {
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
    });
    const claimedEvidence = evidenceOf(begun.record);
    const registrationFailureCode =
      begun._tag === "AlreadyReleased"
        ? "shared-state-recovery-already-released-registration-failed"
        : "shared-state-recovery-registration-failed";
    const retirement = yield* inspectExactRegistration({
      coordinationRoot,
      record: begun.record,
      currentHost: input.currentHost,
    }).pipe(Effect.mapError((cause) => recoveryOperationError(registrationFailureCode, cause)));
    if (begun._tag === "AlreadyReleased") {
      yield* clearExactRegistration({
        coordinationRoot,
        record: begun.record,
        currentHost: input.currentHost,
        expectedRegistration: retirement.generation !== null,
      }).pipe(Effect.mapError((cause) => recoveryOperationError(registrationFailureCode, cause)));
      return {
        status: "already-released" as const,
        key: begun.record.key,
        experimentId: begun.record.experimentId,
        ownerToken: begun.record.ownerToken,
      };
    }

    const outcome = yield* runAuthorTeardown({
      experiment: target.experiment,
      selectedEvalIds: target.selectedEvalIds,
      observer: input.observer,
      signal: input.signal,
      recovery: true,
    });
    if (outcome === false) {
      return yield* Effect.fail(new Error("Recovery target lost its required teardown callback."));
    }
    if (Result.isFailure(outcome)) {
      return {
        status: "recovery-teardown-failed" as const,
        evidence: claimedEvidence,
        error: outcome.failure instanceof Error ? outcome.failure.message : String(outcome.failure),
      };
    }
    yield* completeExplicitSharedStateRecoveryEffect({
      niceevalRoot: coordinationRoot,
      key: begun.record.key,
      ownerToken: begun.record.ownerToken,
      recoveryId: begun.recoveryId,
      localHost: input.currentHost,
      retirement,
    }).pipe(
      Effect.mapError((cause) =>
        recoveryOperationError(
          cause instanceof SqliteRecordError && cause.operation === "teardown-claim"
            ? registrationFailureCode
            : "shared-state-recovery-completion-failed",
          cause,
        ),
      ),
    );
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
        const record = yield* readSharedStateLeaseRecoveryTargetEffect(
          resolve(input.cwd, input.coordinationRoot ?? ".niceeval"),
          input.recoveryKey,
        );
        if (record === undefined) {
          return { status: "no-evidence" as const, key: input.recoveryKey };
        }
        return yield* runExplicitRecovery(input, selection, record);
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
        const orphaned = matching.filter(({ entry }) => isOrphanedTeardownRegistration(entry, input.currentHost));
        const claimed = yield* Effect.all(
          orphaned.map(({ id }) => removeTeardownRegistrationIfPresentEffect(coordinationRoot, id)),
          {
            concurrency: "unbounded",
          },
        );
        const executions = matching.length === 0 ? 1 : claimed.filter(Boolean).length;
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
