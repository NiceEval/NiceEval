// Eval author context: Fact producers own evidence, while Fact uses are the
// only route into a verdict, requirement, or score.  Legacy Judge is injected
// as a deliberately isolated sidecar.

import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";

import {
  FactCollector,
  type BooleanFactEvaluation,
  type ScoreFactEvaluation,
} from "../assertions/collector.ts";
import {
  changeEntryCandidatesFor,
  emptyDiffData,
  evaluateNoChanges,
  evaluateTouchedPaths,
  netChangeOf,
  validateExpectedTouchedPaths,
  type ChangeContentState,
} from "../assertions/diff.ts";
import {
  evaluateBooleanMatch,
  evaluateScoreMatch,
  type BooleanMatch,
  type BooleanMatchEvaluation,
  type EventMatch,
  type MatchableEvent,
  type ScoreMatch,
  type ToolMatch,
} from "../assertions/match.ts";
import type { FactPhase } from "../assertions/types.ts";
import { buildJudge } from "../assertions/judge.ts";
import type { ResolvedEvidenceCoverage, EvidenceCoverageChannel } from "../assertions/coverage.ts";
import { EvalSkipped } from "./control-flow.ts";
import { FileRef, resolveDeferredFileText } from "./deferred-file-content.ts";
import { resolveEvalLocalPath } from "../sandbox/paths.ts";
import { matchesJson } from "../shared/json-match.ts";
import { deriveLogicalToolOccurrences, buildO11ySummary, deriveRunFacts } from "../o11y/derive.ts";
import { SessionManager, RunSession, lastAssistantText } from "./session.ts";
import type { ConcurrencySlot } from "./send-retry.ts";
import type {
  Agent,
  AssertionEvaluationContext,
  BooleanFact,
  DiffData,
  EvalSandbox,
  EvidenceSource,
  InputFile,
  InputRequest,
  InputRequestFilter,
  InputResponse,
  JsonValue,
  JudgeConfig,
  LogicalToolOccurrence,
  RespondAnswer,
  Sandbox,
  ScoreFact,
  SessionHandle,
  StreamEvent,
  TestContext,
  Turn,
  TurnHandle,
  Usage,
} from "../types.ts";

type TurnStatus = "completed" | "failed" | "waiting";

/** Result material supplied by Runner after the author callback has returned. */
export interface LateResult {
  diff: DiffData;
  scripts: globalThis.Record<string, import("../types.ts").ScriptResult>;
}

export interface ContextState {
  readonly collector: FactCollector;
  readonly manager: SessionManager;
  skipReason?: string;
  readonly late: LateResult;
}

export interface ContextDeps {
  agent: Agent;
  sandbox: Sandbox;
  evalId?: string;
  attempt?: import("../types.ts").AgentContext["attempt"];
  model?: string;
  reasoningEffort?: string;
  flags: globalThis.Record<string, JsonValue>;
  experimentId?: string;
  signal: AbortSignal;
  log(msg: string): void;
  judge: JudgeConfig | undefined;
  telemetry?: import("../types.ts").Telemetry;
  otel?: import("../o11y/otlp/turn-otel.ts").AgentOtelChannel;
  evalBaseDir?: string;
  feedback?: import("../types.ts").ScopedFeedback;
  fact?: (key: string, value: string | number | boolean) => void;
  onSendActive?: (active: boolean) => void;
  ledgerHooks?: import("./session.ts").SessionDeps["ledgerHooks"];
  timingNow?: import("./session.ts").SessionDeps["timingNow"];
  onTurn?: import("./session.ts").SessionDeps["onTurn"];
  concurrencySlot?: ConcurrencySlot;
  experimentClassifier?: import("./session.ts").SessionDeps["experimentClassifier"];
  retryRandom?: import("./session.ts").SessionDeps["retryRandom"];
  retrySleep?: import("./session.ts").SessionDeps["retrySleep"];
  evaluationKind?: "pass" | "score";
  liveDiff?: () => Promise<DiffData>;
}

interface ScopeTurn {
  readonly session: string;
  readonly turn: string;
  readonly ordinal: number;
  readonly events: readonly StreamEvent[];
  readonly status: TurnStatus;
  readonly usage: Usage;
  readonly coverage: ResolvedEvidenceCoverage;
}

interface ScopeEvidence {
  readonly events: readonly StreamEvent[];
  readonly turns: readonly ScopeTurn[];
  readonly status: TurnStatus;
  readonly usage: Usage;
  readonly coverage: ResolvedEvidenceCoverage;
}

interface CandidateResult<T> {
  readonly candidate: T;
  readonly result: BooleanMatchEvaluation<unknown>;
}

function capabilityGuard(agentName: string, cap: string, method: string): () => never {
  return () => {
    throw new Error(`Agent ${JSON.stringify(agentName)} does not provide ${cap}; ${method} is unavailable.`);
  };
}

function coverageReason(coverage: ResolvedEvidenceCoverage, channel: EvidenceCoverageChannel): string | undefined {
  const entry = coverage[channel];
  return entry.status === "complete"
    ? undefined
    : `evidence-coverage:${channel}=${entry.status}${entry.reason ? ` (${entry.reason})` : ""}`;
}

function booleanOutcome<T, R extends T>(
  evaluation: BooleanMatchEvaluation<R>,
): BooleanFactEvaluation {
  if (evaluation.state === "matched") {
    return {
      outcome: "passed",
      value: evaluation.value,
      ...(evaluation.diagnostic?.expected === undefined ? {} : { expected: evaluation.diagnostic.expected }),
      ...(evaluation.diagnostic?.received === undefined ? {} : { received: evaluation.diagnostic.received }),
    };
  }
  if (evaluation.state === "unavailable") {
    return {
      outcome: "unavailable",
      reason: evaluation.reason,
      ...(evaluation.diagnostic.message === undefined ? {} : { evidence: evaluation.diagnostic.message }),
    };
  }
  return {
    outcome: "failed",
    ...(evaluation.diagnostic.expected === undefined ? {} : { expected: evaluation.diagnostic.expected }),
    ...(evaluation.diagnostic.received === undefined
      ? { received: evaluation.diagnostic.message }
      : { received: evaluation.diagnostic.received }),
  };
}

