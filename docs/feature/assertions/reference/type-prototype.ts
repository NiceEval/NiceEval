export {};

declare const assertionHandleBrand: unique symbol;
declare const measurementStateBrand: unique symbol;
declare const managedToolCallsBrand: unique symbol;
declare const exactCardinalityBrand: unique symbol;
declare const toolMatchBrand: unique symbol;

type EvaluationKind = "pass" | "score";

interface AssertionHandleBase {
  readonly [assertionHandleBrand]: true;
  key(value: string): this;
  label(value: string): this;
  group(title: string): this;
}

interface PassBooleanHandle<out R = void> extends AssertionHandleBase {
  readonly kind: "pass-boolean";
  optional(): this;
  gate(): this;
  orStop(): Promise<R>;
}

interface ScoreBooleanHandle<out R = void, HasScore extends boolean = false>
  extends AssertionHandleBase {
  readonly kind: "score-boolean";
  readonly [measurementStateBrand]: { readonly score: HasScore };
  score(this: ScoreBooleanHandle<R, false>, value: number): ScoreBooleanHandle<R, true>;
  orStop(): Promise<R>;
}

interface PassMeasurementHandle<Thresholded extends boolean = false> extends AssertionHandleBase {
  readonly kind: "pass-measurement";
  readonly [measurementStateBrand]: { readonly threshold: Thresholded };
  atLeast(value: number): PassMeasurementHandle<true>;
  gate(value: number): PassMeasurementHandle<true>;
  orStop(this: PassMeasurementHandle<true>): Promise<number>;
}

interface ScoreMeasurementHandle<
  Thresholded extends boolean = false,
  HasScore extends boolean = false,
> extends AssertionHandleBase {
  readonly kind: "score-measurement";
  readonly [measurementStateBrand]: {
    readonly threshold: Thresholded;
    readonly score: HasScore;
  };
  atLeast(value: number): ScoreMeasurementHandle<true, HasScore>;
  score(this: ScoreMeasurementHandle<Thresholded, false>, value: number): ScoreMeasurementHandle<Thresholded, true>;
  orStop(this: ScoreMeasurementHandle<true, HasScore>): Promise<number>;
}

interface DirectScoreHandle extends AssertionHandleBase {
  readonly kind: "direct-score";
}

interface BooleanMatch<in T, out R extends T = T> {
  readonly kind: "boolean-match";
  readonly refine: (value: T) => R;
}

interface CollectionMatch<in T> {
  readonly kind: "collection-match";
}

interface MeasurementMatch<in T> {
  readonly kind: "measurement-match";
  readonly evaluate: (value: T) => number | Promise<number>;
}

type Subject<T> = T extends AssertionHandleBase ? never : T;

interface CalledToolOptions {
  readonly count?: number | { readonly atLeast: number };
}

interface ToolOccurrenceView {
  readonly name: string;
  readonly input?: unknown;
  readonly output?: unknown;
  readonly status?: "pending" | "completed" | "failed" | "rejected";
}

interface ManagedToolCalls<
  out S extends "turn" | "session" | "attempt" = "turn" | "session" | "attempt",
> extends ReadonlyArray<ToolOccurrenceView> {
  readonly [managedToolCallsBrand]: S;
}

interface ExactCardinality {
  readonly [exactCardinalityBrand]: true;
  readonly count: number;
}

type ToolMatch = BooleanMatch<ToolOccurrenceView> & {
  readonly [toolMatchBrand]: true;
};

interface PassScope {
  check<V, R extends V>(value: Subject<V>, match: BooleanMatch<NoInfer<V>, R>): PassBooleanHandle<R>;
  check<V>(value: Subject<V>, match: CollectionMatch<NoInfer<V>>): PassBooleanHandle<V>;
  check<V>(value: Subject<V>, match: MeasurementMatch<NoInfer<V>>): PassMeasurementHandle;
  succeeded(): PassBooleanHandle<void>;
  calledTool(name: string, options?: CalledToolOptions): PassBooleanHandle<void>;
  calledTool(match: ToolMatch, options?: CalledToolOptions): PassBooleanHandle<void>;
  notCalledTool(name: string): PassBooleanHandle<void>;
  notCalledTool(match: ToolMatch): PassBooleanHandle<void>;
  usedNoTools(): PassBooleanHandle<void>;
  maxToolCalls(maximum: number): PassBooleanHandle<void>;
  maxTokens(maximum: number): PassUsageHandle<void>;
  maxCost(maximumUSD: number): PassUsageHandle<void>;
}

