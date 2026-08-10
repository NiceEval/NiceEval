import type { StandardSchemaV1 } from "@standard-schema/spec";

export {};

type MatchDomain = "value" | "tool" | "event";
declare const matchInputBrand: unique symbol;
declare const matchRefinementBrand: unique symbol;
declare const thresholdedScoreMatchBrand: unique symbol;

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
  atLeast(threshold: number): ThresholdedScoreMatch<T>;
}

interface ThresholdedScoreMatch<in T> {
  readonly kind: "thresholded-score-match";
  readonly [thresholdedScoreMatchBrand]: (candidate: T) => void;
}

interface LogicalToolOccurrence {
  readonly id: ToolOccurrenceIdentity;
}

interface LogicalCommandOccurrence extends LogicalToolOccurrence {
  readonly command: readonly string[];
}

declare const eventIdentityBrand: unique symbol;
declare const eventPositionBrand: unique symbol;
declare const toolOccurrenceIdentityBrand: unique symbol;

type AssertionEventIdentity = string & { readonly [eventIdentityBrand]: true };
type ToolOccurrenceIdentity = string & { readonly [toolOccurrenceIdentityBrand]: true };

interface EventPosition {
  readonly turnOrdinal: number;
  readonly eventOrdinal: number;
  readonly [eventPositionBrand]: true;
}

interface AssertionToolReference {
  readonly id: ToolOccurrenceIdentity;
  readonly name: string;
}

type AssertionEvent =
  | {
      readonly id: AssertionEventIdentity;
      readonly position: EventPosition;
      readonly type: "message";
      readonly role: "assistant" | "user";
      readonly text: string;
    }
  | {
      readonly id: AssertionEventIdentity;
      readonly position: EventPosition;
      readonly type: "operation.started";
      readonly tool: AssertionToolReference;
    }
  | {
      readonly id: AssertionEventIdentity;
      readonly position: EventPosition;
      readonly type: "operation.finished";
      readonly tool: AssertionToolReference;
      readonly status: "completed" | "failed" | "rejected";
    };

type MatchableEvent = AssertionEvent;

type ToolMatch<R extends LogicalToolOccurrence = LogicalToolOccurrence> = BooleanMatch<
  LogicalToolOccurrence,
  R,
  "tool"
>;
type EventMatch<R extends MatchableEvent = MatchableEvent> = BooleanMatch<MatchableEvent, R, "event">;

declare function toolMatch(name: string): ToolMatch;

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

type FactPhase = "now" | "final";
declare const factBrand: unique symbol;
declare const evidenceSourceBrand: unique symbol;
declare const usageCoverageBrand: unique symbol;
declare const thresholdedScoreFactBrand: unique symbol;

interface BooleanFact<out R = unknown, P extends FactPhase = FactPhase> {
  readonly kind: "boolean";
  readonly phase: P;
  readonly [factBrand]: () => R;
}

interface ScoreFact<P extends FactPhase = FactPhase> {
  readonly kind: "score";
  readonly phase: P;
  readonly [factBrand]: () => number;
  atLeast<F extends ScoreFact<P>>(this: F, threshold: number): ThresholdedScoreFact<F>;
}

interface ThresholdedScoreFact<out F extends ScoreFact<FactPhase>> {
  readonly kind: "thresholded-score-fact";
  readonly [thresholdedScoreFactBrand]: () => F;
}

interface UsageEvidenceFact<P extends FactPhase = FactPhase> extends BooleanFact<unknown, P> {
  readonly [usageCoverageBrand]: true;
}

interface EvidenceSource<out V, P extends FactPhase = FactPhase> {
  readonly phase: P;
  readonly [evidenceSourceBrand]: () => V;
}

type AuthoringBoundary =
  | { readonly [factBrand]: unknown }
  | { readonly [evidenceSourceBrand]: unknown }
  | { readonly [matchInputBrand]: unknown }
  | { readonly [thresholdedScoreMatchBrand]: unknown }
  | { readonly [thresholdedScoreFactBrand]: unknown };