async function booleanValueOutcome<T, R extends T>(
  match: BooleanMatch<T, R, "value">,
  value: T,
): Promise<BooleanFactEvaluation> {
  return booleanOutcome(await evaluateBooleanMatch(match, value));
}

async function scoreValueOutcome<T>(match: ScoreMatch<T>, value: T): Promise<ScoreFactEvaluation> {
  return { outcome: "scored", normalizedScore: await evaluateScoreMatch(match, value) };
}

/**
 * A waiting Turn is intentionally never passed as `outcome: waiting` here.
 * With only a per-Turn projection, an unclosed operation has no reliable
 * relationship to a later respond Turn; it remains opaque/unavailable until
 * a Session-scope projector exists.
 */
function occurrencesFor(turns: readonly ScopeTurn[]): readonly LogicalToolOccurrence[] {
  return turns.flatMap((turn) =>
    deriveLogicalToolOccurrences(turn.events, {
      session: turn.session,
      turn: turn.turn,
      turnOrdinal: turn.ordinal,
      // Deliberately omit `outcome`, including when Turn.status is waiting.
    }).occurrences,
  );
}

function lifecycleSafeResult<T>(
  occurrence: LogicalToolOccurrence,
  result: BooleanMatchEvaluation<T>,
): BooleanMatchEvaluation<T> {
  // A matcher unrestricted by lifecycle could otherwise report a positive
  // input/name match for a waiting, still-open operation.  That is evidence of
  // a start only, not a definite tool occurrence outcome.
  if (occurrence.lifecycle.state === "opaque" && result.state === "matched") {
    return {
      state: "unavailable",
      reason: `tool-lifecycle-unavailable:${occurrence.lifecycle.reason}`,
      diagnostic: {
        code: "tool-lifecycle-unavailable",
        message: "tool operation is open without a session-wide lifecycle projection",
        path: [],
        reason: occurrence.lifecycle.reason,
        locator: { kind: "tool-occurrence", id: occurrence.id },
      },
    };
  }
  return result;
}

async function toolCandidates(
  evidence: ScopeEvidence,
  match: ToolMatch,
): Promise<readonly CandidateResult<LogicalToolOccurrence>[]> {
  const out: CandidateResult<LogicalToolOccurrence>[] = [];
  for (const occurrence of occurrencesFor(evidence.turns)) {
    const evaluated = await evaluateBooleanMatch(match, occurrence);
    out.push({ candidate: occurrence, result: lifecycleSafeResult(occurrence, evaluated) });
  }
  return out;
}

function collectionCount(options: { readonly count?: number } | undefined, label: string): number | undefined {
  const count = options?.count;
  if (count === undefined) return undefined;
  if (!Number.isSafeInteger(count) || count <= 0) {
    throw new TypeError(`${label} count must be a positive safe integer; use notCalledTool() for zero`);
  }
  return count;
}

function orderedCollection<T>(
  matches: readonly T[],
  label: string,
): readonly [T, T, ...T[]] {
  if (!Array.isArray(matches) || matches.length < 2) {
    throw new TypeError(`${label} requires at least two Match values`);
  }
  return matches as unknown as readonly [T, T, ...T[]];
}

function validateFileChangedOptions(
  options: { readonly before?: BooleanMatch<string, string, "value">; readonly after?: BooleanMatch<string, string, "value"> } | undefined,
): void {
  if (options !== undefined && options.before === undefined && options.after === undefined) {
    throw new TypeError("fileChanged() options must include before or after; omit options for an unconstrained change");
  }
}

function collectionOutcome<T>(
  candidates: readonly CandidateResult<T>[],
  coverage: string | undefined,
  count: number | undefined,
  name: string,
): BooleanFactEvaluation {
  const matches = candidates.filter((candidate) => candidate.result.state === "matched");
  const hasUnavailable = candidates.some((candidate) => candidate.result.state === "unavailable");
  if (count === undefined) {
    if (matches.length > 0) return { outcome: "passed", value: matches[0]!.candidate };
    if (hasUnavailable || coverage !== undefined) return { outcome: "unavailable", reason: firstUnavailableReason(candidates, coverage) };
    return { outcome: "failed", expected: name, received: "no matching occurrence" };
  }
  if (matches.length > count) {
    return { outcome: "failed", expected: `exactly ${count} × ${name}`, received: `${matches.length} definite matches` };
  }
  if (matches.length === count && !hasUnavailable && coverage === undefined) {
    return { outcome: "passed", value: matches[0]!.candidate };
  }
  if (hasUnavailable || coverage !== undefined) return { outcome: "unavailable", reason: firstUnavailableReason(candidates, coverage) };
  return { outcome: "failed", expected: `exactly ${count} × ${name}`, received: `${matches.length} definite matches` };
}

function firstUnavailableReason<T>(candidates: readonly CandidateResult<T>[], fallback: string | undefined): string {
  const unavailable = candidates.find((candidate) => candidate.result.state === "unavailable")?.result;
  return unavailable?.state === "unavailable" ? unavailable.reason : (fallback ?? "evidence unavailable");
}

async function calledToolOutcome(
  evidence: ScopeEvidence,
  match: ToolMatch,
  count: number | undefined,
): Promise<BooleanFactEvaluation> {
  return collectionOutcome(await toolCandidates(evidence, match), coverageReason(evidence.coverage, "actions"), count, match.name);
}

