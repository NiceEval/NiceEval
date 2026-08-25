import type {
  AssertionCollectionReceipt,
  AssertionSnapshotObject,
  AssertionSnapshotValue,
  BooleanAssertionEvaluation,
  MatcherOrderPathNode,
  MatcherQueryArtifact,
  MatcherQueryStep,
  MatcherRetainedRow,
  MatcherSourceLocator,
  MatcherSourceSnapshot,
  OrderStepReceipt,
} from "./api.ts";
import type {
  BooleanMatchEvaluation,
  MatchDiagnostic,
  ToolMatchQuantifier,
} from "./match.ts";
import { captureAssertionSnapshot } from "./runtime.ts";

const MAX_QUERY_STEPS = 64;
const MAX_REPRESENTATIVES = 8;

export interface MatcherSourceRow<Candidate> {
  readonly locator: MatcherSourceLocator;
  readonly sessionId: string;
  readonly sessionSequence: number;
  readonly candidate: Candidate;
}

export interface MatcherQuery<Candidate> {
  readonly summary: AssertionSnapshotValue;
  readonly evaluate: (
    candidate: Candidate,
  ) => Promise<BooleanMatchEvaluation<unknown>>;
}

function retainedText(value: string, codePoints: number): string {
  return Array.from(value).slice(0, codePoints).join("");
}

function isSnapshotObject(
  value: AssertionSnapshotValue,
): value is AssertionSnapshotObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function diagnosticSnapshot(diagnostic: MatchDiagnostic): AssertionSnapshotObject {
  const captured = captureAssertionSnapshot(diagnostic).material;
  if (
    captured.kind === "snapshot" &&
    isSnapshotObject(captured.value) &&
    new TextEncoder().encode(JSON.stringify(captured.value)).byteLength <= 4 * 1_024
  ) {
    return captured.value;
  }
  return Object.freeze({
    code: retainedText(diagnostic.code, 128),
    message: retainedText(diagnostic.message, 512),
    truncation: Object.freeze({
      code: "diagnostic-truncated",
      reason: "matcher-artifact-byte-limit",
    }),
  });
}

function locatorKey(locator: MatcherSourceLocator): string {
  return locator.kind === "tool-occurrence"
    ? `tool:${locator.toolOccurrenceId}`
    : `event:${locator.eventId}`;
}

function comparisonDifference(
  step: number,
  summary: AssertionSnapshotValue,
  evaluation: BooleanMatchEvaluation<unknown>,
  index?: number,
): AssertionSnapshotObject {
  return Object.freeze({
    step,
    ...(index === undefined ? {} : { index }),
    query: summary,
    state: evaluation.state,
    ...(evaluation.state === "unavailable" ? { reason: evaluation.reason } : {}),
    ...(evaluation.diagnostic === undefined
      ? {}
      : { evidence: diagnosticSnapshot(evaluation.diagnostic) }),
  });
}

function overlayResult(
  locator: MatcherSourceLocator,
  evaluation: BooleanMatchEvaluation<unknown>,
): "matched" | "mismatched" | "unavailable" {
  return evaluation.state === "matched" && locator.relation.state !== "exact"
    ? "unavailable"
    : evaluation.state;
}

function retainRepresentative(
  representatives: MatcherRetainedRow[],
  row: MatcherSourceRow<unknown>,
  result: "matched" | "mismatched" | "unavailable",
  difference: AssertionSnapshotValue,
  decisive = false,
): void {
  const retained: MatcherRetainedRow = Object.freeze({
    locator: row.locator,
    result,
    difference,
  });
  const existing = representatives.findIndex(
    (candidate) => locatorKey(candidate.locator) === locatorKey(row.locator),
  );
  if (existing >= 0) {
    if (result === "unavailable" || decisive) representatives[existing] = retained;
    return;
  }
  if (representatives.length < MAX_REPRESENTATIVES) {
    representatives.push(retained);
  } else if (decisive) {
    representatives[MAX_REPRESENTATIVES - 1] = retained;
  }
}

function collectionReceipt(input: {
  readonly examined: number;
  readonly matched: number;
  readonly mismatched: number;
  readonly unavailable: number;
  readonly knownTotal: number;
  readonly complete: boolean;
  readonly decisive: boolean;
}): AssertionCollectionReceipt {
  return Object.freeze({
    ...input,
    exhaustive: input.complete && input.examined === input.knownTotal,
  });
}

