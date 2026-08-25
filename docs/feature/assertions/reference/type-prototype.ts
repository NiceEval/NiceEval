export {};

declare const assertionHandleBrand: unique symbol;
declare const measurementStateBrand: unique symbol;
declare const managedToolCallsBrand: unique symbol;
declare const managedEventOccurrencesBrand: unique symbol;
declare const toolMatchBrand: unique symbol;
declare const eventMatchBrand: unique symbol;
declare const occurrenceMatchBrand: unique symbol;

type EvaluationKind = "pass" | "score";
type ScopeKind = "turn" | "session" | "attempt";

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

interface PassMeasurementHandle extends AssertionHandleBase {
  readonly kind: "pass-measurement";
}

interface PassThresholdedMeasurementHandle extends AssertionHandleBase {
  readonly kind: "pass-thresholded-measurement";
  gate(): this;
  orStop(): Promise<number>;
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
  score(
    this: ScoreMeasurementHandle<Thresholded, false>,
    value: number,
  ): ScoreMeasurementHandle<Thresholded, true>;
  orStop(this: ScoreMeasurementHandle<true, HasScore>): Promise<number>;
}

interface DirectScoreHandle extends AssertionHandleBase {
  readonly kind: "direct-score";
}

interface BooleanMatch<in T, out R extends T = T> {
  readonly kind: "boolean-match";
  readonly refine: (value: T) => R;
}

interface NumericComparisonMatch extends BooleanMatch<number> {
  readonly numericComparison: true;
}

interface CollectionMatch<in T> {
  readonly kind: "collection-match";
  readonly collectionInput: (value: T) => void;
}

interface ScoreMatch<in T> {
  readonly kind: "score-match";
  readonly evaluate: (value: T) => number | Promise<number>;
  atLeast(threshold: number): ThresholdedScoreMatch<T>;
}

interface ThresholdedScoreMatch<in T> {
  readonly kind: "thresholded-score-match";
  readonly evaluate: (value: T) => number | Promise<number>;
}

type Subject<T> = T extends AssertionHandleBase ? never : T;
type NumericSubject<T> = T extends ManagedEventOccurrences ? never : Subject<T>;

type ToolStatus = "pending" | "completed" | "failed" | "rejected";
type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

interface ToolOccurrenceView {
  readonly name: string;
  readonly input?: unknown;
  readonly output?: unknown;
  readonly status?: ToolStatus;
}

interface EventToolView {
  readonly name: string;
}

type EventOccurrenceView =
  | {
      readonly type: "message";
      readonly role: "assistant" | "user";
      readonly text: string;
    }
  | {
      readonly type: "operation.started";
      readonly tool: EventToolView;
    }
  | {
      readonly type: "operation.finished";
      readonly tool: EventToolView;
      readonly status: "completed" | "failed" | "rejected";
    };

type StreamEvent =
  | {
      readonly type: "message";
      readonly role: "assistant" | "user";
      readonly text: string;
    }
  | {
      readonly type: "operation.started";
      readonly operationId: string;
      readonly operation: {
        readonly kind: "tool";
        readonly name: string;
        readonly input: JsonValue;
      };
    }
  | {
      readonly type: "operation.finished";
      readonly operationId: string;
      readonly kind: "tool";
      readonly output?: JsonValue;
      readonly status: "completed" | "failed" | "rejected";
    }
  | { readonly type: "thinking"; readonly text: string };

interface ToolMatchOptions {
  readonly input?: BooleanMatch<JsonValue>;
  readonly output?: BooleanMatch<JsonValue>;
  readonly status?: ToolStatus;
}

interface CommandMatchOptions {
  readonly argsStart?: readonly string[];
  readonly excludes?: readonly string[];
  readonly status?: ToolStatus;
}

interface MessageEventMatchOptions {
  readonly role?: "assistant" | "user";
  readonly text?: BooleanMatch<string>;
}

interface ToolEventMatchOptions {
  readonly tool?: ToolMatch;
}

interface ManagedToolCalls<out S extends ScopeKind = ScopeKind>
  extends ReadonlyArray<ToolOccurrenceView> {
  readonly [managedToolCallsBrand]: S;
}