async function notCalledToolOutcome(evidence: ScopeEvidence, match: ToolMatch): Promise<BooleanFactEvaluation> {
  const candidates = await toolCandidates(evidence, match);
  const matched = candidates.find((candidate) => candidate.result.state === "matched");
  if (matched !== undefined) return { outcome: "failed", expected: `no ${match.name}`, received: "a matching occurrence was observed" };
  const coverage = coverageReason(evidence.coverage, "actions");
  if (candidates.some((candidate) => candidate.result.state === "unavailable") || coverage !== undefined) {
    return { outcome: "unavailable", reason: firstUnavailableReason(candidates, coverage) };
  }
  return { outcome: "passed" };
}

function hasOrderedPath(
  matrix: readonly (readonly BooleanMatchEvaluation<unknown>[])[],
  allowed: (result: BooleanMatchEvaluation<unknown>) => boolean,
): boolean {
  let cursor = 0;
  for (const row of matrix) {
    let found = -1;
    for (let index = cursor; index < row.length; index += 1) {
      if (allowed(row[index]!)) {
        found = index;
        break;
      }
    }
    if (found < 0) return false;
    cursor = found + 1;
  }
  return true;
}

function firstUnavailableInOrder(
  matrix: readonly (readonly BooleanMatchEvaluation<unknown>[])[],
): string | undefined {
  for (const row of matrix) {
    const unavailable = row.find((result) => result.state === "unavailable");
    if (unavailable?.state === "unavailable") return unavailable.reason;
  }
  return undefined;
}

async function toolOrderOutcome(
  evidence: ScopeEvidence,
  matches: readonly ToolMatch[],
): Promise<BooleanFactEvaluation> {
  const occurrences = occurrencesFor(evidence.turns);
  const matrix: BooleanMatchEvaluation<unknown>[][] = [];
  for (const match of matches) {
    const row: BooleanMatchEvaluation<unknown>[] = [];
    for (const occurrence of occurrences) {
      row.push(lifecycleSafeResult(occurrence, await evaluateBooleanMatch(match, occurrence)));
    }
    matrix.push(row);
  }
  if (hasOrderedPath(matrix, (result) => result.state === "matched")) return { outcome: "passed" };
  const coverage = coverageReason(evidence.coverage, "actions");
  if (coverage !== undefined || hasOrderedPath(matrix, (result) => result.state === "matched" || result.state === "unavailable")) {
    return { outcome: "unavailable", reason: coverage ?? firstUnavailableInOrder(matrix) ?? "tool-order-unavailable" };
  }
  return { outcome: "failed", expected: matches.map((match) => match.name).join(" → "), received: "no definite ordered path" };
}

interface EventCandidates {
  readonly candidates: readonly MatchableEvent[];
  readonly unassociatedOperation: boolean;
}

function eventsFor(evidence: ScopeEvidence): EventCandidates {
  const candidates: MatchableEvent[] = [];
  let unassociatedOperation = false;
  for (const turn of evidence.turns) {
    const derivation = deriveLogicalToolOccurrences(turn.events, {
      session: turn.session,
      turn: turn.turn,
      turnOrdinal: turn.ordinal,
    });
    const starts = new Map<number, LogicalToolOccurrence>();
    const finishes = new Map<number, LogicalToolOccurrence>();
    for (const occurrence of derivation.occurrences) {
      starts.set(occurrence.start.eventOrdinal, occurrence);
      if (occurrence.lifecycle.state === "available" && occurrence.lifecycle.status !== "pending") {
        finishes.set(occurrence.lifecycle.finish.eventOrdinal, occurrence);
      }
    }
    for (const [index, event] of turn.events.entries()) {
      if (event.type === "message") {
        candidates.push(event);
      } else if (event.type === "operation.started" && event.operation.kind === "tool") {
        const occurrence = starts.get(index);
        if (occurrence === undefined) unassociatedOperation = true;
        else candidates.push({ ...event, occurrence });
      } else if (event.type === "operation.finished" && event.kind === "tool") {
        const occurrence = finishes.get(index);
        if (occurrence === undefined) unassociatedOperation = true;
        else candidates.push({ ...event, occurrence });
      }
    }
  }
  // `t` and session scopes also contain the author-input messages SessionManager
  // inserts. They are real message evidence even though they are not part of a
  // Turn's adapter event slice.
  const seenMessages = new Set(candidates.filter((event) => event.type === "message").map((event) => event));
  for (const event of evidence.events) {
    if (event.type === "message" && !seenMessages.has(event)) candidates.push(event);
  }
  return { candidates, unassociatedOperation };
}

function eventLifecycleSafeResult(event: MatchableEvent, result: BooleanMatchEvaluation<unknown>): BooleanMatchEvaluation<unknown> {
  return "occurrence" in event ? lifecycleSafeResult(event.occurrence, result) : result;
}

async function eventCandidateResults(
  evidence: ScopeEvidence,
  match: EventMatch,
): Promise<{ readonly candidates: readonly CandidateResult<MatchableEvent>[]; readonly unassociatedOperation: boolean }> {
  const events = eventsFor(evidence);
  const candidates: CandidateResult<MatchableEvent>[] = [];
  for (const event of events.candidates) {
    candidates.push({ candidate: event, result: eventLifecycleSafeResult(event, await evaluateBooleanMatch(match, event)) });
  }
  return { candidates, unassociatedOperation: events.unassociatedOperation };
}

async function eventOutcome(
  evidence: ScopeEvidence,
  match: EventMatch,
  count: number | undefined,
): Promise<BooleanFactEvaluation> {
  const evaluated = await eventCandidateResults(evidence, match);
  const coverage = coverageReason(evidence.coverage, "events") ??
    (evaluated.unassociatedOperation ? "event-tool-occurrence-unavailable" : undefined);
  return collectionOutcome(evaluated.candidates, coverage, count, match.name);
}