/**
 * A value-side consumer must not accidentally reinterpret an owned Fact, an
 * evidence source, or a Match for raw-subject input. Generic callers can still
 * widen intentionally, so runtime dispatch keeps the same boundary.
 */
type AuthorValue<T> = [Extract<T, AuthoringBoundary>] extends [never] ? T : never;

interface FactUseOptions {
  readonly key?: string;
  readonly label?: string;
}

interface ScoreUseOptions extends FactUseOptions {
  readonly max: number;
}

interface DirectScoreOptions {
  readonly key?: string;
  readonly earned: number;
}

interface TestContext {
  check<F extends BooleanFact<unknown, FactPhase>>(fact: F, options?: FactUseOptions): F;
  check<F extends ScoreFact<FactPhase>>(fact: ThresholdedScoreFact<F>, options?: FactUseOptions): F;

  check<V, P extends FactPhase, R extends V>(
    source: EvidenceSource<V, P>,
    match: BooleanMatch<NoInfer<V>, R, "value">,
    options?: FactUseOptions,
  ): BooleanFact<R, P>;
  check<V, P extends FactPhase>(
    source: EvidenceSource<V, P>,
    match: ThresholdedScoreMatch<NoInfer<V>>,
    options?: FactUseOptions,
  ): ScoreFact<P>;

  check<V, R extends V>(
    value: V & AuthorValue<V>,
    match: BooleanMatch<NoInfer<V>, R, "value">,
    options?: FactUseOptions,
  ): BooleanFact<R, "now">;
  check<V>(
    value: V & AuthorValue<V>,
    match: ThresholdedScoreMatch<NoInfer<V>>,
    options?: FactUseOptions,
  ): ScoreFact<"now">;

  checkIfCovered<P extends FactPhase>(
    fact: UsageEvidenceFact<P>,
    options?: FactUseOptions,
  ): UsageEvidenceFact<P>;

  require<R>(fact: BooleanFact<R, "now">, options?: FactUseOptions): Promise<R>;
  require<F extends ScoreFact<"now">>(
    fact: ThresholdedScoreFact<F>,
    options?: FactUseOptions,
  ): Promise<number>;
  require<V, R extends V>(
    value: V & AuthorValue<V>,
    match: BooleanMatch<NoInfer<V>, R, "value">,
    options?: FactUseOptions,
  ): Promise<R>;
  require<V>(
    value: V & AuthorValue<V>,
    match: ThresholdedScoreMatch<NoInfer<V>>,
    options?: FactUseOptions,
  ): Promise<number>;
}

/** Score contexts retain every TestContext helper through interface extension. */
interface ScoreTestContext extends TestContext {
  score<F extends BooleanFact<unknown, FactPhase>>(
    label: string,
    fact: F,
    options: ScoreUseOptions,
  ): F;
  score<F extends ScoreFact<FactPhase>>(label: string, fact: F, options: ScoreUseOptions): F;

  score<V, P extends FactPhase, R extends V>(
    label: string,
    source: EvidenceSource<V, P>,
    match: BooleanMatch<NoInfer<V>, R, "value">,
    options: ScoreUseOptions,
  ): BooleanFact<R, P>;
  score<V, P extends FactPhase>(
    label: string,
    source: EvidenceSource<V, P>,
    match: ScoreMatch<NoInfer<V>>,
    options: ScoreUseOptions,
  ): ScoreFact<P>;

  score<V, R extends V>(
    label: string,
    value: V & AuthorValue<V>,
    match: BooleanMatch<NoInfer<V>, R, "value">,
    options: ScoreUseOptions,
  ): BooleanFact<R, "now">;
  score<V>(
    label: string,
    value: V & AuthorValue<V>,
    match: ScoreMatch<NoInfer<V>>,
    options: ScoreUseOptions,
  ): ScoreFact<"now">;

