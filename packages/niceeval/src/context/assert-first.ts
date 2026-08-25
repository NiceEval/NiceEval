/**
 * The active Eval context. Assertion authoring deliberately enters through
 * `AssertionsRuntime`; this module never constructs an intermediate Fact or
 * starts a private runtime.
 */

import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";

import { Effect } from "effect";

import {
  captureAssertionSnapshot,
  createAssertionsRuntime,
  postRunBooleanAssertionHandle,
} from "../assertions/runtime.ts";
import type {
  AssertionCriterion,
  AssertionMaterial,
  AssertionsRuntime,
  BooleanAssertionHandle,
  BooleanAssertionEvaluation,
  DirectScoreAssertionHandle,
  MatcherSourceLocator,
  MatcherSourceSnapshot,
  MeasurementAssertionHandle,
  PostRunBooleanAssertionHandle,
} from "../assertions/api.ts";
import {
  evaluateMatcherCollection,
  evaluateMatcherOrder,
  interruptedMatcherArtifact,
  type MatcherQuery,
  type MatcherSourceRow,
} from "../assertions/matcher-artifact.ts";
import {
  assertJudgeCapability,
  evaluateJudgeMeasurement,
  freezeJudgeMaterial,
  type JudgeRecipe,
} from "../assertions/judge.ts";
import {
  agentWorkspaceDiffChangesForPath,
  agentWorkspaceDiffPathsMatch,
  evaluateWorkspaceDiffNotIn,
  type AgentWorkspaceDiffEndpoint,
  type PostRunWorkspaceDiffState,
  type WorkspaceDiffNotInOptions,
} from "../assertions/workspace-diff.ts";
import {
  assertCanonicalWorkspaceRelativePath,
  validateExpectedTouchedPaths,
} from "../assertions/diff.ts";
import { collectionMatchRegistration, freezeManagedToolCalls } from "../assertions/collection.ts";
import {
  atMost,
  assertionEventOccurrence,
  assertManagedEventMatch,
  assertManagedToolMatch,
  evaluateBooleanMatch,
  inOrder,
  makeAssertionMessageEvent,
  makeAssertionToolEvent,
  toolMatch,
  type BooleanMatch,
  type BooleanMatchEvaluation,
  type EventMatch,
  type ManagedToolCalls,
  type MatchableEvent,
  type ToolMatch,
  type ToolMatchQuantifier,
} from "../assertions/match.ts";
import { numericBooleanRegistration } from "../assertions/numeric.ts";
import {
  buildO11ySummary,
  deriveRunFacts,
  deriveScopedLogicalToolOccurrences,
  projectObservedSourceEvents,
  type ObservedEventLedgerRow,
  type ObservedToolOccurrenceLedgerRow,
} from "../o11y/derive.ts";
import {
  observedSnapshotForTurn,
  type ObservedEvaluationSegment,
  type ObservedSourceEvent,
  type ObservedTurnSnapshot,
} from "../o11y/observed.ts";
import {
  pricingEstimate,
  type PricingEstimateResult,
} from "../o11y/cost.ts";
import { UNCLASSIFIED_TOOL_ACTIONS_REASON } from "../o11y/command-projection.ts";
import { captureLoc, type SourceRegistry } from "../source-loc.ts";
import { lastAssistantText, RunSession, SessionManager, type SessionDeps } from "./session.ts";
import { EvalSkipped } from "./control-flow.ts";
import type { ConcurrencySlot } from "./send-retry.ts";
import type { AnswerValue, InputResponse } from "../agents/types.ts";
import { matchesJson } from "../shared/json-match.ts";
import type {
  Agent,
  InputFile,
  InputRequest,
  InputRequestFilter,
  JsonMatch,
  JsonValue,
  JudgeMaterial,
  PriceOverride,
  ResolvedJudgeConfig,
  Sandbox,
  SandboxOperations,
  SandboxTransferOperations,
  StreamEvent,
  Turn,
  Usage,
} from "../types.ts";
import type {
  LogicalToolOccurrence,
  LogicalToolOccurrenceScopeTurn,
  OrphanToolOperationFinish,
} from "../o11y/types.ts";

export interface AssertFirstLateResult {
  diff: PostRunWorkspaceDiffState;
  scripts: globalThis.Record<string, import("../types.ts").ScriptResult>;
}

export interface AssertFirstContextState {
  readonly assertions: AssertionsRuntime<"pass" | "score">;
  readonly manager: SessionManager;
  skipReason?: string;
  readonly late: AssertFirstLateResult;
}

/** The Runner-facing dependencies retain the current SessionManager boundary. */
export interface AssertFirstContextDeps {
  readonly agent: Agent;
  readonly sandbox: Sandbox;
  readonly evalId?: string;
  readonly attempt?: import("../types.ts").AgentContext["attempt"];
  readonly evalGroup?: import("../types.ts").AgentContext["evalGroup"];
  readonly model?: string;
  /** defineConfig({ pricing }) 的价目表,只供 maxCost 的 estimatedCostUSD 估算(estimateCost);与 observed usage.costUSD 无关。 */
  readonly pricing?: globalThis.Record<string, PriceOverride>;
  readonly reasoningEffort?: string;
  readonly flags: globalThis.Record<string, JsonValue>;
  readonly experimentId?: string;
  readonly signal: AbortSignal;
  readonly log: (message: string) => void;
  readonly telemetry?: import("../types.ts").Telemetry;
  readonly otel?: import("../o11y/otlp/turn-otel.ts").AgentOtelChannel;
  readonly feedback?: import("../types.ts").ScopedFeedback;
  readonly onSendActive?: (active: boolean) => void;
  readonly ledgerHooks?: import("./session.ts").SessionDeps["ledgerHooks"];
  readonly timingNow?: import("./session.ts").SessionDeps["timingNow"];
  readonly onTurn?: import("./session.ts").SessionDeps["onTurn"];
  readonly concurrencySlot?: ConcurrencySlot;
  readonly experimentClassifier?: import("./session.ts").SessionDeps["experimentClassifier"];
  /** Attempt-owned source snapshot registry; never inferred from an Effect fiber. */
  readonly sourceRegistry?: SourceRegistry;
  readonly resources: import("../types.ts").AttemptResourceRegistry;
  /** Shared ordering with Assertion runtime source facts and Session user events. */
  readonly nextSourceOrder?: () => number;
  readonly judge: ResolvedJudgeConfig | undefined;
  /** The Attempt-scoped bridge is the sole Promise facade for author sends. */
  readonly requestEffect: NonNullable<SessionDeps["requestEffect"]>;
  /** Ordinary immediate Assertion stop barriers stay in the Attempt Effect Scope. */
  readonly executeStop: import("../assertions/api.ts").AssertionStopExecutor;
  readonly evaluationKind: "pass" | "score";
}

type RuntimeKind = "pass" | "score";
type AssertFirstRespondAnswer = { readonly request: InputRequest } & AnswerValue;

export interface CalledToolAtLeast {
  readonly atLeast: number;
}

export type CalledToolCount =
  | number
  | CalledToolAtLeast;

export interface CalledToolOptions {
  readonly count?: CalledToolCount;
}

export interface EventOptions {
  /** An omitted count requires at least one matching event; a number is exact. */
  readonly count?: number;
}

export interface FileChangedOptions {
  readonly status?: "added" | "modified" | "deleted";
  readonly before?: BooleanMatch<string, string, "value">;
  readonly after?: BooleanMatch<string, string, "value">;
}

/** The only agent-attributed post-run diff surface exposed to Eval authors. */
export interface AssertFirstSandbox<Kind extends RuntimeKind>
  extends SandboxOperations, SandboxTransferOperations {
  changedPaths(paths: readonly string[]): PostRunBooleanAssertionHandle<Kind, void>;
  noChanges(): PostRunBooleanAssertionHandle<Kind, void>;
  fileChanged(
    path: string,
    options?: FileChangedOptions,
  ): PostRunBooleanAssertionHandle<Kind, void>;
  fileDeleted(path: string): PostRunBooleanAssertionHandle<Kind, void>;
  notInDiff(
    pattern: RegExp,
    options?: WorkspaceDiffNotInOptions,
  ): PostRunBooleanAssertionHandle<Kind, void>;
}

export interface AssertFirstRootJudge<Kind extends RuntimeKind> {
  readonly autoevals: {
    closedQA(question: string, material: JudgeMaterial): MeasurementAssertionHandle<Kind>;
    factuality(expected: string, material: JudgeMaterial): MeasurementAssertionHandle<Kind>;
    summarizes(source: string, material: JudgeMaterial): MeasurementAssertionHandle<Kind>;
  };
}

export interface AssertFirstTurnJudge<Kind extends RuntimeKind> {
  readonly autoevals: {
    closedQA(question: string): MeasurementAssertionHandle<Kind>;
    factuality(expected: string): MeasurementAssertionHandle<Kind>;
    summarizes(source: string): MeasurementAssertionHandle<Kind>;
  };
}

export interface AssertFirstTurnHandle<Kind extends RuntimeKind> {
  readonly events: readonly StreamEvent[];
  readonly toolCalls: ManagedToolCalls<"turn">;
  readonly status: "completed" | "failed" | "waiting";
  readonly message: string;
  readonly data?: JsonValue;
  readonly usage?: Usage;
  check: AssertionsRuntime<Kind>["t"]["check"];
  succeeded(): BooleanAssertionHandle<Kind, void>;
  calledTool(match: ToolMatch, options?: CalledToolOptions): BooleanAssertionHandle<Kind, void>;
  calledTool(name: string, options?: CalledToolOptions): BooleanAssertionHandle<Kind, void>;
  notCalledTool(match: ToolMatch): BooleanAssertionHandle<Kind, void>;
  notCalledTool(name: string): BooleanAssertionHandle<Kind, void>;
  toolOrder(matches: readonly [ToolMatch, ToolMatch, ...ToolMatch[]]): BooleanAssertionHandle<Kind, void>;
  usedNoTools(): BooleanAssertionHandle<Kind, void>;
  maxToolCalls(max: number): BooleanAssertionHandle<Kind, void>;
  noFailedActions(): BooleanAssertionHandle<Kind, void>;
  event(match: EventMatch, options?: EventOptions): BooleanAssertionHandle<Kind, void>;
  notEvent(match: EventMatch): BooleanAssertionHandle<Kind, void>;
  eventOrder(matches: readonly [EventMatch, EventMatch, ...EventMatch[]]): BooleanAssertionHandle<Kind, void>;
  maxTokens(max: number): BooleanAssertionHandle<Kind, void>;
  maxCost(usd: number): BooleanAssertionHandle<Kind, void>;
  readonly judge: AssertFirstTurnJudge<Kind>;
}

export interface AssertFirstSessionHandle<Kind extends RuntimeKind> {
  send(input: string | { readonly text: string; readonly files?: readonly InputFile[] }): Promise<AssertFirstTurnHandle<Kind>>;
  sendFile(path: string, text?: string): Promise<AssertFirstTurnHandle<Kind>>;
  requireInputRequest(filter?: InputRequestFilter): InputRequest;
  respond(...responses: readonly (string | AssertFirstRespondAnswer)[]): Promise<AssertFirstTurnHandle<Kind>>;
  respondAll(optionId: string): Promise<AssertFirstTurnHandle<Kind>>;
  readonly reply: string;
  readonly sessionId: string | undefined;
  readonly events: readonly StreamEvent[];
  readonly usage: Usage;
  readonly toolCalls: ManagedToolCalls<"session">;
  check: AssertionsRuntime<Kind>["t"]["check"];
  succeeded(): BooleanAssertionHandle<Kind, void>;
  calledTool(match: ToolMatch, options?: CalledToolOptions): BooleanAssertionHandle<Kind, void>;
  calledTool(name: string, options?: CalledToolOptions): BooleanAssertionHandle<Kind, void>;
  notCalledTool(match: ToolMatch): BooleanAssertionHandle<Kind, void>;
  notCalledTool(name: string): BooleanAssertionHandle<Kind, void>;
  toolOrder(matches: readonly [ToolMatch, ToolMatch, ...ToolMatch[]]): BooleanAssertionHandle<Kind, void>;
  usedNoTools(): BooleanAssertionHandle<Kind, void>;
  maxToolCalls(max: number): BooleanAssertionHandle<Kind, void>;
  noFailedActions(): BooleanAssertionHandle<Kind, void>;
  event(match: EventMatch, options?: EventOptions): BooleanAssertionHandle<Kind, void>;
  notEvent(match: EventMatch): BooleanAssertionHandle<Kind, void>;
  eventOrder(matches: readonly [EventMatch, EventMatch, ...EventMatch[]]): BooleanAssertionHandle<Kind, void>;
  maxTokens(max: number): BooleanAssertionHandle<Kind, void>;
  maxCost(usd: number): BooleanAssertionHandle<Kind, void>;
}

