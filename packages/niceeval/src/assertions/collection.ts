import { Effect } from "effect";

import type {
  AssertionCoverage,
  AssertionCriterion,
  AssertionLimitation,
  BooleanAssertionEvaluation,
  BooleanAssertionRegistration,
  MatcherSourceSnapshot,
} from "./api.ts";
import {
  evaluateMatcherCollection,
  evaluateMatcherOrder,
  interruptedMatcherArtifact,
  type MatcherQuery,
  type MatcherSourceRow,
} from "./matcher-artifact.ts";
import type { LogicalToolOccurrence } from "../o11y/types.ts";
import {
  collectionMatchSpecOf,
  evaluateBooleanMatch,
  isManagedCollectionMatch,
  isManagedToolMatch,
  isNumericComparisonMatch,
  looksLikeCollectionMatch,
  type BooleanMatchEvaluation,
  type CollectionMatch,
  type ManagedToolCalls,
  type NumericMaterial,
  type ToolMatch,
  type ToolMatchQuantifier,
  type ToolOccurrenceView,
} from "./match.ts";
import { numericBooleanRegistration } from "./numeric.ts";
import { captureAssertionSnapshot } from "./runtime.ts";

type ProjectedMatcherCandidate<Candidate> =
  | { readonly state: "available"; readonly value: Candidate }
  | { readonly state: "unavailable"; readonly reason: string };

export interface ManagedToolCallsSidecar {
  readonly scope: "turn" | "session" | "attempt";
  readonly cardinality: NumericMaterial;
  readonly sourceSnapshot: MatcherSourceSnapshot;
  readonly rows: readonly MatcherSourceRow<ProjectedMatcherCandidate<LogicalToolOccurrence>>[];
  readonly coverage: AssertionCoverage;
  readonly limitations: readonly AssertionLimitation[];
  readonly actionsCoverage: unknown;
  readonly orphanFinishCount: number;
  readonly snapshot: unknown;
}

const managedToolCallsSidecars = new WeakMap<object, ManagedToolCallsSidecar>();

function occurrenceView(
  row: MatcherSourceRow<ProjectedMatcherCandidate<LogicalToolOccurrence>>,
): ToolOccurrenceView {
  if (row.candidate.state !== "available") {
    return Object.freeze({ name: "unknown" });
  }
  const occurrence = row.candidate.value;
  const name = occurrence.name.canonical === undefined || occurrence.name.canonical === "unknown"
    ? occurrence.name.original
    : occurrence.name.canonical;
  return Object.freeze({
    name,
    ...(occurrence.input.state === "unavailable" ? {} : { input: occurrence.input.value }),
    ...(occurrence.output.state === "unavailable" ? {} : { output: occurrence.output.value }),
    ...(occurrence.lifecycle.state === "available" ? { status: occurrence.lifecycle.status } : {}),
  });
}

function foldedSourceSnapshot(
  snapshot: MatcherSourceSnapshot,
  incompleteReason: string | undefined,
): MatcherSourceSnapshot {
  if (snapshot.collectionAtCut === "unavailable") return snapshot;
  if (snapshot.collectionAtCut === "partial" || incompleteReason !== undefined) {
    return snapshot.collectionAtCut === "partial"
      ? snapshot
      : Object.freeze({ ...snapshot, collectionAtCut: "partial" as const });
  }
  return snapshot;
}

function cardinalityMaterial(input: {
  readonly collectionAtCut: MatcherSourceSnapshot["collectionAtCut"];
  readonly knownLength: number;
}): NumericMaterial {
  if (input.collectionAtCut === "unavailable") {
    return Object.freeze({ state: "unavailable" as const, reason: "source-unavailable" });
  }
  if (input.collectionAtCut === "complete") {
    return Object.freeze({ state: "exact" as const, value: input.knownLength });
  }
  return Object.freeze({ state: "lower-bound" as const, value: input.knownLength });
}

function cardinalityCoverage(material: NumericMaterial): {
  readonly coverage: AssertionCoverage;
  readonly limitations: readonly AssertionLimitation[];
} {
  if (material.state === "unavailable") {
    return Object.freeze({
      coverage: Object.freeze({ state: "unavailable" as const, reason: "source-unavailable" as const }),
      limitations: Object.freeze([]),
    });
  }
  if (material.state === "lower-bound") {
    return Object.freeze({
      coverage: Object.freeze({ state: "partial" as const, reason: "provider-limited" as const }),
      limitations: Object.freeze([{ kind: "provider-limited" as const }]),
    });
  }
  return Object.freeze({
    coverage: Object.freeze({ state: "complete" as const }),
    limitations: Object.freeze([]),
  });
}