  score(label: string, direct: DirectScoreOptions): void;
}

interface AggregateAssertionScope {
  calledTool(
    match: ToolMatch,
    options?: { readonly count?: number },
  ): BooleanFact<LogicalToolOccurrence, "now">;
  notCalledTool(match: ToolMatch): BooleanFact<void, "now">;
  event(
    match: EventMatch,
    options?: { readonly count?: number },
  ): BooleanFact<AssertionEvent, "now">;
  notEvent(match: EventMatch): BooleanFact<void, "now">;
}

interface OrderedAssertionScope extends AggregateAssertionScope {
  toolOrder(matches: readonly [ToolMatch, ToolMatch, ...ToolMatch[]]): BooleanFact<void, "now">;
  eventOrder(matches: readonly [EventMatch, EventMatch, ...EventMatch[]]): BooleanFact<void, "now">;
  eventsSatisfy(
    label: string,
    predicate: (events: readonly AssertionEvent[]) => boolean | Promise<boolean>,
  ): BooleanFact<void, "now">;
}

interface Sandbox {
  fileChanged(path: string): BooleanFact<unknown, "final">;
  readText(path: string): EvidenceSource<string, "final">;
}

interface JudgeRecipes {
  closedQA(question: string): ScoreFact<"now">;
}

type HasId = { readonly id: string };
type HasTitle = { readonly title: string };
declare const nonEmptyTextBrand: unique symbol;
type NonEmptyText = string & { readonly [nonEmptyTextBrand]: true };

type CustomBooleanMatchSpec<T, R extends AuthorValue<T>> = [AuthorValue<T>] extends [never]
  ? never
  : {
      readonly name: string;
      readonly evaluate: (value: AuthorValue<T>) => value is R;
    };

type CustomScoreMatchSpec<T> = [AuthorValue<T>] extends [never]
  ? never
  : {
      readonly name: string;
      readonly score: (value: AuthorValue<T>) => number | Promise<number>;
    };

declare function defineValueMatch<T, R extends AuthorValue<T> = AuthorValue<T>>(
  spec: CustomBooleanMatchSpec<T, R>,
): BooleanMatch<AuthorValue<T>, R, "value">;

declare function defineScoreMatch<T>(spec: CustomScoreMatchSpec<T>): ScoreMatch<AuthorValue<T>>;

declare const plainT: TestContext;
declare const scoreT: ScoreTestContext;
declare const rootScope: AggregateAssertionScope;
declare const scope: OrderedAssertionScope;
declare const sandbox: Sandbox;
declare const judge: JudgeRecipes;
declare const candidate: unknown;
declare const responseText: string;
declare const transformingSchema: StandardSchemaV1<string, number>;
declare const usageFact: UsageEvidenceFact<"final">;
declare const finalBooleanFact: BooleanFact<HasId, "final">;
declare const finalScoreFact: ScoreFact<"final">;
declare const nowBooleanFact: BooleanFact<HasId, "now">;
declare const nowScoreFact: ScoreFact<"now">;
declare const command: ToolMatch<LogicalCommandOccurrence>;
declare const event: EventMatch;
declare const factAsValueMatch: BooleanMatch<BooleanFact<HasId, "now">, BooleanFact<HasId, "now">>;
declare const sourceAsValueMatch: BooleanMatch<
  EvidenceSource<string, "final">,
  EvidenceSource<string, "final">
>;
declare const matchAsValueMatch: BooleanMatch<
  BooleanMatch<string, string>,
  BooleanMatch<string, string>
>;

const hasId = defineValueMatch<unknown, HasId>({
  name: "has id",
  evaluate(value: unknown): value is HasId {
    return typeof value === "object" && value !== null && "id" in value;
  },
});

const hasTitle = defineValueMatch<unknown, HasTitle>({
  name: "has title",
  evaluate(value: unknown): value is HasTitle {
    return typeof value === "object" && value !== null && "title" in value;
  },
});