function collectionResult(
  quantifier: ToolMatchQuantifier,
  counts: { readonly matched: number; readonly unavailable: number },
  complete: boolean,
): "matched" | "mismatched" | "unavailable" {
  if (quantifier.kind === "absent") {
    if (counts.matched > 0) return "mismatched";
    return complete && counts.unavailable === 0 ? "matched" : "unavailable";
  }
  if (quantifier.kind === "at-least") {
    if (counts.matched >= quantifier.count) return "matched";
    return complete && counts.unavailable === 0 ? "mismatched" : "unavailable";
  }
  if (counts.matched > quantifier.count) return "mismatched";
  if (complete && counts.unavailable === 0) {
    return counts.matched === quantifier.count ? "matched" : "mismatched";
  }
  return "unavailable";
}

function queryStep(step: number, summary: AssertionSnapshotValue): MatcherQueryStep {
  return Object.freeze({ step, summary });
}

export async function evaluateMatcherCollection<Candidate>(input: {
  readonly sourceSnapshot: MatcherSourceSnapshot;
  readonly rows: readonly MatcherSourceRow<Candidate>[];
  readonly query: MatcherQuery<Candidate>;
  readonly quantifier: ToolMatchQuantifier;
}): Promise<BooleanAssertionEvaluation<void>> {
  let examined = 0;
  let matched = 0;
  let mismatched = 0;
  let unavailable = 0;
  const representatives: MatcherRetainedRow[] = [];
  let diagnostic: MatchDiagnostic | undefined;

  for (const row of input.rows) {
    const evaluation = await input.query.evaluate(row.candidate);
    const state = overlayResult(row.locator, evaluation);
    examined += 1;
    if (state === "matched") matched += 1;
    else if (state === "mismatched") mismatched += 1;
    else unavailable += 1;

    const current = collectionResult(input.quantifier, { matched, unavailable }, false);
    const decisive = current !== "unavailable" && (
      (input.quantifier.kind === "absent" && matched > 0) ||
      (input.quantifier.kind === "at-least" && matched >= input.quantifier.count) ||
      (input.quantifier.kind === "exact" && matched > input.quantifier.count)
    );
    retainRepresentative(
      representatives,
      row,
      state,
      comparisonDifference(1, input.query.summary, evaluation, examined - 1),
      decisive,
    );
    if (decisive) {
      diagnostic = evaluation.diagnostic;
      break;
    }
    diagnostic ??= evaluation.diagnostic;
  }

  const sourceComplete = input.sourceSnapshot.collectionAtCut === "complete";
  const exhaustive = examined === input.rows.length;
  const state = collectionResult(
    input.quantifier,
    { matched, unavailable },
    sourceComplete && exhaustive,
  );
  const decisive = state !== "unavailable";
  const receipt = collectionReceipt({
    examined,
    matched,
    mismatched,
    unavailable,
    knownTotal: input.rows.length,
    complete: sourceComplete,
    decisive,
  });
  const artifact: MatcherQueryArtifact = Object.freeze({
    kind: "collection-filter" as const,
    sourceSnapshot: input.sourceSnapshot,
    query: queryStep(1, input.query.summary),
    receipt,
    retainedRows: Object.freeze(representatives),
  });
  switch (state) {
    case "matched":
      return Object.freeze({
        state: "matched" as const,
        value: undefined,
        ...(diagnostic === undefined ? {} : { diagnostic }),
        receipt,
        matcherArtifact: artifact,
      });
    case "mismatched":
      return Object.freeze({
        state: "mismatched" as const,
        ...(diagnostic === undefined ? {} : { diagnostic }),
        receipt,
        matcherArtifact: artifact,
      });
    case "unavailable":
      return Object.freeze({
        state: "unavailable" as const,
        reason: "evidence-unavailable" as const,
        ...(diagnostic === undefined ? {} : { diagnostic }),
        receipt,
        matcherArtifact: artifact,
      });
  }
}

interface PathLink {
  readonly node: MatcherOrderPathNode;
  readonly previous: PathLink | undefined;
}

interface MutableStepReceipt {
  comparisons: number;
  matched: number;
  mismatched: number;
  unavailable: number;
}

function pathFrom(link: PathLink | undefined): readonly MatcherOrderPathNode[] {
  const reversed: MatcherOrderPathNode[] = [];
  for (let current = link; current !== undefined; current = current.previous) {
    reversed.push(current.node);
  }
  return Object.freeze(reversed.reverse());
}

function prefixLength(frontier: readonly (PathLink | undefined)[]): number {
  for (let index = frontier.length - 1; index >= 0; index -= 1) {
    if (frontier[index] !== undefined) return index + 1;
  }
  return 0;
}

function orderStepReceipts(
  receipts: readonly MutableStepReceipt[],
): readonly OrderStepReceipt[] {
  return Object.freeze(receipts.map((receipt, index) => Object.freeze({
    step: index + 1,
    comparisons: receipt.comparisons,
    matched: receipt.matched,
    mismatched: receipt.mismatched,
    unavailable: receipt.unavailable,
  })));
}