export function freezeManagedToolCalls(input: {
  readonly scope: "turn" | "session" | "attempt";
  readonly sourceSnapshot: MatcherSourceSnapshot;
  readonly rows: readonly MatcherSourceRow<ProjectedMatcherCandidate<LogicalToolOccurrence>>[];
  readonly incompleteReason?: string;
  readonly actionsCoverage: unknown;
  readonly orphanFinishCount: number;
  readonly snapshot: unknown;
}): ManagedToolCalls {
  const views = Object.freeze(input.rows.map(occurrenceView));
  const collection = Object.freeze(views) as ManagedToolCalls;
  const sourceSnapshot = foldedSourceSnapshot(input.sourceSnapshot, input.incompleteReason);
  const cardinality = cardinalityMaterial({
    collectionAtCut: sourceSnapshot.collectionAtCut,
    knownLength: input.rows.length,
  });
  const coverage = cardinalityCoverage(cardinality);
  managedToolCallsSidecars.set(collection, Object.freeze({
    scope: input.scope,
    cardinality,
    sourceSnapshot,
    rows: input.rows,
    coverage: coverage.coverage,
    limitations: coverage.limitations,
    actionsCoverage: input.actionsCoverage,
    orphanFinishCount: input.orphanFinishCount,
    snapshot: input.snapshot,
  }));
  return collection;
}

export function managedToolCallsSidecarOf(value: unknown): ManagedToolCallsSidecar | undefined {
  return typeof value === "object" && value !== null
    ? managedToolCallsSidecars.get(value)
    : undefined;
}

function unavailableMatcherCandidate(reason: string): BooleanMatchEvaluation<never> {
  return Object.freeze({
    state: "unavailable" as const,
    reason,
    diagnostic: Object.freeze({
      code: "source-candidate-unavailable",
      message: "the matcher candidate could not be resolved from the immutable source ledger",
      path: Object.freeze([]),
      reason,
    }),
  });
}

function toolMatchEvaluation(
  occurrence: LogicalToolOccurrence,
  result: BooleanMatchEvaluation<unknown>,
): BooleanMatchEvaluation<unknown> {
  if (occurrence.lifecycle.state === "opaque" && result.state === "matched") {
    return Object.freeze({
      state: "unavailable" as const,
      reason: `tool-lifecycle-unavailable:${occurrence.lifecycle.reason}`,
      diagnostic: Object.freeze({
        code: "tool-lifecycle-unavailable",
        message: "the matching tool lifecycle is incomplete",
        path: Object.freeze([]),
        reason: occurrence.lifecycle.reason,
      }),
    });
  }
  return result;
}

function toolMatcherQuery(
  match: ToolMatch,
  summary: import("./api.ts").AssertionSnapshotValue = Object.freeze({
    matcher: match.name,
  }),
): MatcherQuery<ProjectedMatcherCandidate<LogicalToolOccurrence>> {
  return Object.freeze({
    summary,
    evaluate: async (candidate: ProjectedMatcherCandidate<LogicalToolOccurrence>) =>
      candidate.state === "unavailable"
        ? unavailableMatcherCandidate(candidate.reason)
        : toolMatchEvaluation(
            candidate.value,
            await evaluateBooleanMatch(match, candidate.value),
          ),
  });
}

function occurrenceAssertion(quantifier: ToolMatchQuantifier): "present" | "absent" | "count" {
  if (quantifier.kind === "absent") return "absent";
  if (quantifier.kind === "exact") return "count";
  return quantifier.kind === "at-least" && quantifier.count === 1 ? "present" : "count";
}

function occurrenceCriterion(
  scope: "turn" | "session" | "attempt",
  matcher: string | undefined,
  quantifier: ToolMatchQuantifier,
): AssertionCriterion {
  return Object.freeze({
    kind: "occurrence" as const,
    scope,
    occurrence: "tool" as const,
    assertion: occurrenceAssertion(quantifier),
    ...(matcher === undefined ? {} : { matcher }),
    quantifier: Object.freeze(
      quantifier.kind === "absent"
        ? { kind: "absent" as const }
        : { kind: quantifier.kind, count: quantifier.count },
    ),
  });
}

function orderCriterion(
  scope: "turn" | "session",
  matches: readonly ToolMatch[],
): AssertionCriterion {
  return Object.freeze({
    kind: "occurrence" as const,
    scope,
    occurrence: "tool" as const,
    assertion: "order" as const,
    matcher: matches.map((match) => match.name).join(", "),
  });
}

function matchedSubject<Subject>(
  evaluation: BooleanAssertionEvaluation<void>,
  subject: Subject,
): BooleanAssertionEvaluation<Subject> {
  if (evaluation.state === "matched") {
    return Object.freeze({ ...evaluation, value: subject });
  }
  return evaluation as BooleanAssertionEvaluation<Subject>;
}

