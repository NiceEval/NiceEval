// Eval author context.  Fact producers live on their natural evidence scope;
// assert/require/score are the only ordinary Fact consumers.

import type { AnswerValue } from "../agents/types.ts";
import type {
  BooleanFact,
  EvidenceSource,
  FactPhase,
  FactUseOptions,
  JudgeMaterial,
  ScoreCompletion,
  ScoreFact,
  ScoreThresholdOptions,
  UsageEvidenceFact,
} from "../assertions/types.ts";
import type {
  BooleanMatch,
  EventMatch,
  MatchableEvent,
  ScoreMatch,
  ToolMatch,
} from "../assertions/match.ts";
import type { InputRequest, LogicalToolOccurrence, O11ySummary, StreamEvent, Usage } from "../o11y/types.ts";
import type { DiagnosticInput, JsonMatch, JsonValue, ProgressUpdate } from "../shared/types.ts";
import type { SandboxOperations, SandboxTransferOperations } from "../sandbox/types.ts";

export type { BooleanMatch, EventMatch, ScoreMatch } from "../assertions/match.ts";
export type {
  BooleanFact,
  EvidenceSource,
  FactPhase,
  FactUseOptions,
  JudgeMaterial,
  ScoreCompletion,
  ScoreFact,
  ScoreThresholdOptions,
  UsageEvidenceFact,
} from "../assertions/types.ts";

/** `t.send()` / `session.send()` input. */
export type SendInput = string | { text: string; files?: readonly import("../agents/types.ts").InputFile[] };

export interface CollectionMatch {
  /** Exact positive count. Omit for "at least one"; use notCalledTool for zero. */
  readonly count?: number;
}

export interface ScopedFactProducers<P extends FactPhase> {
  succeeded(): BooleanFact<void, P>;
  parked(): BooleanFact<void, P>;
  calledTool(match: ToolMatch, options?: CollectionMatch): BooleanFact<LogicalToolOccurrence, P>;
  notCalledTool(match: ToolMatch): BooleanFact<void, P>;
  toolOrder(matches: readonly [ToolMatch, ToolMatch, ...ToolMatch[]]): BooleanFact<void, P>;
  usedNoTools(): BooleanFact<void, P>;
  maxToolCalls(max: number): BooleanFact<void, P>;
  loadedSkill(skill: string): BooleanFact<void, P>;
  noFailedActions(): BooleanFact<void, P>;
  event(match: EventMatch, options?: CollectionMatch): BooleanFact<MatchableEvent, P>;
  notEvent(match: EventMatch): BooleanFact<void, P>;
  eventOrder(matches: readonly [EventMatch, EventMatch, ...EventMatch[]]): BooleanFact<void, P>;
  eventsSatisfy(label: string, predicate: (events: readonly StreamEvent[]) => boolean): BooleanFact<void, P>;
  maxTokens(max: number): UsageEvidenceFact<P>;
  maxCost(usd: number): UsageEvidenceFact<P>;
}

/** A completed Agent turn is immutable, so its facts are usable by `require`. */
export interface TurnHandle extends ScopedFactProducers<"now"> {
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
export interface SessionHandle extends ScopedFactProducers<"now"> {
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

export interface TestContext extends ScopedFactProducers<"final"> {
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
  log(message: string): void;
  skip(reason: string): never;

  check<T, R extends T>(value: T, match: BooleanMatch<T, R, "value">): BooleanFact<R, "now">;
  check<T, R extends T, P extends FactPhase>(
    source: EvidenceSource<T, P>,
    match: BooleanMatch<T, R, "value">,
  ): BooleanFact<R, P>;
  check<T>(value: T, match: ScoreMatch<T>): ScoreFact<"now">;
  check<T, P extends FactPhase>(source: EvidenceSource<T, P>, match: ScoreMatch<T>): ScoreFact<P>;

  assert<R, P extends FactPhase>(fact: BooleanFact<R, P>, options?: FactUseOptions): void;
  assert<P extends FactPhase>(fact: ScoreFact<P>, options: ScoreThresholdOptions): void;
  assertIfCovered<P extends FactPhase>(fact: UsageEvidenceFact<P>, options?: FactUseOptions): void;

  require<R>(fact: BooleanFact<R, "now">, options?: FactUseOptions): Promise<R>;
  require(fact: ScoreFact<"now">, options: ScoreThresholdOptions): Promise<number>;
  require<T, R extends T>(value: T, match: BooleanMatch<T, R, "value">, options?: FactUseOptions): Promise<R>;

  group<T>(title: string, fn: () => Promise<T> | T): Promise<T>;
  readonly sandbox: EvalSandbox;
  readonly o11y: O11ySummary;
  readonly usage: Usage;
  readonly judge: JudgeNamespace;
}

export interface ScoreTestContext extends Omit<TestContext, "judge" | "send" | "sendFile" | "respond" | "respondAll" | "newSession"> {
  send(input: SendInput): Promise<TurnHandle>;
  sendFile(path: string, text?: string): Promise<TurnHandle>;
  respond(...responses: (string | RespondAnswer)[]): Promise<TurnHandle>;
  respondAll(optionId: string): Promise<TurnHandle>;
  newSession(): SessionHandle;
  readonly judge: JudgeNamespace;
  score<P extends FactPhase>(
    label: string,
    fact: BooleanFact<unknown, P> | ScoreFact<P>,
    options: { readonly key?: string; readonly max: number },
  ): void;
  score(label: string, direct: { readonly key?: string; readonly earned: number }): void;
  finishScore(): ScoreCompletion;
}