function suffixReceipt(
  receipt: MutableStepReceipt,
  complete: boolean,
): AssertionCollectionReceipt {
  return Object.freeze({
    examined: receipt.comparisons,
    matched: receipt.matched,
    mismatched: receipt.mismatched,
    unavailable: receipt.unavailable,
    knownTotal: receipt.comparisons,
    complete,
    exhaustive: complete,
    decisive: complete && receipt.matched === 0 && receipt.unavailable === 0,
  });
}

export async function evaluateMatcherOrder<Candidate>(input: {
  readonly sourceSnapshot: Extract<
    MatcherSourceSnapshot,
    { readonly scope: "turn" | "session" }
  >;
  readonly rows: readonly MatcherSourceRow<Candidate>[];
  readonly queries: readonly MatcherQuery<Candidate>[];
}): Promise<BooleanAssertionEvaluation<void>> {
  if (input.queries.length < 2 || input.queries.length > MAX_QUERY_STEPS) {
    throw new TypeError("An ordered matcher query requires between two and 64 steps");
  }
  const definite: Array<PathLink | undefined> = Array(input.queries.length);
  const possible: Array<PathLink | undefined> = Array(input.queries.length);
  const stepReceipts: MutableStepReceipt[] = input.queries.map(() => ({
    comparisons: 0,
    matched: 0,
    mismatched: 0,
    unavailable: 0,
  }));
  const suffixReceipts: MutableStepReceipt[] = input.queries.map(() => ({
    comparisons: 0,
    matched: 0,
    mismatched: 0,
    unavailable: 0,
  }));
  const representatives: MatcherRetainedRow[] = [];
  let processedRows = 0;
  let previousSessionSequence = 0;

  for (const row of input.rows) {
    if (
      row.sessionId !== input.sourceSnapshot.sessionId ||
      row.sessionSequence > input.sourceSnapshot.throughSessionSequence ||
      row.sessionSequence <= previousSessionSequence
    ) {
      throw new Error(
        "Ordered matcher rows must be strictly increasing inside the immutable source cut",
      );
    }
    previousSessionSequence = row.sessionSequence;
    processedRows += 1;
    for (let index = input.queries.length - 1; index >= 0; index -= 1) {
      const query = input.queries[index]!;
      const evaluation = await query.evaluate(row.candidate);
      const state = overlayResult(row.locator, evaluation);
      const receipt = stepReceipts[index]!;
      receipt.comparisons += 1;
      receipt[state] += 1;

      const predecessorPossible = index === 0 || possible[index - 1] !== undefined;
      if (predecessorPossible) {
        const suffix = suffixReceipts[index]!;
        suffix.comparisons += 1;
        suffix[state] += 1;
      }

      retainRepresentative(
        representatives,
        row,
        state,
        comparisonDifference(index + 1, query.summary, evaluation),
      );

      if (
        definite[index] === undefined &&
        state === "matched" &&
        (index === 0 || definite[index - 1] !== undefined)
      ) {
        definite[index] = Object.freeze({
          previous: index === 0 ? undefined : definite[index - 1],
          node: Object.freeze({
            step: index + 1,
            locator: row.locator,
            sessionId: row.sessionId,
            sessionSequence: row.sessionSequence,
            result: "matched" as const,
          }),
        });
      }
      if (
        possible[index] === undefined &&
        state !== "mismatched" &&
        predecessorPossible
      ) {
        possible[index] = Object.freeze({
          previous: index === 0 ? undefined : possible[index - 1],
          node: Object.freeze({
            step: index + 1,
            locator: row.locator,
            sessionId: row.sessionId,
            sessionSequence: row.sessionSequence,
            result: state === "matched" ? "matched" as const : "unavailable" as const,
          }),
        });
      }
    }
    if (definite[input.queries.length - 1] !== undefined) break;
  }

  const definitePrefixLength = prefixLength(definite);
  const possiblePrefixLength = prefixLength(possible);
  const sourceComplete = input.sourceSnapshot.collectionAtCut === "complete";
  const exhaustive = processedRows === input.rows.length;
  const matched = definitePrefixLength === input.queries.length;
  const failed = !matched && possiblePrefixLength < input.queries.length &&
    sourceComplete && exhaustive;
  const decisive = matched || failed;
  const immutableStepReceipts = orderStepReceipts(stepReceipts);
  const receipt = Object.freeze({
    sourceRows: input.rows.length,
    comparisons: immutableStepReceipts.reduce((sum, step) => sum + step.comparisons, 0),
    unavailableComparisons: immutableStepReceipts.reduce(
      (sum, step) => sum + step.unavailable,
      0,
    ),
    definitePrefixLength,
    possiblePrefixLength,
    stepReceipts: immutableStepReceipts,
    complete: sourceComplete,
    exhaustive,
    decisive,
  });
  const querySteps = Object.freeze(input.queries.map((query, index) =>
    queryStep(index + 1, query.summary)
  ));
  const retainedRows = Object.freeze(representatives);
  const artifact: MatcherQueryArtifact = matched
    ? Object.freeze({
        kind: "ordered-sequence" as const,
        sourceSnapshot: input.sourceSnapshot,
        querySteps,
        receipt,
        result: Object.freeze({
          state: "matched" as const,
          witnessPath: pathFrom(definite[input.queries.length - 1]),
        }),
        retainedRows,
      })
    : failed
    ? Object.freeze({
        kind: "ordered-sequence" as const,
        sourceSnapshot: input.sourceSnapshot,
        querySteps,
        receipt,
        result: Object.freeze({
          state: "mismatched" as const,
          failureFrontier: Object.freeze({
            longestDefinitePrefix: pathFrom(
              definitePrefixLength === 0 ? undefined : definite[definitePrefixLength - 1],
            ),
            longestPossiblePrefix: pathFrom(
              possiblePrefixLength === 0 ? undefined : possible[possiblePrefixLength - 1],
            ),
            firstBlockingStep: possiblePrefixLength + 1,
            suffixChecked: suffixReceipt(
              suffixReceipts[possiblePrefixLength]!,
              true,
            ),
            representatives: retainedRows,
          }),
        }),
        retainedRows,
      })
    : Object.freeze({
        kind: "ordered-sequence" as const,
        sourceSnapshot: input.sourceSnapshot,
        querySteps,
        receipt,
        result: Object.freeze({
          state: "unavailable" as const,
          reason: possiblePrefixLength === input.queries.length
            ? "possible-witness-not-definite"
            : `source-${input.sourceSnapshot.collectionAtCut}`,
        }),
        retainedRows,
      });
  return matched
    ? Object.freeze({
        state: "matched" as const,
        value: undefined,
        matcherArtifact: artifact,
      })
    : failed
    ? Object.freeze({ state: "mismatched" as const, matcherArtifact: artifact })
    : Object.freeze({
        state: "unavailable" as const,
        reason: "evidence-unavailable" as const,
        matcherArtifact: artifact,
      });
}