async function notEventOutcome(evidence: ScopeEvidence, match: EventMatch): Promise<BooleanFactEvaluation> {
  const evaluated = await eventCandidateResults(evidence, match);
  const matched = evaluated.candidates.find((candidate) => candidate.result.state === "matched");
  if (matched !== undefined) return { outcome: "failed", expected: `no ${match.name}`, received: "a matching event was observed" };
  const coverage = coverageReason(evidence.coverage, "events") ??
    (evaluated.unassociatedOperation ? "event-tool-occurrence-unavailable" : undefined);
  if (coverage !== undefined || evaluated.candidates.some((candidate) => candidate.result.state === "unavailable")) {
    return { outcome: "unavailable", reason: firstUnavailableReason(evaluated.candidates, coverage) };
  }
  return { outcome: "passed" };
}

async function eventOrderOutcome(evidence: ScopeEvidence, matches: readonly EventMatch[]): Promise<BooleanFactEvaluation> {
  const events = eventsFor(evidence);
  const matrix: BooleanMatchEvaluation<unknown>[][] = [];
  for (const match of matches) {
    const row: BooleanMatchEvaluation<unknown>[] = [];
    for (const event of events.candidates) {
      row.push(eventLifecycleSafeResult(event, await evaluateBooleanMatch(match, event)));
    }
    matrix.push(row);
  }
  if (hasOrderedPath(matrix, (result) => result.state === "matched")) return { outcome: "passed" };
  const coverage = coverageReason(evidence.coverage, "events") ??
    (events.unassociatedOperation ? "event-tool-occurrence-unavailable" : undefined);
  if (coverage !== undefined || hasOrderedPath(matrix, (result) => result.state === "matched" || result.state === "unavailable")) {
    return { outcome: "unavailable", reason: coverage ?? firstUnavailableInOrder(matrix) ?? "event-order-unavailable" };
  }
  return { outcome: "failed", expected: matches.map((match) => match.name).join(" → "), received: "no definite ordered path" };
}

function changedContentOutcome(
  state: ChangeContentState,
  match: BooleanMatch<string, string, "value"> | undefined,
): Promise<BooleanMatchEvaluation<unknown>> {
  if (match === undefined) {
    return Promise.resolve({ state: "matched", value: undefined, diagnostic: { code: "unconstrained", message: "no content constraint", path: [] } });
  }
  if (state.state === "available") return evaluateBooleanMatch(match, state.text);
  if (state.state === "absent") {
    return Promise.resolve({
      state: "mismatched",
      diagnostic: { code: "change-content-absent", message: "the requested diff side is absent", path: [], expected: match.name },
    });
  }
  return Promise.resolve({
    state: "unavailable",
    reason: state.state === "elided" ? `diff-content-elided:${state.reason}` : state.reason,
    diagnostic: { code: "change-content-unavailable", message: "the requested diff side is unavailable", path: [] },
  });
}

async function fileChangedOutcome(
  diff: DiffData,
  path: string,
  options: { readonly before?: BooleanMatch<string, string, "value">; readonly after?: BooleanMatch<string, string, "value"> } | undefined,
): Promise<BooleanFactEvaluation> {
  const candidates = changeEntryCandidatesFor(diff, path);
  if (candidates === undefined) return { outcome: "failed", expected: `a change to ${JSON.stringify(path)}`, received: "path was not changed" };
  let hasUnavailable = false;
  for (const candidate of candidates) {
    const before = await changedContentOutcome(candidate.before, options?.before);
    const after = await changedContentOutcome(candidate.after, options?.after);
    if (before.state === "matched" && after.state === "matched") return { outcome: "passed" };
    // One definite side mismatch makes this whole change entry impossible;
    // an opaque other side cannot turn false into unknown.
    if (before.state === "mismatched" || after.state === "mismatched") continue;
    if (before.state === "unavailable" || after.state === "unavailable") hasUnavailable = true;
  }
  return hasUnavailable
    ? { outcome: "unavailable", reason: `diff-content-unavailable:${path}` }
    : { outcome: "failed", expected: `a matching change to ${JSON.stringify(path)}`, received: "no single change entry satisfied both sides" };
}