const isNonEmptyText = defineValueMatch<string, NonEmptyText>({
  name: "non-empty text",
  evaluate(value: string): value is NonEmptyText {
    return value.length > 0;
  },
});

const responseQuality = defineScoreMatch<string>({
  name: "response quality",
  score(value: string) {
    return value.length / 100;
  },
});

function sharedVerdictHelper(
  context: TestContext,
  fact: BooleanFact<LogicalToolOccurrence, "now">,
): BooleanFact<LogicalToolOccurrence, "now"> {
  return context.check(fact, { key: "shared-tool-check" });
}

async function authoringExercise(): Promise<void> {
  // Scope producers create Facts; each explicit consumer declares its role.
  const verdictOnlyTool = scope.calledTool(toolMatch("git"));
  const checkedTool: BooleanFact<LogicalToolOccurrence, "now"> = scoreT.check(verdictOnlyTool, {
    key: "git-called",
  });
  void checkedTool;

  const scoreOnlyTool = scope.calledTool(toolMatch("rg"));
  const scoredTool: BooleanFact<LogicalToolOccurrence, "now"> = scoreT.score(
    "搜索工具",
    scoreOnlyTool,
    { key: "rg-tool", max: 1 },
  );
  void scoredTool;

  const dualUseTool = scope.calledTool(toolMatch("pnpm"));
  scoreT.check(dualUseTool, { key: "pnpm-required" });
  scoreT.score("包管理工具", dualUseTool, { key: "pnpm-quality", max: 2 });

  // Ordinary values create now Facts and preserve BooleanMatch refinements.
  const ordinaryBoolean: BooleanFact<NonEmptyText, "now"> = scoreT.check(
    responseText,
    isNonEmptyText,
    { key: "ordinary-text" },
  );
  void ordinaryBoolean;
  const ordinaryBooleanScore: BooleanFact<NonEmptyText, "now"> = scoreT.score(
    "非空回答",
    responseText,
    isNonEmptyText,
    { key: "ordinary-text-score", max: 1 },
  );
  void ordinaryBooleanScore;

  // ScoreMatch supports a verdict, immediate dependency, score-only, and both uses.
  const verdictScore: ScoreFact<"now"> = scoreT.check(responseText, responseQuality.atLeast(0.8), {
    key: "response-threshold",
  });
  void verdictScore;
  const normalized: number = await scoreT.require(
    responseText,
    responseQuality.atLeast(0.9),
    { key: "response-required" },
  );
  void normalized;
  const scoreOnly: ScoreFact<"now"> = scoreT.score("回答质量", responseText, responseQuality, {
    key: "response-score-only",
    max: 10,
  });
  void scoreOnly;
  const scoreAndVerdict = scoreT.check(responseText, responseQuality.atLeast(0.7), {
    key: "response-dual-verdict",
  });
  scoreT.score("回答质量门槛", scoreAndVerdict, { key: "response-dual-score", max: 4 });

  // Evidence sources use their dedicated overload and retain their final phase.
  const finalReadme = sandbox.readText("README.md");
  const finalSourceCheck: BooleanFact<NonEmptyText, "final"> = scoreT.check(
    finalReadme,
    isNonEmptyText,
    { key: "readme-present" },
  );
  const finalSourceScore: ScoreFact<"final"> = scoreT.check(
    finalReadme,
    responseQuality.atLeast(0.6),
    { key: "readme-quality-threshold" },
  );
  const finalSourceBooleanScore: BooleanFact<NonEmptyText, "final"> = scoreT.score(
    "README 非空",
    finalReadme,
    isNonEmptyText,
    { key: "readme-present-score", max: 1 },
  );
  const finalSourceScoreOnly: ScoreFact<"final"> = scoreT.score(
    "README 质量",
    finalReadme,
    responseQuality,
    { key: "readme-quality-score", max: 2 },
  );
  void finalSourceCheck;
  void finalSourceScore;
  void finalSourceBooleanScore;
  void finalSourceScoreOnly;

  // Sandbox and Judge producers are Facts, with no producer-side use method.
  const changedReadme = sandbox.fileChanged("README.md");
  scoreT.check(changedReadme, { key: "readme-changed" });
  const judgeQuality = judge.closedQA("Does the response explain the change?");
  const checkedJudge: ScoreFact<"now"> = scoreT.check(judgeQuality.atLeast(0.8), {
    key: "judge-threshold",
  });
  scoreT.score("Judge quality", checkedJudge, { key: "judge-score", max: 10 });

  // Only core-branded usage evidence can become notApplicable when uncovered.
  const coveredUsage: UsageEvidenceFact<"final"> = scoreT.checkIfCovered(usageFact, {
    key: "usage-covered",
  });
  void coveredUsage;

  // Custom BooleanMatch refinement flows through immediate control flow.
  const requiredId: HasId = await scoreT.require(candidate, hasId, { key: "candidate-id" });
  requiredId.id.toUpperCase();

  // A Standard Schema match likewise returns the candidate input, not its transform output.
  const original: string = await scoreT.require(candidate, matches(transformingSchema), {
    key: "schema-input",
  });
  original.toUpperCase();
  // @ts-expect-error A transform output is not the original candidate returned by require().
  original.toFixed();

  // @ts-expect-error A final Fact cannot stop a dependency path.
  await scoreT.require(finalSourceCheck);
}
void authoringExercise;

