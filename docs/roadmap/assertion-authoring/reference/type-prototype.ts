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

type FactPhase = "now" | "final";
declare const factBrand: unique symbol;
declare const usageCoverageBrand: unique symbol;

interface BooleanFact<out R = unknown, P extends FactPhase = FactPhase> {
  readonly kind: "boolean";
  readonly phase: P;
  readonly [factBrand]: () => R;
}

interface ScoreFact<P extends FactPhase = FactPhase> {
  readonly kind: "score";
  readonly phase: P;
  readonly [factBrand]: () => number;
}

interface UsageEvidenceFact<P extends FactPhase = FactPhase> extends BooleanFact<unknown, P> {
  readonly [usageCoverageBrand]: true;
}

interface FactUseOptions {
  readonly key?: string;
  readonly label?: string;
}

interface ScoreThresholdOptions extends FactUseOptions {
  readonly atLeast: number;
}

interface TestContext {
  check<T, R extends T>(subject: T, match: BooleanMatch<T, R, "value">): BooleanFact<R, "now">;
  check<T>(subject: T, match: ScoreMatch<T>): ScoreFact<"now">;

  assert<R, P extends FactPhase>(fact: BooleanFact<R, P>, options?: FactUseOptions): void;
  assert<P extends FactPhase>(fact: ScoreFact<P>, options: ScoreThresholdOptions): void;
  assertIfCovered<P extends FactPhase>(fact: UsageEvidenceFact<P>, options?: FactUseOptions): void;

  require<R>(fact: BooleanFact<R, "now">, options?: FactUseOptions): Promise<R>;
  require(fact: ScoreFact<"now">, options: ScoreThresholdOptions): Promise<number>;
  require<T, R extends T>(
    value: T,
    match: BooleanMatch<T, R, "value">,
    options?: FactUseOptions,
  ): Promise<R>;
}

interface ScoreTestContext extends TestContext {
  score<P extends FactPhase>(
    label: string,
    fact: BooleanFact<unknown, P> | ScoreFact<P>,
    options: { readonly key?: string; readonly max: number },
  ): void;
  score(label: string, direct: { readonly key?: string; readonly earned: number }): void;
}

interface KeyedFactUseOptions extends FactUseOptions {
  readonly key: string;
}

interface KeyedScoreThresholdOptions extends KeyedFactUseOptions {
  readonly atLeast: number;
}

interface ReplayGradingFactUses {
  assert<R, P extends FactPhase>(fact: BooleanFact<R, P>, options: KeyedFactUseOptions): void;
  assert<P extends FactPhase>(fact: ScoreFact<P>, options: KeyedScoreThresholdOptions): void;
  assertIfCovered<P extends FactPhase>(fact: UsageEvidenceFact<P>, options: KeyedFactUseOptions): void;
}

interface ReplayScoreFactUses extends ReplayGradingFactUses {
  score<P extends FactPhase>(
    label: string,
    fact: BooleanFact<unknown, P> | ScoreFact<P>,
    options: { readonly key: string; readonly max: number },
  ): void;
  score(label: string, direct: { readonly key: string; readonly earned: number }): void;
}

interface ScoreEvalInput {
  test(t: ScoreTestContext): void | Promise<void>;
}

type HasId = { readonly id: string };
type HasTitle = { readonly title: string };

declare const t: TestContext;
declare const scoreT: ScoreTestContext;
declare const grading: ReplayGradingFactUses;
declare const scoreGrading: ReplayScoreFactUses;
declare const candidate: unknown;
declare const hasId: BooleanMatch<unknown, HasId>;
declare const hasTitle: BooleanMatch<unknown, HasTitle>;
declare const send: () => Promise<{ readonly message: string }>;
declare const command: ToolMatch<LogicalCommandOccurrence>;
declare const event: EventMatch;
declare const score: ScoreMatch<string>;
declare const finalFact: BooleanFact<void, "final">;
declare const usageFact: UsageEvidenceFact<"final">;
declare const transformingSchema: StandardSchemaV1<string, number>;

function proveReplayUseKeys(): void {
  grading.assert(finalFact, { key: "final-valid" });
  grading.assertIfCovered(usageFact, { key: "usage-covered" });
  scoreGrading.score("回答质量", finalFact, { key: "answer-quality", max: 10 });
  scoreGrading.score("代码精简", { key: "code-simplicity", earned: 2 });

  // @ts-expect-error Replayable grading requires a key for every verdict use.
  grading.assert(finalFact);
  // @ts-expect-error Replayable grading requires a key for every score use.
  scoreGrading.score("回答质量", finalFact, { max: 10 });
}

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

  const hasIdFact = t.check(candidate, hasId);
  t.assert(hasIdFact);
  const id = await t.require(t.check(candidate, hasId));
  id.id.toUpperCase();

  const quality = t.check("answer", score);
  t.assert(quality, { atLeast: 0.7 });
  await t.require(quality, { atLeast: 0.7 });

  t.assert(finalFact);
  // @ts-expect-error A final Fact cannot control code before finalization.
  await t.require(finalFact);

  t.assertIfCovered(usageFact);
  // @ts-expect-error Coverage policy is restricted to branded usage Facts.
  t.assertIfCovered(hasIdFact);
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

const boolFact = t.check(candidate, hasId);
const scoreFact = t.check("answer", score);

scoreT.score("has id", boolFact, { max: 2 });
scoreT.score("quality", scoreFact, { max: 10 });
scoreT.score("direct", { earned: 3 });
t.assert(scoreFact, { atLeast: 0.5 });

// @ts-expect-error A Score Fact needs an explicit threshold when used for verdict.
t.assert(scoreFact);
// @ts-expect-error Passing TestContext does not expose score().
t.score("has id", boolFact, { max: 2 });
// @ts-expect-error Facts do not expose the retired points() chain.
boolFact.points(2);
// @ts-expect-error Score Eval completion is the test callback's normal return.
scoreT.finishScore();

const validScoreEval: ScoreEvalInput = {
  test(context) {
    context.score("zero is explicit", { earned: 0 });
  },
};
void validScoreEval;

const validEmptyScoreEval: ScoreEvalInput = {
  test() {},
};
void validEmptyScoreEval;

const invalidNumberReturn: ScoreEvalInput = {
  // @ts-expect-error Score Eval tests do not return application values.
  test: () => 1,
};
void invalidNumberReturn;

const invalidPromiseReturn: ScoreEvalInput = {
  // @ts-expect-error Score Eval tests do not return application promises.
  test: async () => 1,
};
void invalidPromiseReturn;

const invalidSendReturn: ScoreEvalInput = {
  // @ts-expect-error Await managed work instead of returning its value.
  test: () => send(),
};
void invalidSendReturn;
