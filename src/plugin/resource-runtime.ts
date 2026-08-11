// Eval Plugin resources are materialized against a physical Sandbox, not an
// Attempt. This internal module keeps their opaque handles out of the public
// runner model while making Scope own every release.

import { Cause, Data, Effect } from "effect";
import { stableJson } from "../sandbox/identity.ts";
import type { Sandbox } from "../sandbox/types.ts";
import { CLEANUP_TIMEOUT_MS } from "../runner/cleanup-timeout.ts";
import type { JsonValue, ScopedFeedback } from "../shared/types.ts";
import type { FactValue } from "../shared/facts.ts";
import {
  sandboxResourceDefinitionOf,
  sandboxResourceDemandDataOf,
  type SandboxResourceAttemptContext,
  type SandboxResourceContext,
  type SandboxResourceDefinition,
  type SandboxResourceTiming,
} from "./contracts.ts";
import type { LinkedPluginResourceDemand } from "./link.ts";

export type ResourcePhysicalCohortKind = "fresh-pair" | "sandbox-reuse" | "eval-group";

/** The selected demand envelope is frozen before carry decides which slots run. */
export interface ResourcePhysicalCohort {
  readonly kind: ResourcePhysicalCohortKind;
  /** Stable cohort identity; never a declaration-order index. */
  readonly id: string;
  /** Provider physical plan identity, not a runtime sandbox id. */
  readonly physical: string;
}

export interface SelectedResourceDemand {
  readonly pairKey: string;
  readonly evalId: string;
  readonly experimentId: string;
  readonly linked: LinkedPluginResourceDemand;
}

export interface SelectedResourceEnvelopeEntry {
  readonly receiver: string;
  readonly behaviorRevision: string;
  readonly definition: SandboxResourceDefinition<string, JsonValue, unknown>;
  readonly demands: readonly SelectedResourceDemand[];
  /** JSON-only surface used by fingerprints and manifests. */
  readonly projection: JsonValue;
}

export interface SelectedResourceEnvelope {
  readonly cohort: ResourcePhysicalCohort;
  readonly entries: readonly SelectedResourceEnvelopeEntry[];
  /** JSON-only, frozen selected envelope; includes carried members by design. */
  readonly projection: JsonValue;
}

export class ResourceEnvelopeConflictError extends Data.TaggedError("ResourceEnvelopeConflictError")<{
  readonly code: "plugin.resource-envelope-conflict";
  readonly message: string;
}> {}

/**
 * A resource prepare failure is operationally different from an author
 * SandboxLayer prepare command: it proves the physical resource handle is no
 * longer usable for this Attempt. Keep that fact typed until attempt.ts turns
 * it into the stable public `plugin-resource-prepare-failed` error code.
 */
export class PluginResourcePrepareError extends Data.TaggedError("PluginResourcePrepareError")<{
  readonly receiver: string;
  readonly behaviorRevision: string;
  readonly evalId: string;
  readonly experimentId: string;
  readonly message: string;
  readonly cause: Error;
}> {}

function stableKey(value: JsonValue): string {
  return stableJson(value);
}

function demandProjection(demand: SelectedResourceDemand): JsonValue {
  return Object.freeze({
    pairKey: demand.pairKey,
    evalId: demand.evalId,
    receiver: demand.linked.receiver,
    behaviorRevision: demand.linked.behaviorRevision,
    demand: demand.linked.projection,
    plugin: demand.linked.occurrence.projection,
  }) as JsonValue;
}

/**
 * Group demands by receiver/revision for one actual physical run cohort.
 * Different resource constructors claiming that same receiver/revision are
 * intentionally rejected: there is no neutral way to choose one handle.
 */
export function createSelectedResourceEnvelope(
  cohort: ResourcePhysicalCohort,
  demands: readonly SelectedResourceDemand[],
): SelectedResourceEnvelope {
  const grouped = new Map<string, {
    receiver: string;
    behaviorRevision: string;
    resource: object;
    definition: SandboxResourceDefinition<string, JsonValue, unknown>;
    demands: SelectedResourceDemand[];
  }>();
  for (const demand of demands) {
    const data = sandboxResourceDemandDataOf(demand.linked.demand);
    const key = JSON.stringify([data.receiver, data.behaviorRevision]);
    const definition = sandboxResourceDefinitionOf(data.resource);
    const prior = grouped.get(key);
    if (prior !== undefined && prior.resource !== data.resource) {
      throw new ResourceEnvelopeConflictError({
        code: "plugin.resource-envelope-conflict",
        message:
          `Selected Sandbox resource cohort ${JSON.stringify(cohort.id)} has two definitions for receiver ` +
          `${JSON.stringify(data.receiver)} revision ${JSON.stringify(data.behaviorRevision)}. ` +
          "Use one defineSandboxResource() constructor for that receiver/revision.",
      });
    }
    if (prior === undefined) {
      grouped.set(key, {
        receiver: data.receiver,
        behaviorRevision: data.behaviorRevision,
        resource: data.resource,
        definition,
        demands: [demand],
      });
    } else {
      prior.demands.push(demand);
    }
  }
  const entries = [...grouped.values()]
    .sort((left, right) => `${left.receiver}\u0000${left.behaviorRevision}`.localeCompare(`${right.receiver}\u0000${right.behaviorRevision}`))
    .map((entry) => {
      const entryDemands = entry.demands
        .toSorted((left, right) => stableKey(demandProjection(left)).localeCompare(stableKey(demandProjection(right))))
        .map((demand) => Object.freeze(demand));
      const projection = Object.freeze({
        receiver: entry.receiver,
        behaviorRevision: entry.behaviorRevision,
        demands: entryDemands.map(demandProjection),
      }) as JsonValue;
      return Object.freeze({
        receiver: entry.receiver,
        behaviorRevision: entry.behaviorRevision,
        definition: entry.definition,
        demands: Object.freeze(entryDemands),
        projection,
      });
    });
  const frozenCohort = Object.freeze({ ...cohort });
  return Object.freeze({
    cohort: frozenCohort,
    entries: Object.freeze(entries),
    projection: Object.freeze({
      version: 1,
      cohort: frozenCohort,
      entries: entries.map((entry) => entry.projection),
    }) as JsonValue,
  });
}