function proveMatcherComposition(): void {
  const combinedCommand = and(command, command);
  function readRefinedCommand(refinedCommand: RefinementOf<typeof combinedCommand>): void {
    refinedCommand.command.at(0);
  }
  void readRefinedCommand;
  // @ts-expect-error Boolean composition cannot cross Match domains.
  and(command, event);
  // @ts-expect-error not() is value-only and cannot negate a ToolMatch.
  not(command);

  const both = and(hasId, hasTitle);
  void both;
}
void proveMatcherComposition;

function proveOrderedEventBoundary(): void {
  rootScope.event(event);
  scope.toolOrder([command, command]);
  scope.eventOrder([event, event]);
  scope.eventsSatisfy("message follows tool", (events) => {
    const first = events[0];
    if (first === undefined) return false;
    const sameEvent = first.id === first.id;
    void sameEvent;
    first.position.turnOrdinal.toFixed();
    if (first.type === "message") first.text.toUpperCase();
    else first.tool.name.toUpperCase();
    // @ts-expect-error AssertionEvent never leaks the raw adapter pairing token.
    first.operationId;
    return true;
  });

  // @ts-expect-error Root aggregate scope has no stable cross-session tool order.
  rootScope.toolOrder([command, command]);
  // @ts-expect-error Root aggregate scope has no stable cross-session event order.
  rootScope.eventOrder([event, event]);
  // @ts-expect-error Root aggregate scope cannot expose an ordered event array.
  rootScope.eventsSatisfy("cross-session order", () => true);
  // @ts-expect-error calledTool requires an explicit ToolMatch; there is no string shorthand.
  scope.calledTool("git");
}
void proveOrderedEventBoundary;