export type AssertFirstTestContext<Kind extends RuntimeKind> = {
  readonly evaluationKind: Kind;
  send(input: string | { readonly text: string; readonly files?: readonly InputFile[] }): Promise<AssertFirstTurnHandle<Kind>>;
  sendFile(path: string, text?: string): Promise<AssertFirstTurnHandle<Kind>>;
  requireInputRequest(filter?: InputRequestFilter): InputRequest;
  respond(...responses: readonly (string | AssertFirstRespondAnswer)[]): Promise<AssertFirstTurnHandle<Kind>>;
  respondAll(optionId: string): Promise<AssertFirstTurnHandle<Kind>>;
  readonly reply: string;
  readonly sessionId: string | undefined;
  readonly events: readonly StreamEvent[];
  newSession(): AssertFirstSessionHandle<Kind>;
  readonly signal: AbortSignal;
  readonly model?: string;
  readonly reasoningEffort?: string;
  readonly flags: Readonly<globalThis.Record<string, JsonValue>>;
  progress(update: import("../types.ts").ProgressUpdate): void;
  diagnostic(input: import("../types.ts").DiagnosticInput): void;
  log(message: string): void;
  skip(reason: string): never;
  group<Value>(
    title: string,
    body: () => Value | PromiseLike<Value>,
  ): Promise<Awaited<Value>>;
  check: AssertionsRuntime<Kind>["t"]["check"];
  readonly toolCalls: ManagedToolCalls<"attempt">;
  readonly sandbox: AssertFirstSandbox<Kind>;
  readonly o11y: import("../o11y/types.ts").O11ySummary;
  readonly usage: Usage;
  succeeded(): BooleanAssertionHandle<Kind, void>;
  calledTool(match: ToolMatch, options?: CalledToolOptions): BooleanAssertionHandle<Kind, void>;
  calledTool(name: string, options?: CalledToolOptions): BooleanAssertionHandle<Kind, void>;
  notCalledTool(match: ToolMatch): BooleanAssertionHandle<Kind, void>;
  notCalledTool(name: string): BooleanAssertionHandle<Kind, void>;
  usedNoTools(): BooleanAssertionHandle<Kind, void>;
  maxToolCalls(max: number): BooleanAssertionHandle<Kind, void>;
  noFailedActions(): BooleanAssertionHandle<Kind, void>;
  event(match: EventMatch, options?: EventOptions): BooleanAssertionHandle<Kind, void>;
  notEvent(match: EventMatch): BooleanAssertionHandle<Kind, void>;
  maxTokens(max: number): BooleanAssertionHandle<Kind, void>;
  maxCost(usd: number): BooleanAssertionHandle<Kind, void>;
  readonly judge: AssertFirstRootJudge<Kind>;
} & (Kind extends "score" ? { score(points: number): DirectScoreAssertionHandle } : {});

type AssertionScope = "turn" | "session" | "attempt";
type ScopeStatus = "completed" | "failed" | "waiting" | "not-started";
type ScopeCoverage = import("../assertions/coverage.ts").ResolvedEvidenceCoverage;

function scopeCriterion(
  scope: AssertionScope,
  assertion: "succeeded" | "no-failed-actions" = "succeeded",
): AssertionCriterion {
  return Object.freeze({
    kind: "scope-status" as const,
    scope,
    assertion,
  });
}

function occurrenceCriterion(
  scope: AssertionScope,
  occurrence: "tool" | "event",
  matcher: string | undefined,
  quantifier: ToolMatchQuantifier,
): AssertionCriterion {
  return Object.freeze({
    kind: "occurrence" as const,
    scope,
    occurrence,
    assertion: quantifier.kind === "absent"
      ? "absent" as const
      : quantifier.kind === "exact"
        ? "count" as const
        : quantifier.kind === "at-least" && quantifier.count === 1
          ? "present" as const
          : "count" as const,
    ...(matcher === undefined ? {} : { matcher }),
    quantifier: Object.freeze(
      quantifier.kind === "absent"
        ? { kind: "absent" as const }
        : { kind: quantifier.kind, count: quantifier.count },
    ),
  });
}

function scopeCoverageState(
  coverage: ScopeCoverage,
  channel: "actions" | "status",
): "complete" | "partial" | "unavailable" {
  return coverage[channel].status;
}

function succeededHandle<Kind extends RuntimeKind>(input: {
  readonly runtime: AssertionsRuntime<Kind>;
  readonly scope: AssertionScope;
  readonly status: ScopeStatus;
  readonly coverage: ScopeCoverage;
  readonly snapshot: unknown;
}): BooleanAssertionHandle<Kind, void> {
  const captured = captureAssertionSnapshot({
    scope: input.scope,
    assertion: "succeeded",
    status: input.status,
    coverage: input.coverage.status.status,
    snapshot: input.snapshot,
  });
  return input.runtime.registerBoolean<void>({
    criterion: scopeCriterion(input.scope),
    subject: captured.material,
    coverage: captured.coverage,
    limitations: captured.limitations,
    evaluate: () =>
      Effect.sync(() =>
        input.status === "not-started"
          ? Object.freeze({ state: "mismatched" as const })
          : scopeCoverageState(input.coverage, "status") !== "complete"
          ? Object.freeze({ state: "unavailable" as const, reason: "source-unavailable" as const })
          : input.status === "completed"
          ? Object.freeze({ state: "matched" as const, value: undefined })
          : Object.freeze({ state: "mismatched" as const }),
      ),
  });
}

interface MatcherScopeTurn {
  readonly observed: ObservedTurnSnapshot;
  readonly events: readonly StreamEvent[];
  readonly outcome: "completed" | "failed" | "waiting";
}

type ProjectedMatcherCandidate<Candidate> =
  | { readonly state: "available"; readonly value: Candidate }
  | { readonly state: "unavailable"; readonly reason: string };

interface MatcherSourceProjection {
  readonly state: "available" | "invalid";
  readonly events: readonly ObservedEventLedgerRow[];
  readonly toolOccurrences: readonly ObservedToolOccurrenceLedgerRow[];
  readonly occurrenceCandidates: ReadonlyMap<string, LogicalToolOccurrence>;
  readonly orphanFinishes: readonly OrphanToolOperationFinish[];
  readonly eventMaterial: ReadonlyMap<string, StreamEvent>;
}

type ResolveObservedEvaluation = (
  snapshot: ObservedTurnSnapshot,
) => ObservedEvaluationSegment | undefined;

interface ToolScopeSnapshot {
  readonly occurrences: readonly LogicalToolOccurrence[];
  readonly rows: readonly MatcherSourceRow<ProjectedMatcherCandidate<LogicalToolOccurrence>>[];
  readonly orphanFinishes: readonly OrphanToolOperationFinish[];
  readonly sourceSnapshot: MatcherSourceSnapshot;
  readonly coverage: ScopeCoverage;
  readonly snapshot: unknown;
}

function unavailableSourceSnapshot(
  snapshot: MatcherSourceSnapshot,
): MatcherSourceSnapshot {
  return Object.freeze({ ...snapshot, collectionAtCut: "unavailable" as const });
}

function projectMatcherSources(
  turns: readonly MatcherScopeTurn[],
  resolveEvaluation: ResolveObservedEvaluation,
): MatcherSourceProjection {
  const evaluation = turns.map((turn) => resolveEvaluation(turn.observed));
  if (evaluation.some((segment) => segment === undefined)) {
    return Object.freeze({
      state: "invalid" as const,
      events: Object.freeze([]),
      toolOccurrences: Object.freeze([]),
      occurrenceCandidates: new Map<string, LogicalToolOccurrence>(),
      orphanFinishes: Object.freeze([]),
      eventMaterial: new Map<string, StreamEvent>(),
    });
  }
  const segments = evaluation as readonly ObservedEvaluationSegment[];
  const projected = projectObservedSourceEvents(segments);
  const logicalTurns: readonly LogicalToolOccurrenceScopeTurn[] = Object.freeze(
    segments.map((segment, index) => Object.freeze({
      session: segment.sessionId,
      turn: segment.turnId,
      turnOrdinal: index + 1,
      events: segment.events,
      outcome: turns[index]!.outcome,
    })),
  );
  const logical = deriveScopedLogicalToolOccurrences(logicalTurns);
  const eventMaterial = new Map<string, StreamEvent>();
  for (const segment of segments) {
    segment.items.forEach((item, index) => {
      const event = segment.events[index];
      if (event !== undefined) eventMaterial.set(item.eventId, event);
    });
  }
  if (projected.state === "invalid") {
    return Object.freeze({
      state: "invalid" as const,
      events: Object.freeze([]),
      toolOccurrences: Object.freeze([]),
      occurrenceCandidates: new Map<string, LogicalToolOccurrence>(),
      orphanFinishes: logical.orphanFinishes,
      eventMaterial,
    });
  }

  const occurrenceCandidates = new Map<string, LogicalToolOccurrence>();
  for (const occurrence of logical.occurrences) {
    const segment = segments[occurrence.start.turnOrdinal - 1];
    const start = segment?.items[occurrence.start.eventOrdinal];
    if (segment === undefined || start?.kind !== "tool-start") continue;
    occurrenceCandidates.set(start.toolOccurrenceId, Object.freeze({
      ...occurrence,
      id: start.toolOccurrenceId,
      session: segment.sessionId,
      turn: segment.turnId,
    }));
  }
  return Object.freeze({
    state: "available" as const,
    events: projected.events,
    toolOccurrences: projected.toolOccurrences,
    occurrenceCandidates,
    orphanFinishes: logical.orphanFinishes,
    eventMaterial,
  });
}

function exactToolLocator(toolOccurrenceId: string): MatcherSourceLocator {
  return Object.freeze({
    kind: "tool-occurrence" as const,
    toolOccurrenceId,
    relation: Object.freeze({ state: "exact" as const }),
  });
}

function projectToolScope(input: {
  readonly turns: readonly MatcherScopeTurn[];
  readonly sourceSnapshot: MatcherSourceSnapshot;
  readonly homeTurnId?: string;
  readonly coverage: ScopeCoverage;
  readonly snapshot: unknown;
  readonly resolveEvaluation: ResolveObservedEvaluation;
}): ToolScopeSnapshot {
  const projection = projectMatcherSources(input.turns, input.resolveEvaluation);
  const sourceSnapshot = projection.state === "invalid"
    ? unavailableSourceSnapshot(input.sourceSnapshot)
    : input.sourceSnapshot;
  const sourceRows = input.homeTurnId === undefined
    ? projection.toolOccurrences
    : projection.toolOccurrences.filter((row) => row.homeTurnId === input.homeTurnId);
  const rows = Object.freeze(sourceRows.map((row) => {
    const candidate = projection.occurrenceCandidates.get(row.toolOccurrenceId);
    return Object.freeze({
      locator: exactToolLocator(row.toolOccurrenceId),
      sessionId: row.sessionId,
      sessionSequence: row.startSessionSequence,
      candidate: candidate === undefined
        ? Object.freeze({
            state: "unavailable" as const,
            reason: "source-occurrence-material-unavailable",
          })
        : Object.freeze({ state: "available" as const, value: candidate }),
    });
  }));
  return Object.freeze({
    occurrences: Object.freeze(rows.flatMap((row) =>
      row.candidate.state === "available" ? [row.candidate.value] : []
    )),
    rows,
    orphanFinishes: projection.orphanFinishes,
    sourceSnapshot,
    coverage: input.coverage,
    snapshot: input.snapshot,
  });
}

function resolveToolTarget(target: ToolMatch | string, label: "calledTool" | "notCalledTool"): ToolMatch {
  if (typeof target === "string") return toolMatch(target);
  return assertManagedToolMatch(target, `${label}() match`);
}