/** Build one context and its single-owner Fact collector. */
export function createEvalContext(deps: ContextDeps): { context: TestContext; state: ContextState } {
  let sourceOrder = 0;
  const nextSourceOrder = (): number => ++sourceOrder;
  const manager = new SessionManager({
    agent: deps.agent,
    sandbox: deps.sandbox,
    evalId: deps.evalId,
    attempt: deps.attempt,
    model: deps.model,
    reasoningEffort: deps.reasoningEffort,
    flags: deps.flags,
    experimentId: deps.experimentId,
    signal: deps.signal,
    log: deps.log,
    telemetry: deps.telemetry,
    otel: deps.otel,
    feedback: deps.feedback,
    fact: deps.fact,
    onSendActive: deps.onSendActive,
    timingNow: deps.timingNow,
    onTurn: deps.onTurn,
    ledgerHooks: deps.ledgerHooks,
    concurrencySlot: deps.concurrencySlot,
    experimentClassifier: deps.experimentClassifier,
    retryRandom: deps.retryRandom,
    retrySleep: deps.retrySleep,
    nextSourceOrder,
  });
  const late: LateResult = { diff: emptyDiffData(), scripts: {} };
  const scopeTurns = new Map<RunSession, ScopeTurn[]>();
  const allScopeTurns: ScopeTurn[] = [];
  let occurrenceOrdinal = 0;

  let liveDiffCache: { readonly at: number; readonly diff: Promise<DiffData> } | undefined;
  const liveContext = async (): Promise<AssertionEvaluationContext> => {
    let diff = late.diff;
    if (deps.liveDiff) {
      const at = manager.allEvents.length;
      if (liveDiffCache === undefined || liveDiffCache.at !== at) liveDiffCache = { at, diff: deps.liveDiff() };
      diff = await liveDiffCache.diff;
    }
    return {
      events: manager.allEvents,
      facts: deriveRunFacts(manager.allEvents),
      diff,
      scripts: late.scripts,
      usage: manager.usage,
      status: manager.lastStatus,
      evidenceCoverage: manager.evidenceCoverage,
      readFile: async (path) => {
        try {
          return await deps.sandbox.readText(path);
        } catch {
          return undefined;
        }
      },
    };
  };

  const collector = new FactCollector({
    evaluationKind: deps.evaluationKind,
    liveContext,
    nextSourceOrder,
  });
  const state: ContextState = { collector, manager, late };

  const registerTurn = (session: RunSession, turn: Turn): ScopeTurn => {
    const item: ScopeTurn = {
      session: `session-${session.index}`,
      turn: `turn-${session.turnCount}`,
      ordinal: occurrenceOrdinal++,
      events: turn.events.slice(),
      status: turn.status,
      usage: { ...(turn.usage ?? {}) },
      coverage: manager.resolveTurnEvidenceCoverage(turn),
    };
    const own = scopeTurns.get(session);
    if (own === undefined) scopeTurns.set(session, [item]);
    else own.push(item);
    allScopeTurns.push(item);
    return item;
  };

  const scopeForSession = (session: RunSession): ScopeEvidence => ({
    events: session.events.slice(),
    turns: (scopeTurns.get(session) ?? []).slice(),
    status: session.lastStatus,
    usage: { ...session.usage },
    coverage: session.evidenceCoverage,
  });
  const aggregateScope = (): ScopeEvidence => ({
    events: manager.allEvents,
    turns: allScopeTurns,
    status: manager.lastStatus,
    usage: manager.usage,
    coverage: manager.evidenceCoverage,
  });

  const makeScopedFacts = <P extends FactPhase>(phase: P, evidence: () => ScopeEvidence) => ({
    succeeded: () =>
      collector.createBooleanFact<void, P>({
        name: "succeeded",
        phase,
        value: undefined,
        evaluate: () => {
          const snapshot = evidence();
          if (snapshot.status === "completed") return { outcome: "passed" };
          const unavailable = coverageReason(snapshot.coverage, "status");
          return unavailable === undefined
            ? { outcome: "failed", expected: "completed turn", received: `status: ${snapshot.status}` }
            : { outcome: "unavailable", reason: unavailable };
        },
      }),
    parked: () =>
      collector.createBooleanFact<void, P>({
        name: "parked",
        phase,
        value: undefined,
        evaluate: () => {
          const snapshot = evidence();
          const statusUnavailable = coverageReason(snapshot.coverage, "status");
          const eventsUnavailable = coverageReason(snapshot.coverage, "events");
          if (statusUnavailable !== undefined || eventsUnavailable !== undefined) {
            return {
              outcome: "unavailable",
              reason: statusUnavailable ?? eventsUnavailable ?? "parked-evidence-unavailable",
            };
          }
          if (snapshot.status === "waiting" && deriveRunFacts(snapshot.events).parked) {
            return { outcome: "passed" };
          }
          return {
            outcome: "failed",
            expected: "waiting scope ending in input.requested",
            received: snapshot.status === "waiting"
              ? "waiting scope without a terminal input request"
              : `status: ${snapshot.status}`,
          };
        },
      }),
    calledTool: (match: ToolMatch, options?: { readonly count?: number }) => {
      const count = collectionCount(options, "calledTool()");
      return collector.createBooleanFact<LogicalToolOccurrence, P>({
        name: `calledTool(${match.name})`,
        phase,
        value: undefined as unknown as LogicalToolOccurrence,
        evaluate: () => calledToolOutcome(evidence(), match, count),
      });
    },
    notCalledTool: (match: ToolMatch) =>
      collector.createBooleanFact<void, P>({
        name: `notCalledTool(${match.name})`,
        phase,
        value: undefined,
        evaluate: () => notCalledToolOutcome(evidence(), match),
      }),
    toolOrder: (matches: readonly [ToolMatch, ToolMatch, ...ToolMatch[]]) => {
      const ordered = orderedCollection(matches, "toolOrder()");
      return collector.createBooleanFact<void, P>({
        name: `toolOrder(${matches.map((match) => match.name).join(" → ")})`,
        phase,
        value: undefined,
        evaluate: () => toolOrderOutcome(evidence(), ordered),
      });
    },
    event: (match: EventMatch, options?: { readonly count?: number }) => {
      const count = collectionCount(options, "event()");
      return collector.createBooleanFact<MatchableEvent, P>({
        name: `event(${match.name})`,
        phase,
        value: undefined as unknown as MatchableEvent,
        evaluate: () => eventOutcome(evidence(), match, count),
      });
    },
    notEvent: (match: EventMatch) =>
      collector.createBooleanFact<void, P>({
        name: `notEvent(${match.name})`,
        phase,
        value: undefined,
        evaluate: () => notEventOutcome(evidence(), match),
      }),
    eventOrder: (matches: readonly [EventMatch, EventMatch, ...EventMatch[]]) => {
      const ordered = orderedCollection(matches, "eventOrder()");
      return collector.createBooleanFact<void, P>({
        name: `eventOrder(${matches.map((match) => match.name).join(" → ")})`,
        phase,
        value: undefined,
        evaluate: () => eventOrderOutcome(evidence(), ordered),
      });
    },
  });

  const makeChecked = <T>(value: T | EvidenceSource<T, FactPhase>, match: BooleanMatch<T, T, "value"> | ScoreMatch<T>) => {
    const source = value instanceof FileRef ? value : undefined;
    if (match.kind === "score") {
      if (source !== undefined) {
        return collector.createScoreFact({
          name: match.name,
          phase: "final",
          evaluate: async () => {
            const resolved = await resolveDeferredFileText(() => deps.sandbox.readBytes(source.path));
            if (resolved.state === "available") return scoreValueOutcome(match as ScoreMatch<string>, resolved.text);
            if (resolved.state === "missing" || resolved.state === "invalid-utf8") {
              return { outcome: "scored", normalizedScore: 0 };
            }
            if (resolved.state === "unavailable") return { outcome: "unavailable", reason: `sandbox-file-unavailable:${resolved.reason}` };
            throw resolved.cause;
          },
        });
      }
      return collector.createScoreFact({
        name: match.name,
        phase: "now",
        evaluate: () => scoreValueOutcome(match as ScoreMatch<T>, value as T),
      });
    }
    if (source !== undefined) {
      return collector.createBooleanFact<string, "final">({
        name: match.name,
        phase: "final",
        value: undefined as unknown as string,
        evaluate: async () => {
          const resolved = await resolveDeferredFileText(() => deps.sandbox.readBytes(source.path));
          if (resolved.state === "available") return booleanValueOutcome(match as unknown as BooleanMatch<string, string, "value">, resolved.text);
          if (resolved.state === "missing") {
            return { outcome: "failed", expected: match.name, received: `sandbox file ${JSON.stringify(source.path)} is missing` };
          }
          if (resolved.state === "invalid-utf8") {
            return { outcome: "failed", expected: match.name, received: `sandbox file ${JSON.stringify(source.path)} is not valid UTF-8` };
          }
          if (resolved.state === "unavailable") return { outcome: "unavailable", reason: `sandbox-file-unavailable:${resolved.reason}` };
          throw resolved.cause;
        },
      });
    }
    return collector.createBooleanFact<T, "now">({
      name: match.name,
      phase: "now",
      value: value as T,
      evaluate: () => booleanValueOutcome(match as BooleanMatch<T, T, "value">, value as T),
    });
  };

  const makeSandbox = (): EvalSandbox => {
    const guardAsync = <A extends unknown[], R>(name: string, fn: (...args: A) => Promise<R>) =>
      async (...args: A): Promise<R> => {
        await collector.settleLegacyPrerequisites();
        collector.beforeManagedBoundary(`sandbox.${name}`);
        return fn(...args);
      };
    return {
      workdir: deps.sandbox.workdir,
      runCommand: guardAsync("runCommand", (cmd, args, options) => deps.sandbox.runCommand(cmd, args, options)),
      runShell: guardAsync("runShell", (script, options) => deps.sandbox.runShell(script, options)),
      runCommandOrThrow: guardAsync("runCommandOrThrow", (cmd, args, options) => deps.sandbox.runCommandOrThrow(cmd, args, options)),
      runShellOrThrow: guardAsync("runShellOrThrow", (script, options) => deps.sandbox.runShellOrThrow(script, options)),
      readText: guardAsync("readText", (path) => deps.sandbox.readText(path)),
      writeText: guardAsync("writeText", (path, content) => deps.sandbox.writeText(path, content)),
      readBytes: guardAsync("readBytes", (path) => deps.sandbox.readBytes(path)),
      writeBytes: guardAsync("writeBytes", (path, content) => deps.sandbox.writeBytes(path, content)),
      pathExists: guardAsync("pathExists", (path) => deps.sandbox.pathExists(path)),
      uploadFile: guardAsync("uploadFile", (source, target) => deps.sandbox.uploadFile(resolveEvalLocalPath(deps.evalBaseDir, source), target)),
      uploadDirectory: guardAsync("uploadDirectory", (source, target, options) => deps.sandbox.uploadDirectory(resolveEvalLocalPath(deps.evalBaseDir, source), target, options)),
      downloadFile: guardAsync("downloadFile", (source, target) => deps.sandbox.downloadFile(source, resolveEvalLocalPath(deps.evalBaseDir, target))),
      downloadDirectory: guardAsync("downloadDirectory", (source, target, options) => deps.sandbox.downloadDirectory(source, resolveEvalLocalPath(deps.evalBaseDir, target), options)),
      file: (path) => new FileRef(path) as unknown as EvidenceSource<string, "final">,
      changedPaths: (paths) => {
        validateExpectedTouchedPaths(paths);
        collector.requireDiffEvidence();
        return collector.createBooleanFact<void, "final">({
          name: `changedPaths(${paths.join(", ")})`,
          phase: "final",
          value: undefined,
          evidence: "diff",
          evaluate: (context) => {
            const outcome = evaluateTouchedPaths(context.diff, paths, true);
            return outcome.outcome === "passed"
              ? { outcome: "passed" }
              : outcome.outcome === "unavailable"
                ? { outcome: "unavailable", reason: outcome.reason }
                : { outcome: "failed", expected: paths.join(", "), received: `missing=${outcome.missing.join(",")}; unexpected=${outcome.unexpected.join(",")}` };
          },
        });
      },
      noChanges: () => {
        collector.requireDiffEvidence();
        return collector.createBooleanFact<void, "final">({
          name: "noChanges",
          phase: "final",
          value: undefined,
          evidence: "diff",
          evaluate: (context) => {
            const outcome = evaluateNoChanges(context.diff, true);
            return outcome.outcome === "passed"
              ? { outcome: "passed" }
              : outcome.outcome === "unavailable"
                ? { outcome: "unavailable", reason: outcome.reason }
                : { outcome: "failed", received: `unexpected=${outcome.unexpected.join(",")}` };
          },
        });
      },
      fileChanged: (path, options) => {
        validateFileChangedOptions(options);
        collector.requireDiffEvidence();
        return collector.createBooleanFact<void, "final">({
          name: `fileChanged(${JSON.stringify(path)})`,
          phase: "final",
          value: undefined,
          evidence: "diff",
          evaluate: (context) => fileChangedOutcome(context.diff, path, options),
        });
      },
      fileDeleted: (path) => {
        collector.requireDiffEvidence();
        return collector.createBooleanFact<void, "final">({
          name: `fileDeleted(${JSON.stringify(path)})`,
          phase: "final",
          value: undefined,
          evidence: "diff",
          evaluate: (context) =>
            netChangeOf(context.diff, path) === "deleted"
              ? { outcome: "passed" }
              : { outcome: "failed", expected: `deleted ${JSON.stringify(path)}`, received: "path is not net-deleted" },
        });
      },
    };
  };

  const sendTurn = async (session: RunSession, text: string, files?: readonly InputFile[], responses?: readonly InputResponse[]): Promise<TurnHandle> => {
    await collector.settleLegacyPrerequisites();
    collector.beforeManagedBoundary("send");
    const turn = await manager.send(session, text, files, responses);
    return makeTurnHandle(turn, registerTurn(session, turn), session, text);
  };

  const makeJudge = (session: RunSession, input: () => string) =>
    buildJudge({
      record: (spec) => collector.recordLegacyJudge(spec),
      judge: deps.judge,
      getOutput: () => conversationText(session.events),
      getInput: input,
      signal: deps.signal,
    });

  const makeTurnHandle = (turn: Turn, item: ScopeTurn, session: RunSession, input: string): TurnHandle => {
    const facts = makeScopedFacts("now", () => ({
      events: turn.events,
      turns: [item],
      status: turn.status,
      usage: item.usage,
      coverage: item.coverage,
    }));
    return {
      events: turn.events,
      toolCalls: deriveRunFacts(turn.events).toolCalls,
      status: turn.status,
      message: lastAssistantText(turn.events) ?? "",
      data: turn.data,
      usage: turn.usage,
      ...facts,
      judge: makeJudge(session, () => input),
    };
  };

  const makeSessionHandle = (session: RunSession): SessionHandle => {
    // A live Session Fact is deliberately a prefix snapshot at the producer
    // call site.  Letting the closure re-read the mutable Session at
    // finalization would make a fact declared before `respond()` silently
    // inspect a later turn instead of the evidence it named.
    const snapshotFacts = () => {
      const snapshot = scopeForSession(session);
      return makeScopedFacts("now", () => snapshot);
    };
    return {
      send: (input) => sendTurn(session, typeof input === "string" ? input : input.text, typeof input === "string" ? undefined : input.files),
      sendFile: async (path, text) => {
        await collector.settleLegacyPrerequisites();
        collector.beforeManagedBoundary("sendFile");
        const file = await readInputFile(path);
        const turn = await manager.send(session, text ?? "", [file]);
        return makeTurnHandle(turn, registerTurn(session, turn), session, text ?? "");
      },
      requireInputRequest: (filter) => requireInputRequest(session, filter),
      respond: async (...answers) => {
        await collector.settleLegacyPrerequisites();
        collector.beforeManagedBoundary("respond");
        if (answers.length === 0) throw new Error("respond() requires at least one answer");
        const built = buildRespondInput(session, answers);
        session.pendingInputRequests.length = 0;
        return sendTurn(session, built.text, undefined, built.responses);
      },
      respondAll: async (optionId) => {
        await collector.settleLegacyPrerequisites();
        collector.beforeManagedBoundary("respondAll");
        if (session.pendingInputRequests.length === 0) throw new Error("There is no pending input request to answer");
        const requests = session.pendingInputRequests.slice();
        for (const request of requests) validateOptionId(request, optionId);
        session.pendingInputRequests.length = 0;
        return sendTurn(session, requests.map(() => optionId).join("\n"), undefined, requests.map((request) => ({ requestId: requireRequestId(request), optionId })));
      },
      get reply() {
        return session.lastMessage;
      },
      get sessionId() {
        return session.id;
      },
      get events() {
        return session.events.slice();
      },
      get usage() {
        return session.usage;
      },
      get judge() {
        return makeJudge(session, () => session.lastInput);
      },
      succeeded: () => snapshotFacts().succeeded(),
      parked: () => snapshotFacts().parked(),
      calledTool: (match, options) => snapshotFacts().calledTool(match, options),
      notCalledTool: (match) => snapshotFacts().notCalledTool(match),
      toolOrder: (matches) => snapshotFacts().toolOrder(matches),
      event: (match, options) => snapshotFacts().event(match, options),
      notEvent: (match) => snapshotFacts().notEvent(match),
      eventOrder: (matches) => snapshotFacts().eventOrder(matches),
    };
  };

  const primary = makeSessionHandle(manager.primary);
  const finalFacts = makeScopedFacts("final", aggregateScope);
  const sandbox = makeSandbox();
  const require = (valueOrFact: unknown, matchOrOptions?: unknown, options?: unknown): Promise<unknown> => {
    if (isValueMatch(matchOrOptions)) {
      const fact = makeChecked(valueOrFact as never, matchOrOptions);
      return collector.require(fact as BooleanFact<unknown, "now">, options as never);
    }
    return collector.require(valueOrFact as BooleanFact<unknown, "now">, matchOrOptions as never);
  };

  const contextObject = {
    send: primary.send,
    sendFile: primary.sendFile,
    requireInputRequest: primary.requireInputRequest,
    respond: primary.respond,
    respondAll: primary.respondAll,
    get reply() {
      return manager.primary.lastMessage;
    },
    get sessionId() {
      return manager.primary.id;
    },
    get events() {
      return manager.primary.events.slice();
    },
    newSession: () => makeSessionHandle(manager.newSession()),
    signal: deps.signal,
    model: deps.model,
    reasoningEffort: deps.reasoningEffort,
    flags: deps.flags,
    progress: (update: import("../types.ts").ProgressUpdate) =>
      deps.feedback
        ? deps.feedback.progress(update)
        : deps.log(update.current !== undefined && update.total !== undefined ? `${update.message} (${update.current}/${update.total})` : update.message),
    diagnostic: (input: import("../types.ts").DiagnosticInput) => deps.feedback?.diagnostic(input),
    log: deps.log,
    skip: (reason: string): never => {
      collector.beforeManagedBoundary("skip");
      if (reason.trim().length === 0) throw new Error("skip() requires a non-empty reason");
      state.skipReason = reason;
      collector.closeForSkip(reason);
      throw new EvalSkipped(reason);
    },
    check: makeChecked,
    assert: (fact: BooleanFact<unknown, FactPhase> | ScoreFact<FactPhase>, options?: unknown) => collector.assert(fact as never, options as never),
    assertIfCovered: (fact: import("../assertions/types.ts").UsageEvidenceFact<FactPhase>, options?: unknown) => collector.assertIfCovered(fact, options as never),
    require,
    group: async (title: string, fn: () => Promise<unknown> | unknown) => {
      await collector.settleLegacyPrerequisites();
      return collector.withGroup(title, fn);
    },
    sandbox,
    get o11y() {
      return buildO11ySummary(manager.allEvents);
    },
    get usage() {
      return manager.usage;
    },
    get judge() {
      return makeJudge(manager.primary, () => manager.primary.lastInput);
    },
    ...finalFacts,
    ...(deps.evaluationKind === "score"
      ? {
          score: (label: string, factOrDirect: unknown, options?: unknown) => collector.score(label, factOrDirect as never, options as never),
          finishScore: () => collector.finishScore(),
        }
      : {}),
  };
  const context = deps.agent.kind === "sandbox"
    ? contextObject
    : Object.defineProperty(contextObject, "sandbox", {
        get: capabilityGuard(deps.agent.name, "sandbox", "t.sandbox"),
        enumerable: true,
      });
  return { context: context as unknown as TestContext, state };
}