function proveConsumerBoundaries(): void {
  const checkedBoolean: BooleanFact<HasId, "now"> = plainT.check(nowBooleanFact, {
    key: "boolean-verdict",
  });
  const checkedScore: ScoreFact<"now"> = plainT.check(nowScoreFact.atLeast(0.5), {
    key: "score-verdict",
  });
  const immediateBoolean: Promise<HasId> = plainT.require(nowBooleanFact, {
    key: "boolean-required",
  });
  const immediateScore: Promise<number> = plainT.require(nowScoreFact.atLeast(0.5), {
    key: "score-required",
  });
  void checkedBoolean;
  void checkedScore;
  void immediateBoolean;
  void immediateScore;

  const sharedHelperResult = sharedVerdictHelper(scoreT, scope.calledTool(toolMatch("node")));
  void sharedHelperResult;

  const returnedFact = scoreT.score("same existing Fact", nowBooleanFact, {
    key: "same-fact",
    max: 1,
  });
  const sameFactShape: BooleanFact<HasId, "now"> = returnedFact;
  const directScoreResult: void = scoreT.score("author-calculated", { key: "direct", earned: 2 });
  void sameFactShape;
  void directScoreResult;

  // @ts-expect-error A Score Fact verdict always needs atLeast.
  plainT.check(nowScoreFact);
  // @ts-expect-error A ScoreMatch verdict always needs atLeast.
  plainT.check(responseText, responseQuality);
  // @ts-expect-error A Score Fact requirement always needs atLeast.
  plainT.require(nowScoreFact);
  // @ts-expect-error A ScoreMatch requirement always needs atLeast.
  plainT.require(responseText, responseQuality);
  // @ts-expect-error Boolean Facts have no score threshold view.
  nowBooleanFact.atLeast(0.5);
  // @ts-expect-error A threshold view cannot be thresholded again.
  responseQuality.atLeast(0.5).atLeast(0.6);
  // @ts-expect-error A thresholded Fact view cannot be thresholded again.
  nowScoreFact.atLeast(0.5).atLeast(0.6);
  // @ts-expect-error atLeast is score semantics, not consumer metadata.
  plainT.check(nowScoreFact, { atLeast: 0.5 });
  // @ts-expect-error atLeast is score semantics, not consumer metadata.
  plainT.check(responseText, responseQuality, { atLeast: 0.5 });
  // @ts-expect-error A final thresholded Fact cannot stop a dependency path.
  plainT.require(finalScoreFact.atLeast(0.5));
  // @ts-expect-error Scoring accepts the bare ScoreFact; a threshold view cannot be ignored.
  scoreT.score("threshold is verdict-only", nowScoreFact.atLeast(0.5), { max: 1 });
  // @ts-expect-error Scoring accepts the bare ScoreMatch; a threshold view cannot be ignored.
  scoreT.score("threshold is verdict-only", responseText, responseQuality.atLeast(0.5), { max: 1 });
  // @ts-expect-error A final Fact cannot be required.
  plainT.require(finalBooleanFact);
  // @ts-expect-error Only ScoreTestContext exposes score().
  plainT.score("not available", nowBooleanFact, { max: 1 });
  // @ts-expect-error Existing Facts accept use options after the Fact, never another Match.
  plainT.check(nowBooleanFact, hasId);
  // @ts-expect-error Existing Facts cannot be routed back through a value-and-Match overload.
  plainT.require(nowBooleanFact, hasId);
  // @ts-expect-error Only branded usage evidence is eligible for coverage handling.
  plainT.checkIfCovered(nowBooleanFact);
  // @ts-expect-error Facts are inert evidence handles, not chainable consumer APIs.
  returnedFact.points(1);
}
void proveConsumerBoundaries;

function proveReservedValueBoundaries(): void {
  const finalText = sandbox.readText("README.md");

  // @ts-expect-error A Fact cannot become the raw value of a new check.
  plainT.check(nowBooleanFact, factAsValueMatch);
  // @ts-expect-error An EvidenceSource must use its dedicated source overload.
  plainT.check(finalText, sourceAsValueMatch);
  // @ts-expect-error A Match cannot become the raw value of a new check.
  plainT.check(isNonEmptyText, matchAsValueMatch);
  // @ts-expect-error A Fact cannot define the input domain of a custom Match.
  defineValueMatch<BooleanFact<HasId, "now">>({
    name: "fact-shaped matcher",
    evaluate(value: BooleanFact<HasId, "now">): value is BooleanFact<HasId, "now"> {
      return value.kind === "boolean";
    },
  });
}
void proveReservedValueBoundaries;

// A second verdict use or score use of one Fact is a runtime author error. TypeScript has no
// affine ownership model, so this prototype deliberately does not pretend to prove it statically.