function normalizeCalledToolOptions(
  value: CalledToolOptions | undefined,
): Extract<ToolMatchQuantifier, { readonly kind: "at-least" | "exact" }> {
  if (value === undefined) return Object.freeze({ kind: "at-least" as const, count: 1 });
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("calledTool() options must be an object");
  }
  const options = value as globalThis.Record<string, unknown>;
  for (const key of Object.keys(options)) {
    if (key !== "count") {
      throw new TypeError(`calledTool() options does not support option ${JSON.stringify(key)}; put field constraints in toolMatch()`);
    }
  }
  const count = options.count;
  if (count === undefined) return Object.freeze({ kind: "at-least" as const, count: 1 });
  if (count !== undefined) {
    if (typeof count === "number") {
      if (count === 0) {
        throw new TypeError("calledTool() options.count must be a positive safe integer; use notCalledTool() for zero");
      }
      if (!Number.isSafeInteger(count) || count < 0) {
        throw new TypeError("calledTool() options.count must be a positive safe integer");
      }
      return Object.freeze({ kind: "exact" as const, count });
    }
    if (typeof count !== "object" || count === null || Array.isArray(count)) {
      throw new TypeError("calledTool() options.count must be a positive safe integer or { atLeast: positive safe integer }");
    }
    const lowerBound = count as globalThis.Record<string, unknown>;
    for (const key of Object.keys(lowerBound)) {
      if (key !== "atLeast") {
        throw new TypeError(`calledTool() options.count does not support key ${JSON.stringify(key)}`);
      }
    }
    if (lowerBound.atLeast === 0) {
      throw new TypeError("calledTool() options.count.atLeast must be a positive safe integer; use notCalledTool() for zero");
    }
    if (!Number.isSafeInteger(lowerBound.atLeast) || typeof lowerBound.atLeast !== "number" || lowerBound.atLeast < 0) {
      throw new TypeError("calledTool() options.count.atLeast must be a positive safe integer");
    }
    return Object.freeze({ kind: "at-least" as const, count: lowerBound.atLeast });
  }
  throw new TypeError("calledTool() options.count must be a positive safe integer or { atLeast: positive safe integer }");
}

function toolScopeCoverageReason(snapshot: ToolScopeSnapshot): string | undefined {
  const actions = snapshot.coverage.actions;
  // Missing command/not-command classification limits commandMatch(), not the
  // completeness of the already captured tool occurrence set. Tool name/input/
  // lifecycle counts remain decidable; commandMatch itself retains unavailable
  // evidence when an occurrence has no command projection.
  if (
    actions.status !== "complete"
    && actions.reason !== UNCLASSIFIED_TOOL_ACTIONS_REASON
  ) {
    return `scope-actions-${actions.status}:${actions.reason}`;
  }
  if (snapshot.orphanFinishes.length > 0) {
    return `orphan-tool-finish:${snapshot.orphanFinishes.length}`;
  }
  return undefined;
}