function isValueMatch(value: unknown): value is BooleanMatch<unknown, unknown, "value"> {
  return typeof value === "object" && value !== null && (value as { domain?: unknown }).domain === "value" &&
    (value as { kind?: unknown }).kind === "boolean";
}

async function readInputFile(path: string): Promise<InputFile> {
  const bytes = await readFile(path);
  return { filename: basename(path), mimeType: mimeTypeFor(path), dataBase64: bytes.toString("base64") };
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

function conversationText(events: readonly StreamEvent[]): string {
  return events
    .filter((event): event is Extract<StreamEvent, { type: "message" }> => event.type === "message")
    .map((event) => `${event.role}: ${event.text}`)
    .join("\n");
}

function requireInputRequest(session: RunSession, filter?: InputRequestFilter): InputRequest {
  const matches = session.pendingInputRequests.filter((request) => inputRequestMatches(request, filter));
  if (matches.length !== 1) throw new Error(`Expected exactly one pending input request, found ${matches.length}`);
  return matches[0]!;
}

function requireRequestId(request: InputRequest): string {
  if (!request.id) throw new Error("Input request has no stable id");
  return request.id;
}

function validateOptionId(request: InputRequest, optionId: string): void {
  const ids = (request.options ?? []).map((option) => option.id);
  if (!ids.includes(optionId)) throw new Error(`Option ${JSON.stringify(optionId)} is not available for this input request`);
}

function buildRespondInput(
  session: RunSession,
  answers: readonly (string | RespondAnswer)[],
): { readonly text: string; readonly responses: InputResponse[] } {
  const text: string[] = [];
  const responses: InputResponse[] = [];
  for (const answer of answers) {
    if (typeof answer === "string") {
      const response = resolveStringAnswer(session, answer);
      text.push(answer);
      responses.push(response);
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
  return { text: text.join("\n"), responses };
}

function resolveStringAnswer(session: RunSession, text: string): InputResponse {
  if (session.pendingInputRequests.length !== 1) {
    throw new Error(`A string response requires exactly one pending input request, found ${session.pendingInputRequests.length}`);
  }
  const request = session.pendingInputRequests[0]!;
  const requestId = requireRequestId(request);
  return (request.options ?? []).some((option) => option.id === text) ? { requestId, optionId: text } : { requestId, text };
}

function inputRequestMatches(request: InputRequest, filter?: InputRequestFilter): boolean {
  if (filter === undefined) return true;
  if (filter.id !== undefined && !stringMatches(request.id ?? "", filter.id)) return false;
  if (filter.prompt !== undefined && !stringMatches(request.prompt ?? "", filter.prompt)) return false;
  if (filter.display !== undefined && !stringMatches(request.display ?? "", filter.display)) return false;
  if (filter.action !== undefined && !stringMatches(request.action ?? "", filter.action)) return false;
  if (filter.input !== undefined && !matchesJson(request.input, filter.input)) return false;
  if (filter.optionIds !== undefined) {
    const options = new Set((request.options ?? []).map((option) => option.id));
    if (options.size !== filter.optionIds.length || !filter.optionIds.every((id) => options.has(id))) return false;
  }
  return true;
}

function stringMatches(actual: string, expected: string | RegExp): boolean {
  return expected instanceof RegExp ? expected.test(actual) : actual === expected;
}