interface ManagedEventOccurrences<out S extends ScopeKind = ScopeKind>
  extends ReadonlyArray<EventOccurrenceView> {
  readonly [managedEventOccurrencesBrand]: S;
}

interface ToolOccurrenceMatch extends CollectionMatch<ManagedToolCalls> {
  readonly [occurrenceMatchBrand]: "tool-positive";
}

interface ToolUpperBoundOccurrenceMatch extends CollectionMatch<ManagedToolCalls> {
  readonly [occurrenceMatchBrand]: "tool-upper-bound";
}

interface ToolSequenceMatch extends CollectionMatch<ManagedToolCalls<"turn" | "session">> {
  readonly [occurrenceMatchBrand]: "tool-sequence";
}

interface EventOccurrenceMatch extends CollectionMatch<ManagedEventOccurrences> {
  readonly [occurrenceMatchBrand]: "event-positive";
}

interface EventUpperBoundOccurrenceMatch extends CollectionMatch<ManagedEventOccurrences> {
  readonly [occurrenceMatchBrand]: "event-upper-bound";
}

interface EventSequenceMatch extends CollectionMatch<ManagedEventOccurrences<"turn" | "session">> {
  readonly [occurrenceMatchBrand]: "event-sequence";
}

type ToolMatch = BooleanMatch<ToolOccurrenceView> & {
  readonly [toolMatchBrand]: true;
  atLeast(count: number): ToolOccurrenceMatch;
  lessThan(count: number): ToolUpperBoundOccurrenceMatch;
  atMost(count: number): ToolUpperBoundOccurrenceMatch;
  greaterThan(count: number): ToolOccurrenceMatch;
  exactly(count: number): ToolOccurrenceMatch;
};

type EventMatch = BooleanMatch<EventOccurrenceView> & {
  readonly [eventMatchBrand]: true;
  atLeast(count: number): EventOccurrenceMatch;
  lessThan(count: number): EventUpperBoundOccurrenceMatch;
  atMost(count: number): EventUpperBoundOccurrenceMatch;
  greaterThan(count: number): EventOccurrenceMatch;
  exactly(count: number): EventOccurrenceMatch;
};

interface PassScope {
  check<V extends number | readonly unknown[]>(
    value: NumericSubject<V>,
    match: NumericComparisonMatch,
  ): PassBooleanHandle<V>;
  check<S extends ScopeKind>(
    value: ManagedToolCalls<S>,
    match: ToolMatch,
  ): PassBooleanHandle<ManagedToolCalls<S>>;
  check<S extends ScopeKind>(
    value: ManagedEventOccurrences<S>,
    match: EventMatch,
  ): PassBooleanHandle<ManagedEventOccurrences<S>>;
  check<V, R extends V>(
    value: Subject<V>,
    match: BooleanMatch<NoInfer<V>, R>,
  ): PassBooleanHandle<R>;
  check<V>(
    value: Subject<V>,
    match: CollectionMatch<NoInfer<V>>,
  ): PassBooleanHandle<V>;
  check<V>(
    value: Subject<V>,
    match: ThresholdedScoreMatch<NoInfer<V>>,
  ): PassThresholdedMeasurementHandle;
  check<V>(
    value: Subject<V>,
    match: ScoreMatch<NoInfer<V>>,
  ): PassMeasurementHandle;
  succeeded(): PassBooleanHandle<void>;
  calledTool(name: string): PassBooleanHandle<void>;
  calledTool(match: ToolMatch | ToolOccurrenceMatch): PassBooleanHandle<void>;
  notCalledTool(name: string): PassBooleanHandle<void>;
  notCalledTool(match: ToolMatch): PassBooleanHandle<void>;
  event(match: EventMatch | EventOccurrenceMatch): PassBooleanHandle<void>;
  notEvent(match: EventMatch): PassBooleanHandle<void>;
  usedNoTools(): PassBooleanHandle<void>;
  maxToolCalls(maximum: number): PassBooleanHandle<void>;
  maxTokens(maximum: number): PassUsageHandle<void>;
  maxCost(maximumUSD: number): PassUsageHandle<void>;
}