function unavailableMatcherCandidate(
  reason: string,
): BooleanMatchEvaluation<never> {
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

function registerCollectionCheck<Kind extends RuntimeKind, Subject>(
  runtime: AssertionsRuntime<Kind>,
  subject: Subject,
  match: unknown,
): BooleanAssertionHandle<Kind, void> {
  return runtime.registerBoolean(collectionMatchRegistration(subject, match)) as BooleanAssertionHandle<Kind, void>;
}

function calledToolHandle<Kind extends RuntimeKind>(input: {
  readonly runtime: AssertionsRuntime<Kind>;
  readonly subject: ManagedToolCalls;
  readonly target: ToolMatch | string;
  readonly options: CalledToolOptions | undefined;
}): BooleanAssertionHandle<Kind, void> {
  const match = resolveToolTarget(input.target, "calledTool");
  const quantifier = normalizeCalledToolOptions(input.options);
  const collectionMatch = quantifier.kind === "at-least"
    ? quantifier.count === 1
      ? match
      : match.atLeast(quantifier.count)
    : match.exactly(quantifier.count);
  return registerCollectionCheck(
    input.runtime,
    input.subject,
    collectionMatch,
  );
}

function notCalledToolHandle<Kind extends RuntimeKind>(input: {
  readonly runtime: AssertionsRuntime<Kind>;
  readonly subject: ManagedToolCalls;
  readonly target: ToolMatch | string;
}): BooleanAssertionHandle<Kind, void> {
  return registerCollectionCheck(
    input.runtime,
    input.subject,
    resolveToolTarget(input.target, "notCalledTool").exactly(0),
  );
}

function valueMatchCriterion(): AssertionCriterion {
  return Object.freeze({
    kind: "value-match" as const,
    subject: "explicit-value" as const,
    matcher: Object.freeze({ state: "unavailable" as const }),
  });
}

function matchedVoid(): BooleanAssertionEvaluation<void> {
  return Object.freeze({ state: "matched" as const, value: undefined });
}

function mismatchedVoid(): BooleanAssertionEvaluation<void> {
  return Object.freeze({ state: "mismatched" as const });
}

function unavailableVoid(): BooleanAssertionEvaluation<void> {
  return Object.freeze({ state: "unavailable" as const, reason: "evidence-unavailable" as const });
}

function scopedBooleanHandle<Kind extends RuntimeKind>(input: {
  readonly runtime: AssertionsRuntime<Kind>;
  readonly criterion: AssertionCriterion;
  readonly snapshot: unknown;
  readonly interruptedMatcherArtifact?: import("../assertions/api.ts").MatcherQueryArtifact;
  readonly evaluate: () => Effect.Effect<BooleanAssertionEvaluation<void>, unknown, never>;
}): BooleanAssertionHandle<Kind, void> {
  const captured = captureAssertionSnapshot(input.snapshot);
  return input.runtime.registerBoolean<void>({
    criterion: input.criterion,
    subject: captured.material,
    coverage: captured.coverage,
    limitations: captured.limitations,
    ...(input.interruptedMatcherArtifact === undefined
      ? {}
      : { interruptedMatcherArtifact: input.interruptedMatcherArtifact }),
    evaluate: input.evaluate,
  });
}

function hasCompleteCoverage(
  coverage: ScopeCoverage,
  channel: "actions" | "events" | "usage",
): boolean {
  return coverage[channel].status === "complete";
}

function assertNonNegativeFinite(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label} must be a finite non-negative number`);
  }
}

function assertNonNegativeSafeInteger(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
}

function usedNoToolsHandle<Kind extends RuntimeKind>(input: {
  readonly runtime: AssertionsRuntime<Kind>;
  readonly subject: ManagedToolCalls;
}): BooleanAssertionHandle<Kind, void> {
  return registerCollectionCheck(
    input.runtime,
    input.subject,
    toolMatch({}).exactly(0),
  );
}

function maxToolCallsHandle<Kind extends RuntimeKind>(input: {
  readonly runtime: AssertionsRuntime<Kind>;
  readonly subject: ManagedToolCalls;
  readonly max: number;
}): BooleanAssertionHandle<Kind, void> {
  assertNonNegativeSafeInteger(input.max, "maxToolCalls() max");
  return registerCollectionCheck(input.runtime, input.subject, atMost(input.max));
}

function noFailedActionsHandle<Kind extends RuntimeKind>(input: {
  readonly runtime: AssertionsRuntime<Kind>;
  readonly scope: AssertionScope;
  readonly events: readonly StreamEvent[];
  readonly coverage: ScopeCoverage;
  readonly snapshot: unknown;
}): BooleanAssertionHandle<Kind, void> {
  return scopedBooleanHandle({
    runtime: input.runtime,
    criterion: scopeCriterion(input.scope, "no-failed-actions"),
    snapshot: Object.freeze({
      scope: input.scope,
      assertion: "no-failed-actions",
      eventCount: input.events.length,
      coverage: input.coverage.actions,
      snapshot: input.snapshot,
    }),
    evaluate: () => Effect.sync(() => {
      const facts = deriveRunFacts(input.events);
      const failed = facts.toolCalls.some((call) => call.status === "failed")
        || facts.subagentCalls.some((call) => call.status === "failed");
      if (failed) return mismatchedVoid();
      return hasCompleteCoverage(input.coverage, "actions")
        ? matchedVoid()
        : unavailableVoid();
    }),
  });
}

function usageLimitHandle<Kind extends RuntimeKind>(input: {
  readonly runtime: AssertionsRuntime<Kind>;
  readonly scope: AssertionScope;
  readonly maximum: number;
  readonly usage: Usage;
  readonly coverage: ScopeCoverage;
  readonly snapshot: unknown;
} & (
  | { readonly metric: "tokens" }
  | {
      readonly metric: "cost";
      /** observed usage.costUSD 不进入预算断言。 */
      readonly pricing: PricingEstimateResult;
    }
)): BooleanAssertionHandle<Kind, void> {
  assertNonNegativeFinite(input.maximum, input.metric === "tokens" ? "maxTokens() max" : "maxCost() usd");
  // observed usage.costUSD intentionally never enters this material. Cost is
  // sealed from the pricing receipt; tokens exclude cache buckets by contract.
  const tokenBuckets = [input.usage.inputTokens, input.usage.outputTokens] as const;
  const recordedTokenBuckets = tokenBuckets.filter((value): value is number => value !== undefined);
  const tokenInputInvalid = recordedTokenBuckets.some((value) => !Number.isFinite(value) || value < 0);
  const tokenValue = recordedTokenBuckets.reduce((sum, value) => sum + value, 0);
  const tokenMaterial = tokenInputInvalid
    ? Object.freeze({ state: "unavailable" as const, reason: "usage-input-invalid" })
    : recordedTokenBuckets.length === 0
    ? Object.freeze({ state: "unavailable" as const, reason: "usage-not-recorded" })
    : recordedTokenBuckets.length === tokenBuckets.length && input.coverage.usage.status === "complete"
    ? Object.freeze({ state: "exact" as const, value: tokenValue })
    : Object.freeze({ state: "lower-bound" as const, value: tokenValue });
  const material = input.metric === "tokens"
    ? tokenMaterial
    : input.pricing.state === "unavailable"
    ? Object.freeze({ state: "unavailable" as const, reason: input.pricing.reason })
    : input.pricing.receipt.charges.length === 4 && input.coverage.usage.status === "complete"
    ? Object.freeze({ state: "exact" as const, value: input.pricing.receipt.amountUSD })
    : Object.freeze({ state: "lower-bound" as const, value: input.pricing.receipt.amountUSD });
  const derivation = input.metric === "tokens"
    ? Object.freeze({
        kind: "usage-token-sum" as const,
        buckets: Object.freeze([
          ...(input.usage.inputTokens === undefined ? [] : ["inputTokens"]),
          ...(input.usage.outputTokens === undefined ? [] : ["outputTokens"]),
        ]),
        missingBuckets: Object.freeze([
          ...(input.usage.inputTokens === undefined ? ["inputTokens"] : []),
          ...(input.usage.outputTokens === undefined ? ["outputTokens"] : []),
        ]),
      })
    : input.pricing.state === "available"
    ? input.pricing.receipt
    : Object.freeze({ kind: "pricing-estimate-unavailable" as const, reason: input.pricing.reason });
  const captured = captureAssertionSnapshot(Object.freeze({
    ...material,
    cut: input.snapshot,
    coverage: input.coverage.usage,
    derivation,
  }));
  const semanticCapture = material.state === "unavailable"
    ? Object.freeze({
        ...captured,
        coverage: Object.freeze({ state: "unavailable" as const, reason: "source-unavailable" as const }),
        limitations: Object.freeze([]),
      })
    : material.state === "lower-bound" && captured.coverage.state === "complete"
    ? Object.freeze({
        ...captured,
        coverage: Object.freeze({ state: "partial" as const, reason: "provider-limited" as const }),
        limitations: Object.freeze([{ kind: "provider-limited" as const }]),
      })
    : captured;
  const criterionSubject = input.metric === "tokens"
    ? Object.freeze({
        kind: "scope-metric" as const,
        metric: "tokens" as const,
        scope: input.scope,
        unit: "tokens" as const,
      })
    : Object.freeze({
        kind: "scope-metric" as const,
        metric: "cost" as const,
        scope: input.scope,
        unit: "usd" as const,
      });
  return input.runtime.registerBoolean(numericBooleanRegistration({
    match: atMost(input.maximum),
    criterionSubject,
    material,
    captured: semanticCapture,
    matchedValue: () => undefined,
  }));
}

function orderedMatchList<Match>(
  value: readonly Match[],
  label: string,
  assertMatch: (value: unknown, label: string) => Match,
): readonly Match[] {
  if (!Array.isArray(value) || value.length < 2) {
    throw new TypeError(`${label} requires at least two Match values`);
  }
  return Object.freeze(value.map((match, index) => assertMatch(match, `${label} match ${index + 1}`)));
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

function toolOrderHandle<Kind extends RuntimeKind>(input: {
  readonly runtime: AssertionsRuntime<Kind>;
  readonly subject: ManagedToolCalls<"turn"> | ManagedToolCalls<"session">;
  readonly matches: readonly [ToolMatch, ToolMatch, ...ToolMatch[]];
}): BooleanAssertionHandle<Kind, void> {
  return registerCollectionCheck(input.runtime, input.subject, inOrder(input.matches));
}

function managedToolCalls(
  scope: AssertionScope,
  snapshot: ToolScopeSnapshot,
): ManagedToolCalls {
  return freezeManagedToolCalls({
    scope,
    sourceSnapshot: snapshot.sourceSnapshot,
    rows: snapshot.rows,
    incompleteReason: toolScopeCoverageReason(snapshot),
    actionsCoverage: snapshot.coverage.actions,
    orphanFinishCount: snapshot.orphanFinishes.length,
    snapshot: snapshot.snapshot,
  });
}

interface EventScopeSnapshot {
  readonly events: readonly MatchableEvent[];
  readonly rows: readonly MatcherSourceRow<ProjectedMatcherCandidate<MatchableEvent>>[];
  readonly unassociatedOperation: boolean;
  readonly sourceSnapshot: MatcherSourceSnapshot;
  readonly coverage: ScopeCoverage;
  readonly snapshot: unknown;
}

function eventLocator(row: ObservedEventLedgerRow): MatcherSourceLocator {
  if (row.event.kind === "tool-start") {
    return Object.freeze({
      kind: "event" as const,
      eventId: row.eventId,
      toolOccurrenceId: row.event.toolOccurrenceId,
      relation: Object.freeze({ state: "exact" as const }),
    });
  }
  if (row.event.kind === "tool-finish") {
    return row.event.occurrence.state === "exact"
      ? Object.freeze({
          kind: "event" as const,
          eventId: row.eventId,
          toolOccurrenceId: row.event.occurrence.toolOccurrenceId,
          relation: Object.freeze({ state: "exact" as const }),
        })
      : Object.freeze({
          kind: "event" as const,
          eventId: row.eventId,
          relation: Object.freeze({
            state: "unavailable" as const,
            reason: "ambiguous" as const,
          }),
        });
  }
  return Object.freeze({
    kind: "event" as const,
    eventId: row.eventId,
    relation: Object.freeze({ state: "exact" as const }),
  });
}

function projectEventScope(input: {
  readonly turns: readonly MatcherScopeTurn[];
  readonly sourceSnapshot: MatcherSourceSnapshot;
  readonly coverage: ScopeCoverage;
  readonly snapshot: unknown;
  readonly resolveEvaluation: ResolveObservedEvaluation;
}): EventScopeSnapshot {
  const projection = projectMatcherSources(input.turns, input.resolveEvaluation);
  const sourceSnapshot = projection.state === "invalid"
    ? unavailableSourceSnapshot(input.sourceSnapshot)
    : input.sourceSnapshot;
  const turnIndex = new Map(input.turns.map((turn, index) => [turn.observed.turnId, index]));
  const rows: MatcherSourceRow<ProjectedMatcherCandidate<MatchableEvent>>[] = [];
  for (const row of projection.events) {
    if (row.event.kind !== "message" && row.event.kind !== "tool-start" && row.event.kind !== "tool-finish") {
      continue;
    }
    const turnOrdinal = turnIndex.get(row.turnId);
    const sourceTurn = turnOrdinal === undefined ? undefined : input.turns[turnOrdinal];
    const segment = sourceTurn === undefined ? undefined : input.resolveEvaluation(sourceTurn.observed);
    const eventOrdinal = segment?.items.findIndex((event) => event.eventId === row.eventId) ?? -1;
    let candidate: ProjectedMatcherCandidate<MatchableEvent>;
    if (sourceTurn === undefined || eventOrdinal < 0) {
      candidate = Object.freeze({
        state: "unavailable" as const,
        reason: "source-event-material-unavailable",
      });
    } else if (row.event.kind === "message") {
      candidate = Object.freeze({
        state: "available" as const,
        value: makeAssertionMessageEvent({
          eventId: row.eventId,
          session: row.sessionId,
          turn: row.turnId,
          turnOrdinal: (turnOrdinal ?? 0) + 1,
          eventOrdinal,
          role: row.event.role,
          text: row.event.text,
        }),
      });
    } else {
      const toolOccurrenceId = row.event.kind === "tool-start"
        ? row.event.toolOccurrenceId
        : row.event.occurrence.state === "exact"
        ? row.event.occurrence.toolOccurrenceId
        : undefined;
      const occurrence = toolOccurrenceId === undefined
        ? undefined
        : projection.occurrenceCandidates.get(toolOccurrenceId);
      const rawEvent = projection.eventMaterial.get(row.eventId);
      if (
        occurrence === undefined ||
        rawEvent === undefined ||
        (row.event.kind === "tool-finish" &&
          (rawEvent.type !== "operation.finished" || rawEvent.kind !== "tool"))
      ) {
        candidate = Object.freeze({
          state: "unavailable" as const,
          reason: "tool-event-relation-unavailable",
        });
      } else {
        candidate = Object.freeze({
          state: "available" as const,
          value: makeAssertionToolEvent({
            eventId: row.eventId,
            toolOccurrenceId,
            session: row.sessionId,
            turn: row.turnId,
            turnOrdinal: (turnOrdinal ?? 0) + 1,
            eventOrdinal,
            type: row.event.kind === "tool-start"
              ? "operation.started" as const
              : "operation.finished" as const,
            occurrence,
            ...(row.event.kind === "tool-finish" && rawEvent.type === "operation.finished" && rawEvent.kind === "tool"
              ? { status: rawEvent.status }
              : {}),
          }),
        });
      }
    }
    rows.push(Object.freeze({
      locator: eventLocator(row),
      sessionId: row.sessionId,
      sessionSequence: row.sessionSequence,
      candidate,
    }));
  }
  const immutableRows = Object.freeze(rows);
  return Object.freeze({
    events: Object.freeze(immutableRows.flatMap((row) =>
      row.candidate.state === "available" ? [row.candidate.value] : []
    )),
    rows: immutableRows,
    unassociatedOperation: projection.state === "invalid" || immutableRows.some(
      (row) => row.candidate.state === "unavailable",
    ),
    sourceSnapshot,
    coverage: input.coverage,
    snapshot: input.snapshot,
  });
}

function eventMatchEvaluation(
  event: MatchableEvent,
  result: BooleanMatchEvaluation<unknown>,
): BooleanMatchEvaluation<unknown> {
  const occurrence = assertionEventOccurrence(event);
  return occurrence === undefined ? result : toolMatchEvaluation(occurrence, result);
}

function eventMatcherQuery(
  match: EventMatch,
  summary: import("../assertions/api.ts").AssertionSnapshotValue = Object.freeze({
    matcher: match.name,
  }),
): MatcherQuery<ProjectedMatcherCandidate<MatchableEvent>> {
  return Object.freeze({
    summary,
    evaluate: async (
      candidate: ProjectedMatcherCandidate<MatchableEvent>,
    ) => candidate.state === "unavailable"
      ? unavailableMatcherCandidate(candidate.reason)
      : eventMatchEvaluation(
          candidate.value,
          await evaluateBooleanMatch(match, candidate.value),
        ),
  });
}

function normalizeEventCount(value: EventOptions | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("event() options must be an object");
  }
  const options = value as globalThis.Record<string, unknown>;
  for (const key of Object.keys(options)) {
    if (key !== "count") throw new TypeError(`event() options does not support option ${JSON.stringify(key)}`);
  }
  if (options.count === undefined) return undefined;
  if (!Number.isSafeInteger(options.count) || typeof options.count !== "number" || options.count <= 0) {
    throw new TypeError("event() options.count must be a positive safe integer; use notEvent() for zero");
  }
  return options.count;
}

function eventAssertionHandle<Kind extends RuntimeKind>(input: {
  readonly runtime: AssertionsRuntime<Kind>;
  readonly scope: AssertionScope;
  readonly match: EventMatch;
  readonly count: number | undefined;
  readonly snapshot: EventScopeSnapshot;
}): BooleanAssertionHandle<Kind, void> {
  const quantifier: ToolMatchQuantifier = input.count === undefined
    ? Object.freeze({ kind: "at-least" as const, count: 1 })
    : Object.freeze({ kind: "exact" as const, count: input.count });
  const query = eventMatcherQuery(input.match, Object.freeze({
    matcher: input.match.name,
    quantifier,
  }));
  const interrupted = interruptedMatcherArtifact({
    sourceSnapshot: input.snapshot.sourceSnapshot,
    sourceRows: input.snapshot.rows.length,
    queries: Object.freeze([query.summary]),
    kind: "collection-filter",
  });
  return scopedBooleanHandle({
    runtime: input.runtime,
    criterion: occurrenceCriterion(input.scope, "event", input.match.name, quantifier),
    snapshot: Object.freeze({
      scope: input.scope,
      occurrence: "event",
      matcher: input.match.name,
      quantifier,
      candidateCount: input.snapshot.rows.length,
      unassociatedOperation: input.snapshot.unassociatedOperation,
      coverage: input.snapshot.coverage.events,
      snapshot: input.snapshot.snapshot,
    }),
    interruptedMatcherArtifact: interrupted,
    evaluate: () => Effect.tryPromise({
      try: () => evaluateMatcherCollection({
        sourceSnapshot: input.snapshot.sourceSnapshot,
        rows: input.snapshot.rows,
        query,
        quantifier,
      }),
      catch: (error) => error,
    }),
  });
}

function notEventHandle<Kind extends RuntimeKind>(input: {
  readonly runtime: AssertionsRuntime<Kind>;
  readonly scope: AssertionScope;
  readonly match: EventMatch;
  readonly snapshot: EventScopeSnapshot;
}): BooleanAssertionHandle<Kind, void> {
  const quantifier = Object.freeze({ kind: "absent" as const });
  const query = eventMatcherQuery(input.match, Object.freeze({
    matcher: input.match.name,
    quantifier,
  }));
  const interrupted = interruptedMatcherArtifact({
    sourceSnapshot: input.snapshot.sourceSnapshot,
    sourceRows: input.snapshot.rows.length,
    queries: Object.freeze([query.summary]),
    kind: "collection-filter",
  });
  return scopedBooleanHandle({
    runtime: input.runtime,
    criterion: occurrenceCriterion(
      input.scope,
      "event",
      input.match.name,
      quantifier,
    ),
    snapshot: Object.freeze({
      scope: input.scope,
      occurrence: "event",
      matcher: input.match.name,
      quantifier,
      candidateCount: input.snapshot.rows.length,
      unassociatedOperation: input.snapshot.unassociatedOperation,
      coverage: input.snapshot.coverage.events,
      snapshot: input.snapshot.snapshot,
    }),
    interruptedMatcherArtifact: interrupted,
    evaluate: () => Effect.tryPromise({
      try: () => evaluateMatcherCollection({
        sourceSnapshot: input.snapshot.sourceSnapshot,
        rows: input.snapshot.rows,
        query,
        quantifier,
      }),
      catch: (error) => error,
    }),
  });
}

function eventOrderHandle<Kind extends RuntimeKind>(input: {
  readonly runtime: AssertionsRuntime<Kind>;
  readonly scope: AssertionScope;
  readonly matches: readonly EventMatch[];
  readonly snapshot: EventScopeSnapshot;
}): BooleanAssertionHandle<Kind, void> {
  const matches = orderedMatchList(input.matches, "eventOrder()", assertManagedEventMatch);
  const orderedSourceSnapshot = input.snapshot.sourceSnapshot;
  if (orderedSourceSnapshot.scope === "attempt") {
    throw new TypeError("eventOrder() is unavailable at Attempt scope");
  }
  const queries = Object.freeze(matches.map(eventMatcherQuery));
  const interrupted = interruptedMatcherArtifact({
    sourceSnapshot: orderedSourceSnapshot,
    sourceRows: input.snapshot.rows.length,
    queries: Object.freeze(queries.map((query) => query.summary)),
    kind: "ordered-sequence",
  });
  return scopedBooleanHandle({
    runtime: input.runtime,
    criterion: valueMatchCriterion(),
    snapshot: Object.freeze({
      scope: input.scope,
      assertion: "event-order",
      matches: matches.map((match) => match.name),
      candidateCount: input.snapshot.rows.length,
      unassociatedOperation: input.snapshot.unassociatedOperation,
      coverage: input.snapshot.coverage.events,
      snapshot: input.snapshot.snapshot,
    }),
    interruptedMatcherArtifact: interrupted,
    evaluate: () => Effect.tryPromise({
      try: () => evaluateMatcherOrder({
        sourceSnapshot: orderedSourceSnapshot,
        rows: input.snapshot.rows,
        queries,
      }),
      catch: (error) => error,
    }),
  });
}

function judgeCriterion(recipe: JudgeRecipe): AssertionCriterion {
  return Object.freeze({
    kind: "judge-measurement" as const,
    recipe: recipe === "closedQA" ? "closed-qa" as const : recipe,
    scale: "unit-interval" as const,
  });
}

function judgeHandle<Kind extends RuntimeKind>(input: {
  readonly runtime: AssertionsRuntime<Kind>;
  readonly judge: ResolvedJudgeConfig | undefined;
  readonly signal: AbortSignal;
  readonly recipe: JudgeRecipe;
  readonly reference: string;
  readonly material: JudgeMaterial;
}): MeasurementAssertionHandle<Kind> {
  const judge = input.judge;
  assertJudgeCapability(judge);
  if (typeof input.reference !== "string" || input.reference.trim() === "") {
    throw new TypeError("Judge recipe reference must be a non-empty string");
  }
  const material = freezeJudgeMaterial(input.material);
  const captured = captureAssertionSnapshot({
    recipe: input.recipe,
    reference: input.reference,
    input: material.input,
    output: material.output,
  });
  return input.runtime.registerMeasurement({
    criterion: judgeCriterion(input.recipe),
    subject: captured.material,
    coverage: captured.coverage,
    limitations: captured.limitations,
    evaluate: () => evaluateJudgeMeasurement({
      judge,
      recipe: input.recipe,
      reference: input.reference,
      material,
      signal: input.signal,
    }),
  });
}

const DIFF_REFERENCE_PREVIEW = "agent-attributed send-window endpoint deltas";

function changedPathsCriterion(paths: readonly string[]): AssertionCriterion {
  return Object.freeze({
    kind: "sandbox-result" as const,
    operation: "changed-paths" as const,
    paths: Object.freeze([...paths]),
  });
}

function noChangesCriterion(): AssertionCriterion {
  return Object.freeze({
    kind: "sandbox-result" as const,
    operation: "no-changes" as const,
  });
}

function fileChangedCriterion(
  path: string,
  options: Readonly<FileChangedOptions>,
): AssertionCriterion {
  return Object.freeze({
    kind: "sandbox-result" as const,
    operation: "file-changed" as const,
    path,
    ...(options.status === undefined ? {} : { status: options.status }),
    ...(options.before === undefined ? {} : { before: options.before.name }),
    ...(options.after === undefined ? {} : { after: options.after.name }),
  });
}

function fileDeletedCriterion(path: string): AssertionCriterion {
  return Object.freeze({
    kind: "sandbox-result" as const,
    operation: "file-deleted" as const,
    path,
  });
}

function notInDiffCriterion(
  pattern: RegExp,
  options: Readonly<WorkspaceDiffNotInOptions>,
): AssertionCriterion {
  return Object.freeze({
    kind: "sandbox-result" as const,
    operation: "not-in-diff" as const,
    pattern: pattern.source,
    flags: pattern.flags,
    content: options.content ?? "both",
  });
}

function diffReferenceMaterial(): AssertionMaterial {
  return Object.freeze({
    kind: "record-attachment" as const,
    preview: DIFF_REFERENCE_PREVIEW,
  });
}

function assertDiffPath(path: unknown, operation: string): asserts path is string {
  assertCanonicalWorkspaceRelativePath(path, `${operation} path`);
}

function normalizeFileChangedOptions(
  value: FileChangedOptions | undefined,
): Readonly<FileChangedOptions> {
  if (value === undefined) return Object.freeze({});
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("fileChanged() options must be an object");
  }
  for (const key of Object.keys(value)) {
    if (key !== "status" && key !== "before" && key !== "after") {
      throw new TypeError(`fileChanged() options has unknown key ${JSON.stringify(key)}`);
    }
  }
  if (
    value.status !== undefined
    && value.status !== "added"
    && value.status !== "modified"
    && value.status !== "deleted"
  ) {
    throw new TypeError("fileChanged() options.status must be added, modified, or deleted");
  }
  return Object.freeze({ ...value });
}

function normalizeNotInDiffOptions(
  value: WorkspaceDiffNotInOptions | undefined,
): Readonly<WorkspaceDiffNotInOptions> {
  if (value === undefined) return Object.freeze({});
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("notInDiff() options must be an object");
  }
  for (const key of Object.keys(value)) {
    if (key !== "content") throw new TypeError(`notInDiff() options has unknown key ${JSON.stringify(key)}`);
  }
  if (value.content !== undefined && value.content !== "added" && value.content !== "removed" && value.content !== "both") {
    throw new TypeError("notInDiff() options.content must be added, removed, or both");
  }
  return Object.freeze({ ...value });
}

async function endpointMatches(
  endpoint: AgentWorkspaceDiffEndpoint,
  match: BooleanMatch<string, string, "value"> | undefined,
): Promise<"matched" | "mismatched" | "unavailable"> {
  if (match === undefined) return "matched";
  if (endpoint.state === "absent") return "mismatched";
  if (endpoint.state === "elided") return "unavailable";
  const result = await evaluateBooleanMatch(match, endpoint.text);
  return result.state;
}

function unavailableDiffResult() {
  return Object.freeze({ state: "unavailable" as const, reason: "source-unavailable" as const });
}

/**
 * Wraps a raw Sandbox capability with post-run Assertion registration. The
 * wrapper has no generic diff value: every call immediately declares exactly
 * one Assertion whose closure reads the single Attempt-owned frozen document.
 */
function createAssertFirstSandbox<Kind extends RuntimeKind>(input: {
  readonly agent: Agent;
  readonly sandbox: Sandbox;
  readonly runtime: AssertionsRuntime<Kind>;
  readonly late: AssertFirstLateResult;
}): AssertFirstSandbox<Kind> {
  const requireCapability = (): void => {
    if (input.agent.kind !== "sandbox") {
      throw new Error(
        `Agent ${JSON.stringify(input.agent.name)} does not provide sandbox; agent-attributed workspace diff Assertions are unavailable.`,
      );
    }
  };
  const register = (
    criterion: AssertionCriterion,
    evaluate: () => Effect.Effect<
      BooleanAssertionEvaluation<void>,
      unknown,
      never
    >,
  ): PostRunBooleanAssertionHandle<Kind, void> => postRunBooleanAssertionHandle(
    input.runtime.registerBoolean<void>({
      criterion,
      subject: diffReferenceMaterial(),
      evaluate,
    }),
    input.runtime.evaluationKind,
  );

  const changedPaths = (paths: readonly string[]): PostRunBooleanAssertionHandle<Kind, void> => {
    requireCapability();
    if (!Array.isArray(paths)) throw new TypeError("changedPaths() requires an array of paths");
    for (const path of paths) assertDiffPath(path, "changedPaths()");
    validateExpectedTouchedPaths(paths);
    const expected = Object.freeze([...paths]);
    return register(changedPathsCriterion(expected), () => Effect.sync(() => {
      const diff = input.late.diff;
      if (diff.state !== "available") return unavailableDiffResult();
      return agentWorkspaceDiffPathsMatch(diff.document, expected)
        ? Object.freeze({ state: "matched" as const, value: undefined })
        : Object.freeze({ state: "mismatched" as const });
    }));
  };

  const fileChanged = (
    path: string,
    rawOptions?: FileChangedOptions,
  ): PostRunBooleanAssertionHandle<Kind, void> => {
    requireCapability();
    assertDiffPath(path, "fileChanged()");
    const options = normalizeFileChangedOptions(rawOptions);
    return register(fileChangedCriterion(path, options), () => Effect.tryPromise({
      try: async () => {
        const diff = input.late.diff;
        if (diff.state !== "available") return unavailableDiffResult();
        let unavailable = false;
        for (const candidate of agentWorkspaceDiffChangesForPath(diff.document, path)) {
          if (options.status !== undefined && candidate.status !== options.status) continue;
          const before = await endpointMatches(candidate.before, options.before);
          const after = await endpointMatches(candidate.after, options.after);
          if (before === "matched" && after === "matched") {
            return Object.freeze({ state: "matched" as const, value: undefined });
          }
          // Both endpoint constraints belong to this one WindowChange. A
          // cross-send restore therefore remains visible, while a same-send
          // restore never became a ledger endpoint delta in the first place.
          if (before === "mismatched" || after === "mismatched") continue;
          if (before === "unavailable" || after === "unavailable") unavailable = true;
        }
        return unavailable
          ? unavailableDiffResult()
          : Object.freeze({ state: "mismatched" as const });
      },
      catch: (error) => error,
    }));
  };

  const notInDiff = (
    pattern: RegExp,
    rawOptions?: WorkspaceDiffNotInOptions,
  ): PostRunBooleanAssertionHandle<Kind, void> => {
    requireCapability();
    if (!(pattern instanceof RegExp)) throw new TypeError("notInDiff() pattern must be a RegExp");
    const options = normalizeNotInDiffOptions(rawOptions);
    return register(notInDiffCriterion(pattern, options), () => Effect.sync(() => {
      const diff = input.late.diff;
      if (diff.state !== "available") return unavailableDiffResult();
      const result = evaluateWorkspaceDiffNotIn(diff.document, pattern, options);
      return result.state === "matched"
        ? Object.freeze({ state: "matched" as const, value: undefined })
        : result.state === "mismatched"
          ? Object.freeze({ state: "mismatched" as const })
          : unavailableDiffResult();
    }));
  };

  const noChanges = (): PostRunBooleanAssertionHandle<Kind, void> => {
    requireCapability();
    return register(noChangesCriterion(), () => Effect.sync(() => {
      const diff = input.late.diff;
      if (diff.state !== "available") return unavailableDiffResult();
      return agentWorkspaceDiffPathsMatch(diff.document, [])
        ? Object.freeze({ state: "matched" as const, value: undefined })
        : Object.freeze({ state: "mismatched" as const });
    }));
  };
  const fileDeleted = (path: string): PostRunBooleanAssertionHandle<Kind, void> => {
    requireCapability();
    assertDiffPath(path, "fileDeleted()");
    return register(fileDeletedCriterion(path), () => Effect.sync(() => {
      const diff = input.late.diff;
      if (diff.state !== "available") return unavailableDiffResult();
      return agentWorkspaceDiffChangesForPath(diff.document, path)
        .some((change) => change.status === "deleted")
        ? Object.freeze({ state: "matched" as const, value: undefined })
        : Object.freeze({ state: "mismatched" as const });
    }));
  };
  const view: AssertFirstSandbox<Kind> = {
    get workdir() {
      requireCapability();
      return input.sandbox.workdir;
    },
    runCommand: (cmd, args, options) => {
      requireCapability();
      return input.sandbox.runCommand(cmd, args, options);
    },
    runShell: (script, options) => {
      requireCapability();
      return input.sandbox.runShell(script, options);
    },
    runCommandOrThrow: (cmd, args, options) => {
      requireCapability();
      return input.sandbox.runCommandOrThrow(cmd, args, options);
    },
    runShellOrThrow: (script, options) => {
      requireCapability();
      return input.sandbox.runShellOrThrow(script, options);
    },
    readText: (path) => {
      requireCapability();
      return input.sandbox.readText(path);
    },
    writeText: (path, content) => {
      requireCapability();
      return input.sandbox.writeText(path, content);
    },
    readBytes: (path) => {
      requireCapability();
      return input.sandbox.readBytes(path);
    },
    writeBytes: (path, content) => {
      requireCapability();
      return input.sandbox.writeBytes(path, content);
    },
    pathExists: (path) => {
      requireCapability();
      return input.sandbox.pathExists(path);
    },
    upload: (content, targetPath) => {
      requireCapability();
      return input.sandbox.upload(content, targetPath);
    },
    uploadFile: (source, targetPath) => {
      requireCapability();
      return input.sandbox.uploadFile(source, targetPath);
    },
    uploadDirectory: (sourceDir, targetDir, options) => {
      requireCapability();
      return input.sandbox.uploadDirectory(sourceDir, targetDir, options);
    },
    downloadFile: (sourcePath, target) => {
      requireCapability();
      return input.sandbox.downloadFile(sourcePath, target);
    },
    downloadDirectory: (sourceDir, targetDir, options) => {
      requireCapability();
      return input.sandbox.downloadDirectory(sourceDir, targetDir, options);
    },
    changedPaths,
    noChanges,
    fileChanged,
    fileDeleted,
    notInDiff,
  };
  Object.setPrototypeOf(view, null);
  return Object.freeze(view);
}

function requireInputRequest(
  session: RunSession,
  filter: InputRequestFilter | undefined,
): InputRequest {
  const matches = session.pendingInputRequests.filter((request) => {
    if (filter === undefined) return true;
    if (filter.id !== undefined && !matchesText(request.id ?? "", filter.id)) return false;
    if (filter.prompt !== undefined && !matchesText(request.prompt ?? "", filter.prompt)) return false;
    if (filter.display !== undefined && !matchesText(request.display ?? "", filter.display)) return false;
    if (filter.action !== undefined && !matchesText(request.action ?? "", filter.action)) return false;
    if (filter.input !== undefined && !matchesJson(request.input, filter.input)) return false;
    if (filter.optionIds !== undefined) {
      const options = new Set((request.options ?? []).map((option) => option.id));
      if (options.size !== filter.optionIds.length || !filter.optionIds.every((id) => options.has(id))) return false;
    }
    return true;
  });
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one pending input request, found ${matches.length}`);
  }
  return matches[0]!;
}