interface ScoreScope {
  check<V, R extends V>(value: Subject<V>, match: BooleanMatch<NoInfer<V>, R>): ScoreBooleanHandle<R>;
  check<V>(value: Subject<V>, match: CollectionMatch<NoInfer<V>>): ScoreBooleanHandle<V>;
  check<V>(value: Subject<V>, match: MeasurementMatch<NoInfer<V>>): ScoreMeasurementHandle;
  succeeded(): ScoreBooleanHandle<void>;
  calledTool(name: string, options?: CalledToolOptions): ScoreBooleanHandle<void>;
  calledTool(match: ToolMatch, options?: CalledToolOptions): ScoreBooleanHandle<void>;
  notCalledTool(name: string): ScoreBooleanHandle<void>;
  notCalledTool(match: ToolMatch): ScoreBooleanHandle<void>;
  usedNoTools(): ScoreBooleanHandle<void>;
  maxToolCalls(maximum: number): ScoreBooleanHandle<void>;
  maxTokens(maximum: number): ScoreUsageHandle<void>;
  maxCost(maximumUSD: number): ScoreUsageHandle<void>;
}

interface PassUsageHandle<out R = void> extends PassBooleanHandle<R> {
  ifCovered(): this;
}

interface ScoreUsageHandle<out R = void> extends ScoreBooleanHandle<R> {
  ifCovered(): this;
}

interface PassJudgeRecipes {
  closedQA(question: string): PassMeasurementHandle;
  factuality(reference: string): PassMeasurementHandle;
}

interface ScoreJudgeRecipes {
  closedQA(question: string): ScoreMeasurementHandle;
  factuality(reference: string): ScoreMeasurementHandle;
}

interface PassTurn extends PassScope {
  readonly message: string;
  readonly judge: PassJudgeRecipes;
  readonly toolCalls: ManagedToolCalls<"turn">;
  toolOrder(matches: readonly [ToolMatch, ToolMatch, ...ToolMatch[]]): PassBooleanHandle<void>;
}

interface ScoreTurn extends ScoreScope {
  readonly message: string;
  readonly judge: ScoreJudgeRecipes;
  readonly toolCalls: ManagedToolCalls<"turn">;
  toolOrder(matches: readonly [ToolMatch, ToolMatch, ...ToolMatch[]]): ScoreBooleanHandle<void>;
}

interface PassSession extends PassScope {
  send(input: string): Promise<PassTurn>;
  readonly toolCalls: ManagedToolCalls<"session">;
  toolOrder(matches: readonly [ToolMatch, ToolMatch, ...ToolMatch[]]): PassBooleanHandle<void>;
}

interface ScoreSession extends ScoreScope {
  send(input: string): Promise<ScoreTurn>;
  readonly toolCalls: ManagedToolCalls<"session">;
  toolOrder(matches: readonly [ToolMatch, ToolMatch, ...ToolMatch[]]): ScoreBooleanHandle<void>;
}

interface PassTestContext extends PassScope {
  readonly evaluationKind: "pass";
  readonly toolCalls: ManagedToolCalls<"attempt">;
  newSession(): PassSession;
  send(input: string): Promise<PassTurn>;
}

interface ScoreTestContext extends ScoreScope {
  readonly evaluationKind: "score";
  readonly toolCalls: ManagedToolCalls<"attempt">;
  newSession(): ScoreSession;
  send(input: string): Promise<ScoreTurn>;
  score(value: number): DirectScoreHandle;
}

type PassFinalizable = PassBooleanHandle<unknown> | PassMeasurementHandle<true>;
declare function finalizePass(...entries: readonly PassFinalizable[]): void;