interface ScoreScope {
  check<V extends number | readonly unknown[]>(
    value: NumericSubject<V>,
    match: NumericComparisonMatch,
  ): ScoreBooleanHandle<V>;
  check<S extends ScopeKind>(
    value: ManagedToolCalls<S>,
    match: ToolMatch,
  ): ScoreBooleanHandle<ManagedToolCalls<S>>;
  check<S extends ScopeKind>(
    value: ManagedEventOccurrences<S>,
    match: EventMatch,
  ): ScoreBooleanHandle<ManagedEventOccurrences<S>>;
  check<V, R extends V>(
    value: Subject<V>,
    match: BooleanMatch<NoInfer<V>, R>,
  ): ScoreBooleanHandle<R>;
  check<V>(
    value: Subject<V>,
    match: CollectionMatch<NoInfer<V>>,
  ): ScoreBooleanHandle<V>;
  check<V>(
    value: Subject<V>,
    match: ThresholdedScoreMatch<NoInfer<V>>,
  ): ScoreMeasurementHandle<true>;
  check<V>(
    value: Subject<V>,
    match: ScoreMatch<NoInfer<V>>,
  ): ScoreMeasurementHandle;
  succeeded(): ScoreBooleanHandle<void>;
  calledTool(name: string): ScoreBooleanHandle<void>;
  calledTool(match: ToolMatch | ToolOccurrenceMatch): ScoreBooleanHandle<void>;
  notCalledTool(name: string): ScoreBooleanHandle<void>;
  notCalledTool(match: ToolMatch): ScoreBooleanHandle<void>;
  event(match: EventMatch | EventOccurrenceMatch): ScoreBooleanHandle<void>;
  notEvent(match: EventMatch): ScoreBooleanHandle<void>;
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

interface PassTurn extends PassScope {
  readonly input: string;
  readonly message: string;
  readonly events: readonly StreamEvent[];
  readonly toolCalls: ManagedToolCalls<"turn">;
  readonly eventOccurrences: ManagedEventOccurrences<"turn">;
  toolOrder(matches: readonly [ToolMatch, ToolMatch, ...ToolMatch[]]): PassBooleanHandle<void>;
  eventOrder(matches: readonly [EventMatch, EventMatch, ...EventMatch[]]): PassBooleanHandle<void>;
}

interface ScoreTurn extends ScoreScope {
  readonly input: string;
  readonly message: string;
  readonly events: readonly StreamEvent[];
  readonly toolCalls: ManagedToolCalls<"turn">;
  readonly eventOccurrences: ManagedEventOccurrences<"turn">;
  toolOrder(matches: readonly [ToolMatch, ToolMatch, ...ToolMatch[]]): ScoreBooleanHandle<void>;
  eventOrder(matches: readonly [EventMatch, EventMatch, ...EventMatch[]]): ScoreBooleanHandle<void>;
}

interface PassSession extends PassScope {
  send(input: string): Promise<PassTurn>;
  readonly events: readonly StreamEvent[];
  readonly toolCalls: ManagedToolCalls<"session">;
  readonly eventOccurrences: ManagedEventOccurrences<"session">;
  toolOrder(matches: readonly [ToolMatch, ToolMatch, ...ToolMatch[]]): PassBooleanHandle<void>;
  eventOrder(matches: readonly [EventMatch, EventMatch, ...EventMatch[]]): PassBooleanHandle<void>;
}

interface ScoreSession extends ScoreScope {
  send(input: string): Promise<ScoreTurn>;
  readonly events: readonly StreamEvent[];
  readonly toolCalls: ManagedToolCalls<"session">;
  readonly eventOccurrences: ManagedEventOccurrences<"session">;
  toolOrder(matches: readonly [ToolMatch, ToolMatch, ...ToolMatch[]]): ScoreBooleanHandle<void>;
  eventOrder(matches: readonly [EventMatch, EventMatch, ...EventMatch[]]): ScoreBooleanHandle<void>;
}

interface PassTestContext extends PassScope {
  readonly evaluationKind: "pass";
  readonly events: readonly StreamEvent[];
  readonly toolCalls: ManagedToolCalls<"attempt">;
  readonly eventOccurrences: ManagedEventOccurrences<"attempt">;
  newSession(): PassSession;
  send(input: string): Promise<PassTurn>;
}

interface ScoreTestContext extends ScoreScope {
  readonly evaluationKind: "score";
  readonly events: readonly StreamEvent[];
  readonly toolCalls: ManagedToolCalls<"attempt">;
  readonly eventOccurrences: ManagedEventOccurrences<"attempt">;
  newSession(): ScoreSession;
  send(input: string): Promise<ScoreTurn>;
  score(value: number): DirectScoreHandle;
}

interface JudgeMaterial {
  readonly input: string;
  readonly output: string;
}

declare const pass: PassTestContext;
declare const passSession: PassSession;
declare const passTurn: PassTurn;
declare const score: ScoreTestContext;
declare const scoreTurn: ScoreTurn;
declare const candidate: unknown;
declare const reply: string;
declare const hasId: BooleanMatch<unknown, { readonly id: string }>;
declare const isTrue: BooleanMatch<boolean, true>;
declare const eventsAreValid: BooleanMatch<readonly StreamEvent[]>;
declare const quality: ScoreMatch<string>;

declare function lessThan(threshold: number): NumericComparisonMatch;
declare function atMost(threshold: number): NumericComparisonMatch;
declare function greaterThan(threshold: number): NumericComparisonMatch;
declare function atLeast(threshold: number): NumericComparisonMatch;
declare function inOrder(
  matches: readonly [ToolMatch, ToolMatch, ...ToolMatch[]],
): ToolSequenceMatch;
declare function inOrder(
  matches: readonly [EventMatch, EventMatch, ...EventMatch[]],
): EventSequenceMatch;
declare function toolMatch(name: string, options?: ToolMatchOptions): ToolMatch;
declare function toolMatch(options: ToolMatchOptions): ToolMatch;
declare function commandMatch(executable: string, options?: CommandMatchOptions): ToolMatch;
declare function eventMatch(type: "message", options?: MessageEventMatchOptions): EventMatch;
declare function eventMatch(
  type: "operation.started" | "operation.finished",
  options?: ToolEventMatchOptions,
): EventMatch;
declare function and(first: ToolMatch, ...rest: readonly ToolMatch[]): ToolMatch;
declare function and(first: EventMatch, ...rest: readonly EventMatch[]): EventMatch;
declare function or(first: ToolMatch, ...rest: readonly ToolMatch[]): ToolMatch;
declare function or(first: EventMatch, ...rest: readonly EventMatch[]): EventMatch;
declare function closedQA(question: string): ScoreMatch<JudgeMaterial>;
declare function factuality(expected: string): ScoreMatch<JudgeMaterial>;
declare function summarizes(source: string): ScoreMatch<JudgeMaterial>;

async function positiveAuthoringShapes(): Promise<void> {
  const refined = await pass.check(candidate, hasId)
    .key("candidate-id")
    .label("候选项有 id")
    .orStop();
  refined.id.toUpperCase();

  // Root、Session 与 Turn 都在调用时登记 scoped Assertion。
  await pass.succeeded().orStop();
  passSession.succeeded().label("Session 完成");
  passTurn.calledTool("write_file").label("写入文件");
  passTurn.calledTool(toolMatch("search").atLeast(2)).label("至少搜索两次");
  passTurn.calledTool(toolMatch("read").exactly(2)).label("恰好读取两次");
  passTurn.calledTool(toolMatch("search").greaterThan(0)).label("搜索多于零次");
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

  pass.check(pass.toolCalls, atMost(2)).label("attempt 次数");
  passTurn.check(passTurn.toolCalls, atMost(2)).label("turn 次数");
  pass.check(passTurn.toolCalls, atMost(2)).label("cut 由 subject 携带");
  passTurn.check(passTurn.toolCalls, toolMatch("read").exactly(2)).label("恰好两次");
  passTurn.check(passTurn.toolCalls, toolMatch("write").exactly(0)).label("显式零次写");
  passTurn.check(passTurn.toolCalls, toolMatch("search")).label("至少一次");
  passTurn.check(passTurn.toolCalls, toolMatch("search").atLeast(2)).label("至少两次");
  passTurn.check(passTurn.toolCalls, toolMatch("search").lessThan(3)).label("少于三次");
  passTurn.check(passTurn.toolCalls, toolMatch("search").atMost(2)).label("至多两次");
  passTurn.check(passTurn.toolCalls, toolMatch("search").greaterThan(0)).label("多于零次");
  passTurn.check(
    passTurn.toolCalls,
    commandMatch("pnpm", { argsStart: ["test"] }).atMost(1),
  ).label("至多一次测试命令");
  passTurn.check(
    passTurn.toolCalls,
    and(commandMatch("pnpm"), toolMatch({ status: "completed" })).exactly(1),
  ).label("完成一条 pnpm 命令");
  passTurn.check(
    passTurn.toolCalls,
    or(toolMatch("read"), toolMatch("search")).atLeast(1),
  ).label("组合后至少一次");
  passTurn.check(passTurn.toolCalls, toolMatch({}).exactly(0)).label("无任何工具");
  passTurn.check(
    passTurn.toolCalls,
    inOrder([toolMatch("read"), toolMatch("write")]),
  ).label("顺序");
  passSession.check(
    passSession.toolCalls,
    inOrder([toolMatch("read"), toolMatch("write")]),
  ).label("会话顺序");
  pass.check([1, 2, 3], atMost(2)).label("作者 array 计数");
  pass.check([...passTurn.toolCalls], atMost(2)).label("展开后仍可比较 cardinality");

  // 原始 events 是普通 Value subject；eventOccurrences 是独立 managed subject。
  passTurn.check(passTurn.events, eventsAreValid).label("原始事件值");
  passTurn.check(passTurn.eventOccurrences, eventMatch("message")).label("出现消息");
  passTurn.check(
    passTurn.eventOccurrences,
    eventMatch("operation.started").atLeast(2),
  ).label("至少开始两次工具操作");
  passTurn.check(
    passTurn.eventOccurrences,
    eventMatch("operation.finished").atMost(3),
  ).label("至多完成三次工具操作");
  passTurn.check(
    passTurn.eventOccurrences,
    inOrder([eventMatch("operation.started"), eventMatch("operation.finished")]),
  ).label("工具事件顺序");
  passTurn.event(eventMatch("message")).label("出现消息包装");
  passTurn.event(eventMatch("message").exactly(2)).label("恰好两条消息");
  passTurn.notEvent(eventMatch("operation.finished", { tool: toolMatch("rm") }));
  passTurn.eventOrder([
    eventMatch("operation.started"),
    eventMatch("operation.finished"),
  ]).label("事件顺序包装");

  // Threshold 是登记前 Match 形状；handle 只配置 policy。
  pass.check(reply, quality).label("只记录 measurement");
  const thresholded = pass.check(reply, quality.atLeast(0.8))
    .gate()
    .label("最低质量");
  await thresholded.orStop();

  const material = { input: passTurn.input, output: passTurn.message };
  await passTurn.check(material, closedQA("回答是否可执行？").atLeast(0.8))
    .gate()
    .label("可执行性")
    .orStop();
  pass.check(material, factuality("目标事实")).label("只记录事实性");
  pass.check(material, summarizes("原始材料")).label("只记录摘要质量");

  // Score Eval 可只记录或贡献 score；未 threshold 的 ScoreMatch 仍可计分。
  scoreTurn.calledTool("search").label("仅记录");
  scoreTurn.calledTool(toolMatch("search").atLeast(2)).score(2).label("检索贡献");
  score.check(reply, quality).score(5);
  await score.check(reply, quality.atLeast(0.8)).score(5).orStop();
  score.maxTokens(4_000).ifCovered().score(1);
  score.maxToolCalls(2).score(1);
  score.usedNoTools().score(1);
  score.check(score.toolCalls, atMost(2)).score(1);
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

  // @ts-expect-error An unthresholded Pass measurement has no gate policy.
  passMeasurement.gate();
  // @ts-expect-error An unthresholded Pass measurement cannot stop control flow.
  passMeasurement.orStop();
  // @ts-expect-error Pass contexts have no direct score API.
  pass.score(1);
  // @ts-expect-error Pass measurement handles have no score policy.
  passMeasurement.score(1);

  // @ts-expect-error A direct score handle cannot be scored again.
  direct.score(1);
  // @ts-expect-error A direct score handle cannot stop authoring.
  direct.orStop();

  // @ts-expect-error An unthresholded Score measurement cannot stop control flow.
  score.check(reply, quality).orStop();
  // @ts-expect-error score policy can be configured only once.
  scoreTurn.calledTool("search").score(1).score(1);

  // Runtime checks, not literal types, reject invalid handle scores.
  scoreTurn.calledTool("search").score(0);
  scoreTurn.calledTool("search").score(-1);

  // @ts-expect-error Numeric Match candidates must be numbers or ordinary/tool collections.
  pass.check("4", atMost(4));
  // @ts-expect-error Managed event occurrences do not expose numeric cardinality.
  passTurn.check(passTurn.eventOccurrences, atMost(4));
  // @ts-expect-error Root toolCalls cannot use sequence Match.
  pass.check(pass.toolCalls, inOrder([toolMatch("read"), toolMatch("write")]));
  // @ts-expect-error Root eventOccurrences cannot use sequence Match.
  pass.check(pass.eventOccurrences, inOrder([eventMatch("operation.started"), eventMatch("operation.finished")]));
  // @ts-expect-error Spread toolCalls is an ordinary array and cannot use occurrence Match.
  pass.check([...passTurn.toolCalls], toolMatch("read").exactly(1));
  // @ts-expect-error Spread eventOccurrences cannot use occurrence Match.
  pass.check([...passTurn.eventOccurrences], eventMatch("message").exactly(1));
  // @ts-expect-error Spread toolCalls cannot use sequence Match.
  pass.check([...passTurn.toolCalls], inOrder([toolMatch("read"), toolMatch("write")]));
  // @ts-expect-error Quantified occurrence Match cannot be an inOrder step.
  inOrder([toolMatch("read").atLeast(1), toolMatch("write")]);
  // @ts-expect-error Quantified occurrence Match cannot be an and operand.
  and(toolMatch("read").atLeast(1), toolMatch("write"));
  // @ts-expect-error Quantified event Match cannot be an or operand.
  or(eventMatch("message"), eventMatch("operation.finished").atMost(1));
  // @ts-expect-error Root context has no toolOrder wrapper.
  pass.toolOrder([toolMatch("read"), toolMatch("write")]);
  // @ts-expect-error Root context has no eventOrder wrapper.
  pass.eventOrder([eventMatch("operation.started"), eventMatch("operation.finished")]);

  // @ts-expect-error calledTool accepts no upper-bound occurrence Match.
  passTurn.calledTool(toolMatch("read").atMost(1));
  // @ts-expect-error calledTool accepts no sequence Match.
  passTurn.calledTool(inOrder([toolMatch("read"), toolMatch("write")]));
  // @ts-expect-error notCalledTool selects exactly(0) from a bare ToolMatch.
  passTurn.notCalledTool(toolMatch("read").exactly(0));
  // @ts-expect-error event accepts no upper-bound occurrence Match.
  passTurn.event(eventMatch("message").lessThan(2));
  // @ts-expect-error event accepts no sequence Match.
  passTurn.event(inOrder([eventMatch("operation.started"), eventMatch("operation.finished")]));
  // @ts-expect-error notEvent selects exactly(0) from a bare EventMatch.
  passTurn.notEvent(eventMatch("message").exactly(0));
  // @ts-expect-error eventOrder accepts only bare EventMatch steps.
  passTurn.eventOrder([eventMatch("message").atLeast(1), eventMatch("operation.finished")]);

  // Runtime checks reject exactly(0) and atLeast(0) in positive wrappers.
  // Explicit check(..., match.exactly(0)) remains valid; greaterThan(0) is valid in a wrapper.
}
void negativeAuthoringShapes;

declare const _kind: EvaluationKind;
void _kind;