interface MaterializedResourceEntry {
  readonly entry: SelectedResourceEnvelopeEntry;
  readonly handle: unknown;
}

export interface MaterializedPluginResources {
  /** Only actual dispatched Attempts invoke resource prepare. */
  prepare(input: SandboxResourceAttemptContext): Effect.Effect<void, Error>;
}

function releaseWithBudget(
  entry: SelectedResourceEnvelopeEntry,
  handle: unknown,
  context: SandboxResourceContext,
  feedback: Pick<ScopedFeedback, "diagnostic"> | undefined,
): Effect.Effect<void> {
  if (entry.definition.release === undefined) return Effect.void;
  return entry.definition.release(handle, context).pipe(
    Effect.timeout(CLEANUP_TIMEOUT_MS),
    Effect.catchAllCause((cause) => Effect.sync(() => {
      feedback?.diagnostic({
        code: "plugin-resource-release-failed",
        level: "warning",
        message:
          `Plugin resource ${JSON.stringify(entry.receiver)}@${JSON.stringify(entry.behaviorRevision)} ` +
          `release failed after its cleanup budget: ${Cause.pretty(cause)}`,
      });
    })),
  );
}

/**
 * Acquire every selected resource in envelope order. Effect.acquireRelease
 * attaches each finalizer to the caller Scope; a later materialization failure
 * therefore releases already-acquired entries in reverse order.
 */
export function materializeSelectedPluginResources(input: {
  readonly envelope: SelectedResourceEnvelope;
  readonly sandbox: Sandbox;
  readonly signal: AbortSignal;
  readonly feedback?: Pick<ScopedFeedback, "diagnostic">;
  readonly progress?: ScopedFeedback["progress"];
  readonly fact?: (key: string, value: FactValue) => void;
  readonly timing?: (input: SandboxResourceTiming) => void;
}): Effect.Effect<MaterializedPluginResources, Error, import("effect").Scope.Scope> {
  const context: SandboxResourceContext = Object.freeze({
    sandbox: input.sandbox,
    signal: input.signal,
    physicalId: input.sandbox.sandboxId,
    progress: input.progress ?? (() => {}),
    diagnostic: input.feedback?.diagnostic ?? (() => {}),
    fact: input.fact ?? (() => {}),
    timing: input.timing ?? (() => {}),
  });
  return Effect.gen(function* () {
    const materialized: MaterializedResourceEntry[] = [];
    for (const entry of input.envelope.entries) {
      const demands = Object.freeze(entry.demands.map((demand) =>
        sandboxResourceDemandDataOf(demand.linked.demand).payload,
      ));
      const handle = yield* Effect.acquireRelease(
        entry.definition.materialize(demands, context),
        (value) => releaseWithBudget(entry, value, context, input.feedback),
      );
      materialized.push(Object.freeze({ entry, handle }));
    }
    const snapshot = Object.freeze([...materialized]);
    return Object.freeze({
      prepare: (attempt): Effect.Effect<void, Error> => Effect.forEach(
        snapshot,
        (entry) => {
          if (entry.entry.definition.prepare === undefined) return Effect.void;
          const selected = entry.entry.demands.filter((demand) =>
            demand.experimentId === attempt.experimentId && demand.evalId === attempt.evalId
          );
          return Effect.forEach(
            selected,
            (demand) => entry.entry.definition.prepare!(
              entry.handle,
              sandboxResourceDemandDataOf(demand.linked.demand).payload,
              attempt,
            ).pipe(
              Effect.mapError((cause) => new PluginResourcePrepareError({
                receiver: entry.entry.receiver,
                behaviorRevision: entry.entry.behaviorRevision,
                evalId: attempt.evalId,
                experimentId: attempt.experimentId,
                message:
                  `Plugin Sandbox resource ${JSON.stringify(entry.entry.receiver)}@${JSON.stringify(entry.entry.behaviorRevision)} ` +
                  `prepare failed for Eval ${JSON.stringify(attempt.evalId)}: ${cause.message}`,
                cause,
              })),
            ),
            { concurrency: 1, discard: true },
          );
        },
        { concurrency: 1, discard: true },
      ),
    } satisfies MaterializedPluginResources);
  });
}