function matchesText(actual: string, expected: string | RegExp): boolean {
  if (expected instanceof RegExp) {
    expected.lastIndex = 0;
    return expected.test(actual);
  }
  return actual === expected;
}

function requireRequestId(request: InputRequest): string {
  if (!request.id) throw new Error("Input request has no stable id");
  return request.id;
}

function validateOptionId(request: InputRequest, optionId: string): void {
  const ids = (request.options ?? []).map((option) => option.id);
  if (!ids.includes(optionId)) {
    throw new Error(`Option ${JSON.stringify(optionId)} is not available for this input request`);
  }
}

function resolveStringAnswer(session: RunSession, text: string): InputResponse {
  if (session.pendingInputRequests.length !== 1) {
    throw new Error(`A string response requires exactly one pending input request, found ${session.pendingInputRequests.length}`);
  }
  const request = session.pendingInputRequests[0]!;
  const requestId = requireRequestId(request);
  return (request.options ?? []).some((option) => option.id === text)
    ? { requestId, optionId: text }
    : { requestId, text };
}

function buildRespondInput(
  session: RunSession,
  answers: readonly (string | AssertFirstRespondAnswer)[],
): { readonly text: string; readonly responses: readonly InputResponse[] } {
  const text: string[] = [];
  const responses: InputResponse[] = [];
  for (const answer of answers) {
    if (typeof answer === "string") {
      text.push(answer);
      responses.push(resolveStringAnswer(session, answer));
      continue;
    }
    const requestId = requireRequestId(answer.request);
    if ((answer.optionId === undefined) === (answer.text === undefined)) {
      throw new Error("A structured response needs exactly one of optionId or text");
    }
    if (answer.optionId !== undefined) {
      validateOptionId(answer.request, answer.optionId);
      text.push(answer.optionId);
      responses.push({ requestId, optionId: answer.optionId });
    } else {
      text.push(answer.text!);
      responses.push({ requestId, text: answer.text! });
    }
  }
  return Object.freeze({ text: text.join("\n"), responses: Object.freeze(responses) });
}