declare const pass: PassTestContext;
declare const passSession: PassSession;
declare const passTurn: PassTurn;
declare const score: ScoreTestContext;
declare const scoreTurn: ScoreTurn;
declare const candidate: unknown;
declare const reply: string;
declare const hasId: BooleanMatch<unknown, { readonly id: string }>;
declare const isTrue: BooleanMatch<boolean, true>;
declare const quality: MeasurementMatch<string>;

declare function lessThan(threshold: number): BooleanMatch<number>;
declare function atMost(threshold: number): BooleanMatch<number>;
declare function greaterThan(threshold: number): BooleanMatch<number>;
declare function atLeast(threshold: number): BooleanMatch<number>;
declare function exactly(count: number): ExactCardinality;
declare function count(inner: BooleanMatch<number>): CollectionMatch<readonly unknown[]>;
declare function matching(
  item: ToolMatch,
  cardinality: ExactCardinality | { readonly atLeast: number },
): CollectionMatch<ManagedToolCalls>;
declare function inOrder(
  matches: readonly [ToolMatch, ToolMatch, ...ToolMatch[]],
): CollectionMatch<ManagedToolCalls<"turn" | "session">>;
declare function toolMatch(name: string): ToolMatch;
declare function toolMatch(options: Record<string, never>): ToolMatch;

async function positiveAuthoringShapes(): Promise<void> {
  const refined = await pass.check(candidate, hasId)
    .key("candidate-id")
    .label("候选项有 id")
    .orStop();
  refined.id.toUpperCase();

  // Root、Session 与 Turn 都在调用时登记 scoped Assertion。
  await pass.succeeded().orStop();
  passSession.succeeded().label("Session 完成");
  passTurn.calledTool("write_file", { count: { atLeast: 1 } }).label("写入文件");
  pass.maxTokens(4_000).ifCovered().label("token 可读取");
  pass.maxCost(0.25).ifCovered().label("费用可读取");
  pass.maxToolCalls(0).label("零次上限");
  pass.usedNoTools().label("未使用工具");
  passTurn.notCalledTool("rm").label("未删除");
  passTurn.toolOrder([toolMatch("read"), toolMatch("write")]).label("先读后写");
  passSession.toolOrder([toolMatch("read"), toolMatch("write")]).label("会话顺序");

  pass.check(3, lessThan(4)).label("严格小于");
  pass.check(4, atMost(4)).label("不超过");
  pass.check(5, greaterThan(4)).label("严格大于");
  pass.check(4, atLeast(4)).label("至少");
  pass.check(-1, lessThan(0)).label("负数比较");

  pass.check(pass.toolCalls, count(atMost(2))).label("attempt 次数");
  passTurn.check(passTurn.toolCalls, count(atMost(2))).label("turn 次数");
  pass.check(passTurn.toolCalls, count(atMost(2))).label("cut 由 subject 携带");
  passTurn.check(passTurn.toolCalls, matching(toolMatch("read"), exactly(2))).label("恰好两次");
  passTurn.check(passTurn.toolCalls, matching(toolMatch("write"), exactly(0))).label("零次写");
  passTurn.check(passTurn.toolCalls, matching(toolMatch("search"), { atLeast: 1 })).label("至少一次");
  passTurn.check(
    passTurn.toolCalls,
    matching(toolMatch({}), exactly(0)),
  ).label("无任何工具");
  passTurn.check(
    passTurn.toolCalls,
    inOrder([toolMatch("read"), toolMatch("write")]),
  ).label("顺序");
  passSession.check(
    passSession.toolCalls,
    inOrder([toolMatch("read"), toolMatch("write")]),
  ).label("会话顺序");
  pass.check([1, 2, 3], count(atMost(2))).label("作者 array 计数");
  pass.check([...passTurn.toolCalls], count(atMost(2))).label("展开后仍可 count");

  const thresholded = pass.check(reply, quality).gate(0.8).label("最低质量");
  await thresholded.orStop();
  finalizePass(pass.succeeded(), thresholded);

  // Score Eval 可只记录，也可明确贡献 score；threshold 与 score 可以交换次序。
  scoreTurn.calledTool("search").label("仅记录");
  scoreTurn.calledTool("search").score(2).label("检索贡献");
  await score.check(reply, quality).score(5).atLeast(0.8).orStop();
  await score.check(reply, quality).atLeast(0.8).score(5).orStop();
  score.maxTokens(4_000).ifCovered().score(1);
  score.maxToolCalls(2).score(1);
  score.usedNoTools().score(1);
  score.check(score.toolCalls, count(atMost(2))).score(1);
  score.score(5).key("manual").label("人工贡献");
}
void positiveAuthoringShapes;