export function collectionMatchRegistration<Subject>(
  subject: Subject,
  match: unknown,
): BooleanAssertionRegistration<Subject> {
  const sidecar = managedToolCallsSidecarOf(subject);
  if (isNumericComparisonMatch(match)) {
    if (sidecar !== undefined) {
      const captured = captureAssertionSnapshot(Object.freeze({
        ...sidecar.cardinality,
        cut: sidecar.snapshot,
        coverage: sidecar.coverage,
        collection: "tool-calls",
        scope: sidecar.scope,
      }));
      return numericBooleanRegistration({
        match,
        criterionSubject: Object.freeze({
          kind: "collection-cardinality" as const,
          collection: "tool-calls" as const,
          scope: sidecar.scope,
        }),
        material: sidecar.cardinality,
        captured: Object.freeze({
          ...captured,
          coverage: sidecar.coverage,
          limitations: sidecar.limitations,
        }),
        matchedValue: () => subject,
      });
    }
    if (!Array.isArray(subject)) {
      throw new TypeError("a numeric collection Match requires an array subject");
    }
    const material = Object.freeze({ state: "exact" as const, value: subject.length });
    const captured = captureAssertionSnapshot(Object.freeze({
      ...material,
      cut: Object.freeze({ kind: "author-array" as const }),
      coverage: Object.freeze({ state: "complete" as const }),
      derivation: Object.freeze({ kind: "explicit-value" as const }),
    }));
    return numericBooleanRegistration({
      match,
      criterionSubject: Object.freeze({ kind: "explicit-value" as const }),
      material,
      captured,
      matchedValue: () => subject,
    });
  }

  const spec = isManagedToolMatch(match)
    ? Object.freeze({
        kind: "occurrence" as const,
        item: match,
        quantifier: Object.freeze({ kind: "at-least" as const, count: 1 }),
      })
    : (() => {
        if (!isManagedCollectionMatch(match)) {
          if (looksLikeCollectionMatch(match)) {
            throw new TypeError("t.check() match must be a collection Match created by niceeval/expect");
          }
          throw new TypeError("t.check() match must be a ToolMatch or collection Match created by niceeval/expect");
        }
        return collectionMatchSpecOf(match);
      })();
  if (sidecar === undefined) {
    throw new TypeError(
      spec.kind === "in-order"
        ? "inOrder() requires a managed toolCalls collection"
        : "ToolMatch occurrence checks require a managed toolCalls collection",
    );
  }
  if (spec.kind === "occurrence") {
    const query = toolMatcherQuery(spec.item, Object.freeze({
      matcher: spec.item.name,
      quantifier: spec.quantifier,
    }));
    const captured = captureAssertionSnapshot({
      scope: sidecar.scope,
      occurrence: "tool",
      matcher: spec.item.name,
      quantifier: spec.quantifier,
      candidateCount: sidecar.rows.length,
      orphanFinishCount: sidecar.orphanFinishCount,
      coverage: sidecar.actionsCoverage,
      snapshot: sidecar.snapshot,
    });
    return Object.freeze({
      criterion: occurrenceCriterion(sidecar.scope, spec.item.name, spec.quantifier),
      subject: captured.material,
      coverage: captured.coverage,
      limitations: captured.limitations,
      interruptedMatcherArtifact: interruptedMatcherArtifact({
        sourceSnapshot: sidecar.sourceSnapshot,
        sourceRows: sidecar.rows.length,
        queries: Object.freeze([query.summary]),
        kind: "collection-filter",
      }),
      evaluate: () => Effect.tryPromise({
        try: async () => matchedSubject(
          await evaluateMatcherCollection({
            sourceSnapshot: sidecar.sourceSnapshot,
            rows: sidecar.rows,
            query,
            quantifier: spec.quantifier,
          }),
          subject,
        ),
        catch: (error) => error,
      }),
    });
  }

  if (sidecar.sourceSnapshot.scope === "attempt" || sidecar.scope === "attempt") {
    throw new TypeError("inOrder() is unavailable at Attempt scope");
  }
  const orderedSourceSnapshot = sidecar.sourceSnapshot;
  const queries = Object.freeze(spec.matches.map(toolMatcherQuery));
  const captured = captureAssertionSnapshot({
    scope: sidecar.scope,
    assertion: "tool-order",
    matches: spec.matches.map((item) => item.name),
    candidateCount: sidecar.rows.length,
    coverage: sidecar.coverage,
    snapshot: sidecar.snapshot,
  });
  return Object.freeze({
    criterion: orderCriterion(sidecar.scope, spec.matches),
    subject: captured.material,
    coverage: captured.coverage,
    limitations: captured.limitations,
    interruptedMatcherArtifact: interruptedMatcherArtifact({
      sourceSnapshot: orderedSourceSnapshot,
      sourceRows: sidecar.rows.length,
      queries: Object.freeze(queries.map((query) => query.summary)),
      kind: "ordered-sequence",
    }),
    evaluate: () => Effect.tryPromise({
      try: async () => matchedSubject(
        await evaluateMatcherOrder({
          sourceSnapshot: orderedSourceSnapshot,
          rows: sidecar.rows,
          queries,
        }),
        subject,
      ),
      catch: (error) => error,
    }),
  });
}

export type { CollectionMatch };