function mimeTypeFor(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".gif": return "image/gif";
    case ".webp": return "image/webp";
    default: return "application/octet-stream";
  }
}

function readInputFileEffect(path: string): Effect.Effect<InputFile, unknown> {
  return Effect.tryPromise({
    try: () => readFile(path),
    catch: (error) => error,
  }).pipe(
    Effect.map((bytes) => Object.freeze({
      filename: basename(path),
      mimeType: mimeTypeFor(path),
      dataBase64: bytes.toString("base64"),
    })),
  );
}

/**
 * Creates the Context that Runner actually hands to `test(t)`. Its only
 * authoring state is the Attempt-local Assert-first runtime.
 */
export function createAssertFirstEvalContext(
  deps: AssertFirstContextDeps,
): { readonly context: AssertFirstTestContext<RuntimeKind>; readonly state: AssertFirstContextState } {
  const manager = new SessionManager({
    agent: deps.agent,
    sandbox: deps.sandbox,
    evalId: deps.evalId,
    attempt: deps.attempt,
    evalGroup: deps.evalGroup,
    model: deps.model,
    reasoningEffort: deps.reasoningEffort,
    flags: deps.flags,
    experimentId: deps.experimentId,
    signal: deps.signal,
    requestEffect: deps.requestEffect,
    log: deps.log,
    telemetry: deps.telemetry,
    otel: deps.otel,
    feedback: deps.feedback,
    onSendActive: deps.onSendActive,
    timingNow: deps.timingNow,
    onTurn: deps.onTurn,
    ledgerHooks: deps.ledgerHooks,
    concurrencySlot: deps.concurrencySlot,
    experimentClassifier: deps.experimentClassifier,
    nextSourceOrder: deps.nextSourceOrder,
    sourceRegistry: deps.sourceRegistry,
    resources: deps.resources,
  });
  const runtime: AssertionsRuntime<RuntimeKind> = deps.evaluationKind === "score"
    ? createAssertionsRuntime({ evaluationKind: "score", executeStop: deps.executeStop })
    : createAssertionsRuntime({ evaluationKind: "pass", executeStop: deps.executeStop });
  const state: AssertFirstContextState = {
    assertions: runtime,
    manager,
    late: { diff: Object.freeze({ state: "pending" as const }), scripts: {} },
  };
  const resolveObservedEvaluation: ResolveObservedEvaluation = (snapshot) =>
    manager.observedEvaluationSegment(snapshot);

  // maxCost 断言唯一认价目表估算(estimateCost);observed usage.costUSD 与之独立并存,
  // 存在也不改变估算(见 Usage.costUSD 单向字段契约)。
  const pricingEstimateFor = (usage: Usage): PricingEstimateResult =>
    pricingEstimate(deps.model, usage, deps.pricing);

  interface TurnScopeSnapshot {
    readonly events: readonly StreamEvent[];
    readonly toolCalls: ManagedToolCalls<"turn">;
    readonly toolScope: ToolScopeSnapshot;
    readonly status: "completed" | "failed" | "waiting";
    readonly coverage: ScopeCoverage;
    readonly input: string;
    readonly output: string;
  }

  interface SessionScopeState {
    readonly session: RunSession;
    readonly turns: MatcherScopeTurn[];
    started: boolean;
    inFlight: number;
    failed: boolean;
  }

  const sessions: SessionScopeState[] = [];
  const matcherSource = Object.freeze({
    family: "niceeval.agent-turns" as const,
    schemaVersion: 2,
  });
  const attemptScopeId = deps.attempt === undefined
    ? JSON.stringify(["niceeval.attempt-scope/1", manager.primary.sessionScopeId])
    : JSON.stringify([
        "niceeval.attempt-scope/1",
        deps.experimentId ?? null,
        deps.attempt.id,
        deps.attempt.index,
      ]);

  const collectionAtCut = (
    turns: readonly MatcherScopeTurn[],
    coverage: ScopeCoverage["actions" | "events"],
    allowUnclassifiedActions = false,
  ): "complete" | "partial" | "unavailable" => {
    if (coverage.status === "unavailable") return "unavailable";
    if (
      coverage.status === "partial" &&
      !(allowUnclassifiedActions && coverage.reason === UNCLASSIFIED_TOOL_ACTIONS_REASON)
    ) {
      return "partial";
    }
    return turns.every((turn) =>
        resolveObservedEvaluation(turn.observed)?.collectionAtCut === "complete"
      )
      ? "complete"
      : "unavailable";
  };

  const turnSourceSnapshot = (
    turn: MatcherScopeTurn,
    coverage: ScopeCoverage["actions" | "events"],
    allowUnclassifiedActions = false,
  ): Extract<MatcherSourceSnapshot, { readonly scope: "turn" }> => Object.freeze({
    scope: "turn" as const,
    sessionId: turn.observed.sessionId,
    turnId: turn.observed.turnId,
    scopeId: turn.observed.turnId,
    throughSessionSequence: turn.observed.throughSessionSequence,
    source: matcherSource,
    collectionAtCut: collectionAtCut([turn], coverage, allowUnclassifiedActions),
  });

  const sessionSourceSnapshot = (
    scope: SessionScopeState,
    coverage: ScopeCoverage["actions" | "events"],
    allowUnclassifiedActions = false,
  ): Extract<MatcherSourceSnapshot, { readonly scope: "session" }> => {
    const observed = scope.session.observedSnapshot();
    return Object.freeze({
      scope: "session" as const,
      sessionId: observed.sessionId,
      scopeId: observed.sessionId,
      throughSessionSequence: observed.throughSessionSequence,
      source: matcherSource,
      collectionAtCut: collectionAtCut(scope.turns, coverage, allowUnclassifiedActions),
    });
  };

  const attemptSourceSnapshot = (
    turns: readonly MatcherScopeTurn[],
    coverage: ScopeCoverage["actions" | "events"],
    allowUnclassifiedActions = false,
  ): Extract<MatcherSourceSnapshot, { readonly scope: "attempt" }> => Object.freeze({
    scope: "attempt" as const,
    scopeId: attemptScopeId,
    sessions: manager.observedAttemptCut().sessions,
    source: matcherSource,
    collectionAtCut: collectionAtCut(turns, coverage, allowUnclassifiedActions),
  });

  const coverageWhileInFlight = (coverage: ScopeCoverage): ScopeCoverage =>
    Object.freeze({
      ...coverage,
      actions: Object.freeze({ status: "partial" as const, reason: "scope-still-running" }),
      status: Object.freeze({ status: "partial" as const, reason: "scope-still-running" }),
    });

  const sessionCoverage = (scope: SessionScopeState): ScopeCoverage =>
    scope.inFlight === 0
      ? scope.session.evidenceCoverage
      : coverageWhileInFlight(scope.session.evidenceCoverage);

  const sessionStatus = (scope: SessionScopeState): ScopeStatus => {
    if (!scope.started) return "not-started";
    if (scope.inFlight > 0) return "waiting";
    return scope.failed ? "failed" : scope.session.lastStatus;
  };

  const attemptCoverage = (): ScopeCoverage => {
    const active = sessions.filter((scope) => scope.started);
    const coverage = active.length === 0
      ? manager.evidenceCoverage
      : active.some((scope) => scope.inFlight > 0)
        ? coverageWhileInFlight(manager.evidenceCoverage)
        : manager.evidenceCoverage;
    return coverage;
  };

  const attemptStatus = (): ScopeStatus => {
    const active = sessions.filter((scope) => scope.started);
    if (active.length === 0) return "not-started";
    const statuses = active.map(sessionStatus);
    if (statuses.includes("waiting")) return "waiting";
    if (statuses.includes("failed")) return "failed";
    return "completed";
  };

  const sessionSnapshot = (scope: SessionScopeState) => Object.freeze({
    sessionIndex: scope.session.index,
    turnCount: scope.session.turnCount,
    status: sessionStatus(scope),
    coverage: sessionCoverage(scope),
  });

  const attemptSnapshot = () => Object.freeze({
    sessions: Object.freeze(
      sessions
        .filter((scope) => scope.started)
        .map((scope) => sessionSnapshot(scope)),
    ),
    status: attemptStatus(),
    coverage: attemptCoverage(),
  });

  const sessionToolScope = (scope: SessionScopeState): ToolScopeSnapshot => {
    const coverage = sessionCoverage(scope);
    return projectToolScope({
      turns: Object.freeze([...scope.turns]),
      sourceSnapshot: sessionSourceSnapshot(scope, coverage.actions, true),
      coverage,
      snapshot: Object.freeze({
        sessionIndex: scope.session.index,
        turnCount: scope.turns.length,
        status: sessionStatus(scope),
        coverage,
      }),
      resolveEvaluation: resolveObservedEvaluation,
    });
  };

  const attemptToolScope = (): ToolScopeSnapshot => {
    const active = sessions.filter((scope) => scope.started);
    const coverage = attemptCoverage();
    const turns = Object.freeze(active.flatMap((scope) => scope.turns));
    return projectToolScope({
      turns,
      sourceSnapshot: attemptSourceSnapshot(turns, coverage.actions, true),
      coverage,
      snapshot: Object.freeze({
        sessions: Object.freeze(active.map((scope) => ({
          sessionIndex: scope.session.index,
          turnCount: scope.turns.length,
          status: sessionStatus(scope),
          coverage: sessionCoverage(scope),
        }))),
        status: attemptStatus(),
        coverage,
      }),
      resolveEvaluation: resolveObservedEvaluation,
    });
  };

  const sessionScopedEvents = (scope: SessionScopeState): readonly StreamEvent[] =>
    Object.freeze(scope.turns.flatMap((turn) => turn.events));

  const sessionEventScope = (scope: SessionScopeState): EventScopeSnapshot => {
    const coverage = sessionCoverage(scope);
    return projectEventScope({
      turns: Object.freeze([...scope.turns]),
      sourceSnapshot: sessionSourceSnapshot(scope, coverage.events),
      coverage,
      snapshot: sessionSnapshot(scope),
      resolveEvaluation: resolveObservedEvaluation,
    });
  };

  const attemptScopedEvents = (): readonly StreamEvent[] =>
    Object.freeze(
      sessions
        .filter((scope) => scope.started)
        .flatMap((scope) => scope.turns.flatMap((turn) => turn.events)),
    );

  const attemptEventScope = (): EventScopeSnapshot => {
    const active = sessions.filter((scope) => scope.started);
    const coverage = attemptCoverage();
    const turns = Object.freeze(active.flatMap((scope) => scope.turns));
    return projectEventScope({
      turns,
      sourceSnapshot: attemptSourceSnapshot(turns, coverage.events),
      coverage,
      snapshot: attemptSnapshot(),
      resolveEvaluation: resolveObservedEvaluation,
    });
  };

  const makeTurn = <Kind extends RuntimeKind>(
    scope: SessionScopeState,
    turn: Turn,
    input: string,
  ): AssertFirstTurnHandle<Kind> => {
    const events = Object.freeze([...turn.events]);
    const scopedEvents = Object.freeze([
      Object.freeze({ type: "message" as const, role: "user" as const, text: input }),
      ...events,
    ]);
    const coverage = manager.resolveTurnEvidenceCoverage(turn);
    const observed = observedSnapshotForTurn(turn);
    if (observed === undefined) {
      throw new Error("SessionManager returned a Turn without its sealed observed source snapshot");
    }
    const matcherTurn: MatcherScopeTurn = Object.freeze({
      observed,
      events: scopedEvents,
      outcome: turn.status,
    });
    scope.turns.push(matcherTurn);
    const scopeSnapshot = Object.freeze({
      sessionId: observed.sessionId,
      turnId: observed.turnId,
      throughSessionSequence: observed.throughSessionSequence,
      events: scopedEvents.length,
    });
    const toolScope = projectToolScope({
      turns: Object.freeze([matcherTurn]),
      sourceSnapshot: turnSourceSnapshot(matcherTurn, coverage.actions, true),
      homeTurnId: observed.turnId,
      coverage,
      snapshot: scopeSnapshot,
      resolveEvaluation: resolveObservedEvaluation,
    });
    const eventScope = projectEventScope({
      turns: Object.freeze([matcherTurn]),
      sourceSnapshot: turnSourceSnapshot(matcherTurn, coverage.events),
      coverage,
      snapshot: scopeSnapshot,
      resolveEvaluation: resolveObservedEvaluation,
    });
    const toolCalls = managedToolCalls("turn", toolScope) as ManagedToolCalls<"turn">;
    const snapshot: TurnScopeSnapshot = Object.freeze({
      events,
      toolCalls,
      toolScope,
      status: turn.status,
      coverage,
      input,
      output: lastAssistantText(events) ?? "",
    });
    const judge: AssertFirstTurnJudge<Kind> = Object.freeze({
      autoevals: Object.freeze({
        closedQA: (question: string) => judgeHandle({
          runtime: runtime as AssertionsRuntime<Kind>,
          judge: deps.judge,
          signal: deps.signal,
          recipe: "closedQA",
          reference: question,
          material: { input: snapshot.input, output: snapshot.output },
        }),
        factuality: (expected: string) => judgeHandle({
          runtime: runtime as AssertionsRuntime<Kind>,
          judge: deps.judge,
          signal: deps.signal,
          recipe: "factuality",
          reference: expected,
          material: { input: snapshot.input, output: snapshot.output },
        }),
        summarizes: (source: string) => judgeHandle({
          runtime: runtime as AssertionsRuntime<Kind>,
          judge: deps.judge,
          signal: deps.signal,
          recipe: "summarizes",
          reference: source,
          material: { input: snapshot.input, output: snapshot.output },
        }),
      }),
    });
    const calledTool = (target: ToolMatch | string, options?: CalledToolOptions, ...extra: readonly unknown[]) => {
      if (extra.length > 0) throw new TypeError("calledTool() accepts exactly (match, options)");
      return calledToolHandle({
        runtime: runtime as AssertionsRuntime<Kind>,
        subject: snapshot.toolCalls,
        target,
        options,
      });
    };
    const notCalledTool = (target: ToolMatch | string, ...extra: readonly unknown[]) => {
      if (extra.length > 0) throw new TypeError("notCalledTool() accepts exactly one match or name");
      return notCalledToolHandle({
        runtime: runtime as AssertionsRuntime<Kind>,
        subject: snapshot.toolCalls,
        target,
      });
    };
    const toolOrder = (
      matches: readonly [ToolMatch, ToolMatch, ...ToolMatch[]],
      ...extra: readonly unknown[]
    ) => {
      if (extra.length > 0) throw new TypeError("toolOrder() accepts exactly one ordered match list");
      return toolOrderHandle({
        runtime: runtime as AssertionsRuntime<Kind>,
        subject: snapshot.toolCalls,
        matches,
      });
    };
    const usedNoTools = (...extra: readonly unknown[]) => {
      if (extra.length > 0) throw new TypeError("usedNoTools() accepts no arguments");
      return usedNoToolsHandle({ runtime: runtime as AssertionsRuntime<Kind>, subject: snapshot.toolCalls });
    };
    const maxToolCalls = (max: number, ...extra: readonly unknown[]) => {
      if (extra.length > 0) throw new TypeError("maxToolCalls() accepts exactly one maximum");
      return maxToolCallsHandle({ runtime: runtime as AssertionsRuntime<Kind>, subject: snapshot.toolCalls, max });
    };
    const noFailedActions = (...extra: readonly unknown[]) => {
      if (extra.length > 0) throw new TypeError("noFailedActions() accepts no arguments");
      return noFailedActionsHandle({
        runtime: runtime as AssertionsRuntime<Kind>,
        scope: "turn",
        events: matcherTurn.events,
        coverage,
        snapshot: scopeSnapshot,
      });
    };
    const event = (match: EventMatch, options?: EventOptions, ...extra: readonly unknown[]) => {
      if (extra.length > 0) throw new TypeError("event() accepts exactly (match, options)");
      return eventAssertionHandle({
        runtime: runtime as AssertionsRuntime<Kind>,
        scope: "turn",
        match: assertManagedEventMatch(match, "event() match"),
        count: normalizeEventCount(options),
        snapshot: eventScope,
      });
    };
    const notEvent = (match: EventMatch, ...extra: readonly unknown[]) => {
      if (extra.length > 0) throw new TypeError("notEvent() accepts exactly one match");
      return notEventHandle({
        runtime: runtime as AssertionsRuntime<Kind>,
        scope: "turn",
        match: assertManagedEventMatch(match, "notEvent() match"),
        snapshot: eventScope,
      });
    };
    const eventOrder = (
      matches: readonly [EventMatch, EventMatch, ...EventMatch[]],
      ...extra: readonly unknown[]
    ) => {
      if (extra.length > 0) throw new TypeError("eventOrder() accepts exactly one ordered match list");
      return eventOrderHandle({
        runtime: runtime as AssertionsRuntime<Kind>,
        scope: "turn",
        matches,
        snapshot: eventScope,
      });
    };
    const maxTokens = (max: number, ...extra: readonly unknown[]) => {
      if (extra.length > 0) throw new TypeError("maxTokens() accepts exactly one maximum");
      return usageLimitHandle({
        runtime: runtime as AssertionsRuntime<Kind>,
        scope: "turn",
        metric: "tokens",
        maximum: max,
        usage: turn.usage ?? {},
        coverage,
        snapshot: scopeSnapshot,
      });
    };
    const maxCost = (usd: number, ...extra: readonly unknown[]) => {
      if (extra.length > 0) throw new TypeError("maxCost() accepts exactly one maximum");
      return usageLimitHandle({
        runtime: runtime as AssertionsRuntime<Kind>,
        scope: "turn",
        metric: "cost",
        maximum: usd,
        usage: turn.usage ?? {},
        pricing: pricingEstimateFor(turn.usage === undefined ? {} : turn.usage),
        coverage,
        snapshot: scopeSnapshot,
      });
    };
    return Object.freeze({
      events: snapshot.events,
      toolCalls: snapshot.toolCalls,
      status: snapshot.status,
      message: snapshot.output,
      ...(turn.data === undefined ? {} : { data: turn.data }),
      ...(turn.usage === undefined ? {} : { usage: turn.usage }),
      check: (runtime as AssertionsRuntime<Kind>).t.check,
      succeeded: () => succeededHandle({
        runtime: runtime as AssertionsRuntime<Kind>,
        scope: "turn",
        status: snapshot.status,
        coverage: snapshot.coverage,
        snapshot: scopeSnapshot,
      }),
      calledTool,
      notCalledTool,
      toolOrder,
      usedNoTools,
      maxToolCalls,
      noFailedActions,
      event,
      notEvent,
      eventOrder,
      maxTokens,
      maxCost,
      judge,
    });
  };

  const sendEffect = <Kind extends RuntimeKind>(
    scope: SessionScopeState,
    text: string,
    files?: readonly InputFile[],
    responses?: readonly InputResponse[],
    loc?: ReturnType<typeof captureLoc>,
  ): Effect.Effect<AssertFirstTurnHandle<Kind>, unknown> => {
    const capturedLoc = loc ?? captureLoc({ registry: deps.sourceRegistry });
    return Effect.suspend(() => {
      scope.started = true;
      scope.inFlight += 1;
      return manager.sendEffect(scope.session, text, files, responses, capturedLoc).pipe(
        Effect.map((turn) => makeTurn<Kind>(scope, turn, text)),
        Effect.tapError(() => Effect.sync(() => {
          scope.failed = true;
        })),
        Effect.ensuring(Effect.sync(() => {
          scope.inFlight -= 1;
        })),
      );
    });
  };

  const send = <Kind extends RuntimeKind>(
    scope: SessionScopeState,
    text: string,
    files?: readonly InputFile[],
    responses?: readonly InputResponse[],
  ): Promise<AssertFirstTurnHandle<Kind>> =>
    deps.requestEffect(
      sendEffect<Kind>(scope, text, files, responses, captureLoc({ registry: deps.sourceRegistry })),
    );

  const makeSession = <Kind extends RuntimeKind>(scope: SessionScopeState): AssertFirstSessionHandle<Kind> => {
    const session = scope.session;
    const sessionCalls = (): ManagedToolCalls<"session"> =>
      managedToolCalls("session", sessionToolScope(scope)) as ManagedToolCalls<"session">;
    const toolOrder = (
      matches: readonly [ToolMatch, ToolMatch, ...ToolMatch[]],
      ...extra: readonly unknown[]
    ) => {
      if (extra.length > 0) throw new TypeError("toolOrder() accepts exactly one ordered match list");
      return toolOrderHandle({
        runtime: runtime as AssertionsRuntime<Kind>,
        subject: sessionCalls(),
        matches,
      });
    };
    const usedNoTools = (...extra: readonly unknown[]) => {
      if (extra.length > 0) throw new TypeError("usedNoTools() accepts no arguments");
      return usedNoToolsHandle({
        runtime: runtime as AssertionsRuntime<Kind>,
        subject: sessionCalls(),
      });
    };
    const maxToolCalls = (max: number, ...extra: readonly unknown[]) => {
      if (extra.length > 0) throw new TypeError("maxToolCalls() accepts exactly one maximum");
      return maxToolCallsHandle({
        runtime: runtime as AssertionsRuntime<Kind>,
        subject: sessionCalls(),
        max,
      });
    };
    const noFailedActions = (...extra: readonly unknown[]) => {
      if (extra.length > 0) throw new TypeError("noFailedActions() accepts no arguments");
      const coverage = sessionCoverage(scope);
      return noFailedActionsHandle({
        runtime: runtime as AssertionsRuntime<Kind>,
        scope: "session",
        events: sessionScopedEvents(scope),
        coverage,
        snapshot: sessionSnapshot(scope),
      });
    };
    const event = (match: EventMatch, options?: EventOptions, ...extra: readonly unknown[]) => {
      if (extra.length > 0) throw new TypeError("event() accepts exactly (match, options)");
      return eventAssertionHandle({
        runtime: runtime as AssertionsRuntime<Kind>,
        scope: "session",
        match: assertManagedEventMatch(match, "event() match"),
        count: normalizeEventCount(options),
        snapshot: sessionEventScope(scope),
      });
    };
    const notEvent = (match: EventMatch, ...extra: readonly unknown[]) => {
      if (extra.length > 0) throw new TypeError("notEvent() accepts exactly one match");
      return notEventHandle({
        runtime: runtime as AssertionsRuntime<Kind>,
        scope: "session",
        match: assertManagedEventMatch(match, "notEvent() match"),
        snapshot: sessionEventScope(scope),
      });
    };
    const eventOrder = (
      matches: readonly [EventMatch, EventMatch, ...EventMatch[]],
      ...extra: readonly unknown[]
    ) => {
      if (extra.length > 0) throw new TypeError("eventOrder() accepts exactly one ordered match list");
      return eventOrderHandle({
        runtime: runtime as AssertionsRuntime<Kind>,
        scope: "session",
        matches,
        snapshot: sessionEventScope(scope),
      });
    };
    const maxTokens = (max: number, ...extra: readonly unknown[]) => {
      if (extra.length > 0) throw new TypeError("maxTokens() accepts exactly one maximum");
      const coverage = sessionCoverage(scope);
      return usageLimitHandle({
        runtime: runtime as AssertionsRuntime<Kind>,
        scope: "session",
        metric: "tokens",
        maximum: max,
        usage: session.usage,
        coverage,
        snapshot: sessionSnapshot(scope),
      });
    };
    const maxCost = (usd: number, ...extra: readonly unknown[]) => {
      if (extra.length > 0) throw new TypeError("maxCost() accepts exactly one maximum");
      const coverage = sessionCoverage(scope);
      return usageLimitHandle({
        runtime: runtime as AssertionsRuntime<Kind>,
        scope: "session",
        metric: "cost",
        maximum: usd,
        usage: session.usage,
        pricing: pricingEstimateFor(session.usage),
        coverage,
        snapshot: sessionSnapshot(scope),
      });
    };
    return Object.freeze({
      send: (input: string | { readonly text: string; readonly files?: readonly InputFile[] }) => {
        const text = typeof input === "string" ? input : input.text;
        const files = typeof input === "string" ? undefined : input.files;
        return send<Kind>(scope, text, files);
      },
      sendFile: (path: string, text?: string) => {
        const loc = captureLoc({ registry: deps.sourceRegistry });
        return deps.requestEffect(
          readInputFileEffect(path).pipe(
            Effect.flatMap((file) => sendEffect<Kind>(scope, text ?? "", [file], undefined, loc)),
          ),
        );
      },
      requireInputRequest: (filter?: InputRequestFilter) => requireInputRequest(session, filter),
      async respond(...responses: readonly (string | AssertFirstRespondAnswer)[]) {
        if (responses.length === 0) throw new Error("respond() requires at least one answer");
        const built = buildRespondInput(session, responses);
        session.pendingInputRequests.length = 0;
        return send<Kind>(scope, built.text, undefined, built.responses);
      },
      async respondAll(optionId: string) {
        if (session.pendingInputRequests.length === 0) {
          throw new Error("There is no pending input request to answer");
        }
        const requests = session.pendingInputRequests.slice();
        for (const request of requests) validateOptionId(request, optionId);
        session.pendingInputRequests.length = 0;
        return send<Kind>(
          scope,
          requests.map(() => optionId).join("\n"),
          undefined,
          requests.map((request) => ({ requestId: requireRequestId(request), optionId })),
        );
      },
      get reply() {
        return session.lastMessage;
      },
      get sessionId() {
        return session.id;
      },
      get events() {
        return Object.freeze([...session.events]);
      },
      get usage() {
        return Object.freeze({ ...session.usage });
      },
      get toolCalls() {
        return sessionCalls();
      },
      check: (runtime as AssertionsRuntime<Kind>).t.check,
      succeeded: () => succeededHandle({
        runtime: runtime as AssertionsRuntime<Kind>,
        scope: "session",
        status: sessionStatus(scope),
        coverage: sessionCoverage(scope),
        snapshot: sessionSnapshot(scope),
      }),
      calledTool: (target: ToolMatch | string, options?: CalledToolOptions, ...extra: readonly unknown[]) => {
        if (extra.length > 0) throw new TypeError("calledTool() accepts exactly (match, options)");
        return calledToolHandle({
          runtime: runtime as AssertionsRuntime<Kind>,
          subject: sessionCalls(),
          target,
          options,
        });
      },
      notCalledTool: (target: ToolMatch | string, ...extra: readonly unknown[]) => {
        if (extra.length > 0) throw new TypeError("notCalledTool() accepts exactly one match or name");
        return notCalledToolHandle({
          runtime: runtime as AssertionsRuntime<Kind>,
          subject: sessionCalls(),
          target,
        });
      },
      toolOrder,
      usedNoTools,
      maxToolCalls,
      noFailedActions,
      event,
      notEvent,
      eventOrder,
      maxTokens,
      maxCost,
    });
  };

  const primaryScope: SessionScopeState = {
    session: manager.primary,
    turns: [],
    started: false,
    inFlight: 0,
    failed: false,
  };
  sessions.push(primaryScope);
  const primary = makeSession<RuntimeKind>(primaryScope);

  const rootJudge: AssertFirstRootJudge<RuntimeKind> = Object.freeze({
    autoevals: Object.freeze({
      closedQA: (question: string, material: JudgeMaterial) => judgeHandle({
        runtime,
        judge: deps.judge,
        signal: deps.signal,
        recipe: "closedQA",
        reference: question,
        material,
      }),
      factuality: (expected: string, material: JudgeMaterial) => judgeHandle({
        runtime,
        judge: deps.judge,
        signal: deps.signal,
        recipe: "factuality",
        reference: expected,
        material,
      }),
      summarizes: (source: string, material: JudgeMaterial) => judgeHandle({
        runtime,
        judge: deps.judge,
        signal: deps.signal,
        recipe: "summarizes",
        reference: source,
        material,
      }),
    }),
  });

  const attemptCalls = (): ManagedToolCalls<"attempt"> =>
    managedToolCalls("attempt", attemptToolScope()) as ManagedToolCalls<"attempt">;
  const rootUsedNoTools = (...extra: readonly unknown[]) => {
    if (extra.length > 0) throw new TypeError("usedNoTools() accepts no arguments");
    return usedNoToolsHandle({ runtime, subject: attemptCalls() });
  };
  const rootMaxToolCalls = (max: number, ...extra: readonly unknown[]) => {
    if (extra.length > 0) throw new TypeError("maxToolCalls() accepts exactly one maximum");
    return maxToolCallsHandle({ runtime, subject: attemptCalls(), max });
  };
  const rootNoFailedActions = (...extra: readonly unknown[]) => {
    if (extra.length > 0) throw new TypeError("noFailedActions() accepts no arguments");
    const coverage = attemptCoverage();
    return noFailedActionsHandle({
      runtime,
      scope: "attempt",
      events: attemptScopedEvents(),
      coverage,
      snapshot: attemptSnapshot(),
    });
  };
  const rootEvent = (match: EventMatch, options?: EventOptions, ...extra: readonly unknown[]) => {
    if (extra.length > 0) throw new TypeError("event() accepts exactly (match, options)");
    return eventAssertionHandle({
      runtime,
      scope: "attempt",
      match: assertManagedEventMatch(match, "event() match"),
      count: normalizeEventCount(options),
      snapshot: attemptEventScope(),
    });
  };
  const rootNotEvent = (match: EventMatch, ...extra: readonly unknown[]) => {
    if (extra.length > 0) throw new TypeError("notEvent() accepts exactly one match");
    return notEventHandle({
      runtime,
      scope: "attempt",
      match: assertManagedEventMatch(match, "notEvent() match"),
      snapshot: attemptEventScope(),
    });
  };
  const rootMaxTokens = (max: number, ...extra: readonly unknown[]) => {
    if (extra.length > 0) throw new TypeError("maxTokens() accepts exactly one maximum");
    const coverage = attemptCoverage();
    return usageLimitHandle({
      runtime,
      scope: "attempt",
      metric: "tokens",
      maximum: max,
      usage: manager.usage,
      coverage,
      snapshot: attemptSnapshot(),
    });
  };
  const rootMaxCost = (usd: number, ...extra: readonly unknown[]) => {
    if (extra.length > 0) throw new TypeError("maxCost() accepts exactly one maximum");
    const coverage = attemptCoverage();
    return usageLimitHandle({
      runtime,
      scope: "attempt",
      metric: "cost",
      maximum: usd,
      usage: manager.usage,
      pricing: pricingEstimateFor(manager.usage),
      coverage,
      snapshot: attemptSnapshot(),
    });
  };

  const base = {
    evaluationKind: deps.evaluationKind,
    send: primary.send,
    sendFile: primary.sendFile,
    requireInputRequest: primary.requireInputRequest,
    respond: primary.respond,
    respondAll: primary.respondAll,
    get reply() {
      return primary.reply;
    },
    get sessionId() {
      return primary.sessionId;
    },
    get events() {
      return primary.events;
    },
    newSession: () => {
      const scope: SessionScopeState = {
        session: manager.newSession(),
        turns: [],
        started: false,
        inFlight: 0,
        failed: false,
      };
      sessions.push(scope);
      return makeSession<RuntimeKind>(scope);
    },
    signal: deps.signal,
    model: deps.model,
    reasoningEffort: deps.reasoningEffort,
    flags: deps.flags,
    progress: (update: import("../types.ts").ProgressUpdate) => {
      if (deps.feedback !== undefined) {
        deps.feedback.progress(update);
      } else {
        deps.log(update.current === undefined || update.total === undefined
          ? update.message
          : `${update.message} (${update.current}/${update.total})`);
      }
    },
    diagnostic: (input: import("../types.ts").DiagnosticInput) => deps.feedback?.diagnostic(input),
    log: deps.log,
    skip: (reason: string): never => {
      if (reason.trim() === "") throw new Error("skip() requires a non-empty reason");
      state.skipReason = reason;
      throw new EvalSkipped(reason);
    },
    group: runtime.t.group,
    check: runtime.t.check,
    sandbox: createAssertFirstSandbox({
      agent: deps.agent,
      sandbox: deps.sandbox,
      runtime,
      late: state.late,
    }),
    get o11y() {
      return buildO11ySummary(manager.allEvents);
    },
    get usage() {
      return Object.freeze({ ...manager.usage });
    },
    get toolCalls() {
      return attemptCalls();
    },
    succeeded: () => succeededHandle({
      runtime,
      scope: "attempt",
      status: attemptStatus(),
      coverage: attemptCoverage(),
      snapshot: attemptSnapshot(),
    }),
    calledTool: (target: ToolMatch | string, options?: CalledToolOptions, ...extra: readonly unknown[]) => {
      if (extra.length > 0) throw new TypeError("calledTool() accepts exactly (match, options)");
      return calledToolHandle({
        runtime,
        subject: attemptCalls(),
        target,
        options,
      });
    },
    notCalledTool: (target: ToolMatch | string, ...extra: readonly unknown[]) => {
      if (extra.length > 0) throw new TypeError("notCalledTool() accepts exactly one match or name");
      return notCalledToolHandle({
        runtime,
        subject: attemptCalls(),
        target,
      });
    },
    usedNoTools: rootUsedNoTools,
    maxToolCalls: rootMaxToolCalls,
    noFailedActions: rootNoFailedActions,
    event: rootEvent,
    notEvent: rootNotEvent,
    maxTokens: rootMaxTokens,
    maxCost: rootMaxCost,
    judge: rootJudge,
  };
  const context = deps.evaluationKind === "score"
    ? Object.freeze({
        ...base,
        score: (runtime as AssertionsRuntime<"score">).t.score,
      })
    : Object.freeze(base);
  return {
    context: context as AssertFirstTestContext<RuntimeKind>,
    state,
  };
}