function negativeAuthoringShapes(): void {
  const passBoolean = pass.succeeded();
  const passMeasurement = pass.check(reply, quality);
  const direct = score.score(1);

  // @ts-expect-error t.check is strictly value plus Match.
  pass.check(reply);
  // @ts-expect-error t.check has no third parameter.
  pass.check(reply, quality, { label: "禁止第三参数" });
  // @ts-expect-error An AssertionHandle cannot become a new subject.
  pass.check(passBoolean, isTrue);

  // @ts-expect-error A Pass measurement must be gated before finalize.
  finalizePass(passMeasurement);
  // @ts-expect-error A Pass measurement without gate cannot stop control flow.
  passMeasurement.orStop();
  // @ts-expect-error Pass contexts have no direct score API.
  pass.score(1);
  // @ts-expect-error Pass measurement handles have no score policy.
  passMeasurement.score(1);

  // @ts-expect-error A direct score handle cannot be scored again.
  direct.score(1);
  // @ts-expect-error A direct score handle cannot receive a threshold.
  direct.atLeast(0.8);
  // @ts-expect-error A direct score handle cannot stop authoring.
  direct.orStop();

  // @ts-expect-error A Score measurement needs atLeast before orStop.
  score.check(reply, quality).orStop();
  // @ts-expect-error score policy can be configured only once.
  scoreTurn.calledTool("search").score(1).score(1);

  // Runtime checks, not literal types, reject zero and negative handle scores.
  scoreTurn.calledTool("search").score(0);
  scoreTurn.calledTool("search").score(-1);

  // @ts-expect-error Removed author APIs are not part of this model.
  pass.require(passBoolean);
  // @ts-expect-error Usage coverage lives on the Usage Assertion handle.
  pass.checkIfCovered(pass.maxTokens(100));
  // @ts-expect-error Old numeric APIs are absent.
  passBoolean.points(1);
  // @ts-expect-error Old numeric APIs are absent.
  passBoolean.weight(1);
  // @ts-expect-error Numeric Match candidates must be numbers.
  pass.check("4", atMost(4));
  // @ts-expect-error Usage facts are not exposed as public selectors.
  pass.tokens();
  // @ts-expect-error Usage facts are not exposed as public selectors.
  pass.cost();
  // @ts-expect-error There is no generic metric selector.
  pass.metric("tokens");
  // @ts-expect-error Control API is named orStop.
  passBoolean.stopOnFailure();
  // @ts-expect-error There is no toolCallCount selector.
  pass.toolCallCount();
  // @ts-expect-error There is no public Fact envelope on toolCalls.
  pass.toolCalls.value;
  // @ts-expect-error Root toolCalls cannot use inOrder.
  pass.check(pass.toolCalls, inOrder([toolMatch("read"), toolMatch("write")]));
  // @ts-expect-error Spread toolCalls is an ordinary array and cannot use matching.
  pass.check([...passTurn.toolCalls], matching(toolMatch("read"), exactly(1)));
  // @ts-expect-error Spread toolCalls cannot use inOrder.
  pass.check([...passTurn.toolCalls], inOrder([toolMatch("read"), toolMatch("write")]));
  // @ts-expect-error Root context has no toolOrder wrapper.
  pass.toolOrder([toolMatch("read"), toolMatch("write")]);
  // Runtime checks reject calledTool count 0; zero uses notCalledTool or matching(..., exactly(0)).
  passTurn.calledTool("read", { count: 0 });
}
void negativeAuthoringShapes;

declare const _kind: EvaluationKind;
void _kind;
