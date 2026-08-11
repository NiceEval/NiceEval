// Eval author context. Fact producers live on their natural evidence scope;
// check/require/score are the only ordinary Fact consumers.

import type { AnswerValue } from "../agents/types.ts";
import type {
  BooleanFact,
  AuthorValue,
  DirectScoreOptions,
  EvidenceSource,
  FactPhase,
  FactUseOptions,
  JudgeMaterial,
  ScoreFact,
  ScoreUseOptions,
  ThresholdedScoreFact,
  UsageEvidenceFact,
} from "../assertions/types.ts";
import type {
  BooleanMatch,
  AssertionEvent,
  EventMatch,
  ScoreMatch,
  ThresholdedScoreMatch,
  ToolMatch,
} from "../assertions/match.ts";
import type { InputRequest, LogicalToolOccurrence, O11ySummary, StreamEvent, Usage } from "../o11y/types.ts";
import type { DiagnosticInput, JsonMatch, JsonValue, ProgressUpdate } from "../shared/types.ts";
import type { SandboxOperations, SandboxTransferOperations } from "../sandbox/types.ts";

export type {
  AssertionEvent,
  BooleanMatch,
  EventMatch,
  ScoreMatch,
  ThresholdedScoreMatch,
} from "../assertions/match.ts";
export type {
  BooleanFact,
  AuthorValue,
  DirectScoreOptions,
  EvidenceSource,
  FactPhase,
  FactUseOptions,
  JudgeMaterial,
  ScoreFact,
  ScoreUseOptions,
  ThresholdedScoreFact,
  UsageEvidenceFact,
} from "../assertions/types.ts";

/** `t.send()` / `session.send()` input. */
export type SendInput = string | { text: string; files?: readonly import("../agents/types.ts").InputFile[] };

export interface CollectionMatch {
  /** Exact positive count. Omit for "at least one"; use notCalledTool for zero. */
  readonly count?: number;
}

type AcceptsMatchInput<T, I> = [T] extends [I] ? unknown : never;

export interface AggregateScopedFactProducers<P extends FactPhase> {
  succeeded(): BooleanFact<void, P>;
  parked(): BooleanFact<void, P>;
  calledTool(match: ToolMatch, options?: CollectionMatch): BooleanFact<LogicalToolOccurrence, P>;
  notCalledTool(match: ToolMatch): BooleanFact<void, P>;
  usedNoTools(): BooleanFact<void, P>;
  maxToolCalls(max: number): BooleanFact<void, P>;
  loadedSkill(skill: string): BooleanFact<void, P>;
  noFailedActions(): BooleanFact<void, P>;
  event(match: EventMatch, options?: CollectionMatch): BooleanFact<AssertionEvent, P>;
  notEvent(match: EventMatch): BooleanFact<void, P>;
  maxTokens(max: number): UsageEvidenceFact<P>;
  maxCost(usd: number): UsageEvidenceFact<P>;
}

export interface OrderedScopedFactProducers<P extends FactPhase> extends AggregateScopedFactProducers<P> {
  toolOrder(matches: readonly [ToolMatch, ToolMatch, ...ToolMatch[]]): BooleanFact<void, P>;
  eventOrder(matches: readonly [EventMatch, EventMatch, ...EventMatch[]]): BooleanFact<void, P>;
  eventsSatisfy(
    label: string,
    predicate: (events: readonly AssertionEvent[]) => boolean | Promise<boolean>,
  ): BooleanFact<void, P>;
}

/** A completed Agent turn is immutable, so its facts are usable by `require`. */
export interface TurnHandle extends OrderedScopedFactProducers<"now"> {
  readonly events: readonly StreamEvent[];
  readonly toolCalls: readonly import("../o11y/types.ts").ToolCall[];
  readonly status: "completed" | "failed" | "waiting";
  readonly message: string;
  readonly data?: JsonValue;
  readonly usage?: Usage;
  /** Judge facts are bound to this immutable turn's original input and output. */
  readonly judge: TurnJudgeNamespace;
}

export interface AutoevalsNamespace {
  closedQA(question: string, material: JudgeMaterial): ScoreFact<"now">;
  factuality(expected: string, material: JudgeMaterial): ScoreFact<"now">;
  summarizes(source: string, material: JudgeMaterial): ScoreFact<"now">;
}

export interface TurnAutoevalsNamespace {
  closedQA(question: string): ScoreFact<"now">;
  factuality(expected: string): ScoreFact<"now">;
  summarizes(source: string): ScoreFact<"now">;
}

export interface JudgeNamespace {
  readonly autoevals: AutoevalsNamespace;
}

export interface TurnJudgeNamespace {
  readonly autoevals: TurnAutoevalsNamespace;
}

export interface FileChangedOptions {
  readonly before?: BooleanMatch<string, string, "value">;
  readonly after?: BooleanMatch<string, string, "value">;
}

/** Eval-visible sandbox. The final-diff Fact producers never perform I/O at declaration time. */
export interface EvalSandbox extends SandboxOperations, SandboxTransferOperations {
  file(path: string): EvidenceSource<string, "final">;
  changedPaths(paths: readonly string[]): BooleanFact<void, "final">;
  noChanges(): BooleanFact<void, "final">;
  fileChanged(path: string, options?: FileChangedOptions): BooleanFact<void, "final">;
  fileDeleted(path: string): BooleanFact<void, "final">;
  notInDiff(pattern: RegExp): BooleanFact<void, "final">;
  noFailedShellCommands(): BooleanFact<void, "final">;
}

