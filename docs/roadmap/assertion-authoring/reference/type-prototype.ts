import type { StandardSchemaV1 } from "@standard-schema/spec";

export {};

type MatchDomain = "value" | "tool" | "event";
declare const matchInputBrand: unique symbol;
declare const matchRefinementBrand: unique symbol;

interface Match<in T, D extends MatchDomain> {
  readonly domain: D;
  readonly name: string;
  readonly [matchInputBrand]: (candidate: T) => void;
}

interface BooleanMatch<in T, out R extends T, D extends MatchDomain = "value"> extends Match<T, D> {
  readonly kind: "boolean";
  readonly [matchRefinementBrand]: () => R;
}

interface ScoreMatch<in T> extends Match<T, "value"> {
  readonly kind: "score";
}

interface LogicalToolOccurrence {
  readonly id: string;
}

interface LogicalCommandOccurrence extends LogicalToolOccurrence {
  readonly command: readonly string[];
}

interface MatchableEvent {
  readonly type: string;
}

type ToolMatch<R extends LogicalToolOccurrence = LogicalToolOccurrence> = BooleanMatch<
  LogicalToolOccurrence,
  R,
  "tool"
>;
type EventMatch<R extends MatchableEvent = MatchableEvent> = BooleanMatch<MatchableEvent, R, "event">;

type RefinementOf<M> = M extends BooleanMatch<infer _T, infer R, infer _D> ? R : never;
type RefinementIntersection<M extends readonly unknown[]> = M extends readonly [infer Head, ...infer Tail]
  ? RefinementOf<Head> & RefinementIntersection<Tail>
  : unknown;

declare function and<
  T,
  R extends T,
  D extends MatchDomain,
  const Rest extends readonly [
    BooleanMatch<NoInfer<T>, T, NoInfer<D>>,
    ...BooleanMatch<NoInfer<T>, T, NoInfer<D>>[],
  ],
>(
  first: BooleanMatch<T, R, D>,
  ...rest: Rest
): BooleanMatch<T, T & R & RefinementIntersection<Rest>, D>;

declare function or<
  T,
  R extends T,
  D extends MatchDomain,
  const Rest extends readonly [
    BooleanMatch<NoInfer<T>, T, NoInfer<D>>,
    ...BooleanMatch<NoInfer<T>, T, NoInfer<D>>[],
  ],
>(
  first: BooleanMatch<T, R, D>,
  ...rest: Rest
): BooleanMatch<T, T & (R | RefinementOf<Rest[number]>), D>;

declare function not<T>(match: BooleanMatch<T, T, "value">): BooleanMatch<T, T, "value">;

declare function matches<S extends StandardSchemaV1>(
  schema: S,
): BooleanMatch<unknown, StandardSchemaV1.InferInput<S>, "value">;

declare function satisfies<T, R extends T>(
  label: string,
  predicate: (value: T) => value is R,
): BooleanMatch<T, R, "value">;
declare function satisfies<T>(
  label: string,
  predicate: (value: T) => boolean | Promise<boolean>,
): BooleanMatch<T, T, "value">;

declare function defineValueMatch<T, R extends T>(spec: {
  readonly name: string;
  readonly evaluate: (value: T) => value is R;
}): BooleanMatch<T, R, "value">;
declare function defineValueMatch<T>(spec: {
  readonly name: string;
  readonly evaluate: (value: T) => boolean | Promise<boolean>;
}): BooleanMatch<T, T, "value">;

declare function defineScoreMatch<T>(spec: {
  readonly name: string;
  readonly score: (value: T) => number | Promise<number>;
}): ScoreMatch<T>;

interface TestContext {
  require<T, R extends T>(value: T, match: BooleanMatch<T, R, "value">): Promise<R>;
}

interface AssertionHandle {
  label(label: string): AssertionHandle;
  gate(threshold?: number): AssertionHandle;
  atLeast(threshold: number): AssertionHandle;
  soft(): AssertionHandle;
  optional(): AssertionHandle;
  stopOnFailure(): Promise<AssertionHandle>;
}

interface ScoreAssertionHandle {
  label(label: string): ScoreAssertionHandle;
  points(points: number): ScorePointHandle;
  gate(threshold?: number): ScoreAssertionHandle;
  atLeast(threshold: number): ScoreAssertionHandle;
  soft(): ScoreAssertionHandle;
  optional(): ScoreAssertionHandle;
  stopOnFailure(): Promise<ScoreAssertionHandle>;
}

interface ScorePointHandle {
  label(label: string): ScorePointHandle;
  gate(threshold?: number): ScorePointHandle;
  optional(): ScorePointHandle;
  stopOnFailure(): Promise<ScorePointHandle>;
}

type HasId = { readonly id: string };
type HasTitle = { readonly title: string };

declare const t: TestContext;
declare const candidate: unknown;
declare const hasId: BooleanMatch<unknown, HasId>;
declare const hasTitle: BooleanMatch<unknown, HasTitle>;
declare const command: ToolMatch<LogicalCommandOccurrence>;
declare const event: EventMatch;
declare const score: ScoreMatch<string>;
declare const assertionHandle: AssertionHandle;
declare const scoreHandle: ScoreAssertionHandle;
declare const transformingSchema: StandardSchemaV1<string, number>;

async function proveRefinements(): Promise<void> {
  const both = await t.require(candidate, and(hasId, hasTitle));
  both.id.toUpperCase();
  both.title.toUpperCase();

  const either = await t.require(candidate, or(hasId, hasTitle));
  if ("id" in either) either.id.toUpperCase();
  else either.title.toUpperCase();

  const original = await t.require(candidate, matches(transformingSchema));
  original.toUpperCase();
  // @ts-expect-error A transform output is not the original candidate returned by require().
  original.toFixed();

  const asyncMatch = defineValueMatch({
    name: "async check",
    async evaluate(value: unknown) {
      return value !== null;
    },
  });
  const asyncValue = await t.require(candidate, asyncMatch);
  // @ts-expect-error Async boolean evaluators do not refine the candidate.
  asyncValue.id;
}

defineValueMatch({
  name: "has id",
  evaluate(value: unknown): value is HasId {
    return typeof value === "object" && value !== null && "id" in value;
  },
});
defineScoreMatch({ name: "quality", score: (value: string) => value.length / 10 });
satisfies("has id", (value: unknown): value is HasId => {
  return typeof value === "object" && value !== null && "id" in value;
});

const combinedCommand = and(command, command);
declare const refinedCommand: RefinementOf<typeof combinedCommand>;
refinedCommand.command.at(0);
// @ts-expect-error Boolean composition cannot cross Match domains.
and(command, event);
// @ts-expect-error ScoreMatch cannot enter boolean composition.
and(command, score);
// @ts-expect-error not() is value-only and cannot negate a ToolMatch.
not(command);

assertionHandle.label("answer").gate().optional();
scoreHandle.label("answer").points(2).label("answer").gate().optional();
// @ts-expect-error Passing evals do not expose points().
assertionHandle.points(2);
// @ts-expect-error A scored point cannot be scored twice.
scoreHandle.points(2).points(1);
// @ts-expect-error A scored point cannot re-enter the quality-score surface.
scoreHandle.points(2).soft();
// @ts-expect-error A scored point cannot add a soft threshold.
scoreHandle.points(2).atLeast(0.5);
