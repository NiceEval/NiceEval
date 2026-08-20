import type { ExpEvalEvent } from "./process.js";

export interface ExpEvalOutcomeExpectation {
  readonly experimentId: string;
  readonly evalId: string;
  readonly verdict: ExpEvalEvent["verdict"];
  readonly attempts: number;
  readonly passed?: number;
  readonly reason?: "early_exit";
  readonly planned?: number;
  readonly unstarted?: number;
}

/** The public compound identity of one terminal `niceeval exp --json` Eval event. */
export interface ExactEvalIdentity {
  readonly experimentId: string;
  readonly evalId: string;
}

type ComparableField =
  | "verdict"
  | "attempts"
  | "passed"
  | "reason"
  | "planned"
  | "unstarted";

const COMPARABLE_FIELDS = [
  "verdict",
  "attempts",
  "passed",
  "reason",
  "planned",
  "unstarted",
] as const satisfies readonly ComparableField[];

function identityOf(value: Pick<ExpEvalEvent, "experimentId" | "evalId">): string {
  return JSON.stringify([value.experimentId, value.evalId]);
}

function labelOf(value: Pick<ExpEvalEvent, "experimentId" | "evalId">): string {
  return `${value.experimentId}/${value.evalId}`;
}

function indexUnique<T extends Pick<ExpEvalEvent, "experimentId" | "evalId">>(
  values: readonly T[],
  source: "actual" | "expected",
): Map<string, T> {
  const indexed = new Map<string, T>();
  for (const value of values) {
    const identity = identityOf(value);
    if (indexed.has(identity)) {
      throw new Error(
        `assertExpEvalOutcomes(): duplicate ${source} Eval identity ${labelOf(value)}`,
      );
    }
    indexed.set(identity, value);
  }
  return indexed;
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function actualField(event: ExpEvalEvent, field: ComparableField): unknown {
  switch (field) {
    case "verdict":
      return event.verdict;
    case "attempts":
      return event.attempts;
    case "passed":
      return event.passed;
    case "reason":
      return event.reason;
    case "planned":
      return event.planned;
    case "unstarted":
      return event.unstarted;
  }
}

function expectedField(
  expectation: ExpEvalOutcomeExpectation,
  field: ComparableField,
): unknown {
  return expectation[field];
}

function renderDiagnostic(
  diagnostic: string | (() => string) | undefined,
): string {
  if (diagnostic === undefined) return "";
  const rendered = typeof diagnostic === "function" ? diagnostic() : diagnostic;
  return `\n\n${rendered}`;
}

/**
 * Return exactly one public Eval conclusion selected by its full identity.
 *
 * A locator is deliberately not a selector: it is an output of the selected
 * event and may be used by the caller only after this identity lookup.
 */
export function exactEval<T extends ExpEvalEvent>(
  events: readonly T[],
  identity: ExactEvalIdentity,
  diagnostic?: string | (() => string),
): T {
  const matches = events.filter(
    (event) =>
      event.experimentId === identity.experimentId && event.evalId === identity.evalId,
  );
  if (matches.length !== 1) {
    const candidates = events.length === 0
      ? "(none)"
      : events.map((event) => labelOf(event)).join(", ");
    throw new Error(
      `exactEval(): expected exactly one Eval conclusion for ${labelOf(identity)}, got ${matches.length}; candidates: ${candidates}${renderDiagnostic(diagnostic)}`,
    );
  }
  return matches[0]!;
}

/**
 * Strictly compare public Eval conclusion events with caller-owned literals.
 * The helper never derives expectations or interprets one Verdict as another.
 */
export function assertExpEvalOutcomes(
  actual: readonly ExpEvalEvent[],
  expected: readonly ExpEvalOutcomeExpectation[],
  diagnostic?: string | (() => string),
): ExpEvalEvent[] {
  const actualByIdentity = indexUnique(actual, "actual");
  const expectedByIdentity = indexUnique(expected, "expected");
  const problems: string[] = [];

  for (const expectation of expected) {
    const identity = identityOf(expectation);
    const event = actualByIdentity.get(identity);
    if (event === undefined) {
      problems.push(`missing ${labelOf(expectation)}`);
      continue;
    }

    for (const field of COMPARABLE_FIELDS) {
      if (!hasOwn(expectation, field)) continue;
      const expectedValue = expectedField(expectation, field);
      const actualValue = actualField(event, field);
      if (!Object.is(actualValue, expectedValue)) {
        problems.push(
          `${labelOf(expectation)} ${field}: expected ${JSON.stringify(expectedValue)}, got ${JSON.stringify(actualValue)}`,
        );
      }
    }
  }

  for (const event of actual) {
    if (!expectedByIdentity.has(identityOf(event))) {
      problems.push(`unexpected ${labelOf(event)}`);
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `assertExpEvalOutcomes(): Eval conclusions do not match\n${problems.map((problem) => `- ${problem}`).join("\n")}${renderDiagnostic(diagnostic)}`,
    );
  }

  return [...actual];
}