export interface InputRequestFilter {
  id?: string | RegExp;
  prompt?: string | RegExp;
  display?: string | RegExp;
  action?: string | RegExp;
  input?: JsonMatch;
  optionIds?: readonly string[];
}

export type RespondAnswer = { readonly request: InputRequest } & AnswerValue;

/** A session Fact captures the session prefix at declaration time. */
export interface SessionHandle extends OrderedScopedFactProducers<"now"> {
  send(input: SendInput): Promise<TurnHandle>;
  sendFile(path: string, text?: string): Promise<TurnHandle>;
  requireInputRequest(filter?: InputRequestFilter): InputRequest;
  respond(...responses: (string | RespondAnswer)[]): Promise<TurnHandle>;
  respondAll(optionId: string): Promise<TurnHandle>;
  readonly reply: string;
  readonly sessionId: string | undefined;
  readonly events: readonly StreamEvent[];
  readonly usage: Usage;
}

export interface TestContext extends AggregateScopedFactProducers<"final"> {
  send(input: SendInput): Promise<TurnHandle>;
  sendFile(path: string, text?: string): Promise<TurnHandle>;
  requireInputRequest(filter?: InputRequestFilter): InputRequest;
  respond(...responses: (string | RespondAnswer)[]): Promise<TurnHandle>;
  respondAll(optionId: string): Promise<TurnHandle>;
  readonly reply: string;
  readonly sessionId: string | undefined;
  readonly events: readonly StreamEvent[];
  newSession(): SessionHandle;

  readonly signal: AbortSignal;
  readonly model?: string;
  readonly reasoningEffort?: string;
  readonly flags: Readonly<globalThis.Record<string, JsonValue>>;
  progress(update: ProgressUpdate): void;
  diagnostic(input: DiagnosticInput): void;
  /** `progress({ message: msg })` 的别名(调试日志),不出现在最终结果里。 */
  log(message: string): void;
  /** 立即中止本评估用例,在 `niceeval.verdict` 通道形成 `skipped` Verdict;`reason` 不能为空。 */
  skip(reason: string): never;

  check<F extends BooleanFact<unknown, FactPhase>>(fact: F, options?: FactUseOptions): F;
  check<F extends ScoreFact<FactPhase>>(fact: ThresholdedScoreFact<F>, options?: FactUseOptions): F;
  check<T, I, R extends I, P extends FactPhase>(
    source: EvidenceSource<T, P> & AcceptsMatchInput<T, NoInfer<I>>,
    match: BooleanMatch<I, R, "value">,
    options?: FactUseOptions,
  ): BooleanFact<T & R, P>;
  check<T, P extends FactPhase>(
    source: EvidenceSource<T, P>,
    match: ThresholdedScoreMatch<NoInfer<T>>,
    options?: FactUseOptions,
  ): ScoreFact<P>;
  check<T, I, R extends I>(
    value: T & AuthorValue<T> & AcceptsMatchInput<T, NoInfer<I>>,
    match: BooleanMatch<I, R, "value">,
    options?: FactUseOptions,
  ): BooleanFact<T & R, "now">;
  check<T>(
    value: T & AuthorValue<T>,
    match: ThresholdedScoreMatch<NoInfer<T>>,
    options?: FactUseOptions,
  ): ScoreFact<"now">;

  checkIfCovered<F extends UsageEvidenceFact<FactPhase>>(fact: F, options?: FactUseOptions): F;

  require<R>(fact: BooleanFact<R, "now">, options?: FactUseOptions): Promise<R>;
  require<F extends ScoreFact<"now">>(fact: ThresholdedScoreFact<F>, options?: FactUseOptions): Promise<number>;
  require<T, I, R extends I>(
    value: T & AuthorValue<T> & AcceptsMatchInput<T, NoInfer<I>>,
    match: BooleanMatch<I, R, "value">,
    options?: FactUseOptions,
  ): Promise<T & R>;
  require<T>(
    value: T & AuthorValue<T>,
    match: ThresholdedScoreMatch<NoInfer<T>>,
    options?: FactUseOptions,
  ): Promise<number>;

  group<T>(title: string, fn: () => Promise<T> | T): Promise<T>;
  readonly sandbox: EvalSandbox;
  readonly o11y: O11ySummary;
  readonly usage: Usage;
  readonly judge: JudgeNamespace;
}

export interface ScoreTestContext extends TestContext {
  score<F extends BooleanFact<unknown, FactPhase>>(label: string, fact: F, options: ScoreUseOptions): F;
  score<F extends ScoreFact<FactPhase>>(label: string, fact: F, options: ScoreUseOptions): F;
  score<T, I, R extends I, P extends FactPhase>(
    label: string,
    source: EvidenceSource<T, P> & AcceptsMatchInput<T, NoInfer<I>>,
    match: BooleanMatch<I, R, "value">,
    options: ScoreUseOptions,
  ): BooleanFact<T & R, P>;
  score<T, P extends FactPhase>(
    label: string,
    source: EvidenceSource<T, P>,
    match: ScoreMatch<NoInfer<T>>,
    options: ScoreUseOptions,
  ): ScoreFact<P>;
  score<T, I, R extends I>(
    label: string,
    value: T & AuthorValue<T> & AcceptsMatchInput<T, NoInfer<I>>,
    match: BooleanMatch<I, R, "value">,
    options: ScoreUseOptions,
  ): BooleanFact<T & R, "now">;
  score<T>(
    label: string,
    value: T & AuthorValue<T>,
    match: ScoreMatch<NoInfer<T>>,
    options: ScoreUseOptions,
  ): ScoreFact<"now">;
  score(label: string, direct: DirectScoreOptions): void;
}