export function interruptedMatcherArtifact(input: {
  readonly sourceSnapshot: MatcherSourceSnapshot;
  readonly sourceRows: number;
  readonly queries: readonly AssertionSnapshotValue[];
  readonly kind: "collection-filter" | "ordered-sequence";
}): MatcherQueryArtifact {
  if (input.kind === "collection-filter") {
    return Object.freeze({
      kind: "collection-filter" as const,
      sourceSnapshot: input.sourceSnapshot,
      query: queryStep(1, input.queries[0] ?? "matcher"),
      receipt: Object.freeze({
        examined: 0,
        matched: 0,
        mismatched: 0,
        unavailable: 0,
        knownTotal: input.sourceRows,
        complete: input.sourceSnapshot.collectionAtCut === "complete",
        exhaustive: false,
        decisive: false,
      }),
      retainedRows: Object.freeze([]),
    });
  }
  if (input.sourceSnapshot.scope === "attempt") {
    throw new TypeError("Attempt scope cannot create an ordered matcher artifact");
  }
  if (input.queries.length < 2 || input.queries.length > MAX_QUERY_STEPS) {
    throw new TypeError("An ordered matcher query requires between two and 64 steps");
  }
  return Object.freeze({
    kind: "ordered-sequence" as const,
    sourceSnapshot: input.sourceSnapshot,
    querySteps: Object.freeze(input.queries.map((summary, index) =>
      queryStep(index + 1, summary)
    )),
    receipt: Object.freeze({
      sourceRows: input.sourceRows,
      comparisons: 0,
      unavailableComparisons: 0,
      definitePrefixLength: 0,
      possiblePrefixLength: 0,
      stepReceipts: Object.freeze(input.queries.map((_, index) => Object.freeze({
        step: index + 1,
        comparisons: 0,
        matched: 0,
        mismatched: 0,
        unavailable: 0,
      }))),
      complete: input.sourceSnapshot.collectionAtCut === "complete",
      exhaustive: false,
      decisive: false,
    }),
    result: Object.freeze({
      state: "unavailable" as const,
      reason: "producer-interrupted",
    }),
    retainedRows: Object.freeze([]),
  });
}
