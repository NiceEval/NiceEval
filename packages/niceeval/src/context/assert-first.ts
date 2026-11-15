import { bindConversationMaterial, projectConversation } from "../assertions/conversation-material.ts";
import { AttemptNotesCollector } from "./notes.ts";
import { bindSimulatedUser } from "../simulated-user/binding.ts";
import { SimulatedUserError, type SimulatedUser, type SimulatedUserDefinition } from "../simulated-user/definition.ts";
import type { SimulatedUserActivity } from "../simulated-user/audit.ts";
import { createSimulatedUserConversation } from "../simulated-user/runtime.ts";
import { compareCanonicalDecimal } from "../o11y/adapter-usage-projection.ts";
import { canonicalDecimalFromNumber } from "../record/family/adapter-usage/pricing.ts";
import { ownMaterialCollection } from "../assertions/material.ts";
import {
  defineMaterialMatch,
  type MaterialCollection,
  type MaterialMatch,
  type ContextualMatch,
} from "../assertions/context-match.ts";
import { projectAgentEvalUsage, type EvalUsage } from "../o11y/eval-usage.ts";
import { registerMaterialQA, bindAssertionContext, createScopedAssertionCheck } from "../assertions/runtime.ts";
import type { ExperimentFlags } from "../shared/types.ts";
/**
 * The active Eval context. Assertion authoring deliberately enters through
 * `AssertionsRuntime`; this module never constructs an intermediate Fact or
 * starts a private runtime.
 */

import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";

import { Effect } from "effect";

import {
  assertAssertionSubject,
  captureAssertionSnapshot,
  createAssertionsRuntime,
  postRunBooleanAssertionHandle,
} from "../assertions/runtime.ts";
import type {
  AssertionCriterion,
  AssertionMaterial,
  AssertionSubject,
  AssertionsRuntime,
  BooleanAssertionHandle,
  BooleanAssertionEvaluation,
  ScoreFunction,
  MatcherSourceLocator,
  MatcherSourceSnapshot,
  MeasurementAssertionHandle,
  PostRunBooleanAssertionHandle,
} from "../assertions/api.ts";
import type { MatcherSourceRow } from "../assertions/matcher-artifact.ts";
import {
  matchedAssertionEvaluation,
  mismatchedAssertionEvaluation,
  unavailableAssertionEvaluation,
} from "../assertions/api.ts";
import { createMatchDiagnostic } from "../assertions/match.ts";
import {
  agentWorkspaceDiffChangesForPath,
  agentWorkspaceDiffPathsMatch,
  evaluateWorkspaceDiffNotIn,
  evaluateWorkspaceDiffIn,
  type AgentWorkspaceDiffEndpoint,
  type PostRunWorkspaceDiffState,
  type WorkspaceDiffNotInOptions,
} from "../assertions/workspace-diff.ts";
import { assertCanonicalWorkspaceRelativePath, validateExpectedTouchedPaths } from "../assertions/diff.ts";
import {
  collectionMatchRegistration,
  freezeManagedEventOccurrences,
  freezeManagedToolCalls,
} from "../assertions/collection.ts";
import {
  atMost,
  assertManagedEventMatch,
  assertManagedToolMatch,
  evaluateBooleanMatch,
  inOrder,
  collectionMatchSpecOf,
  isManagedCollectionMatch,
  isManagedEventMatch,
  isManagedToolMatch,
  defineValueMatch,
  managedScoreMatchOf,
  makeAssertionMessageEvent,
  makeAssertionToolEvent,
  toolMatch,
  type BooleanMatch,
  type EventMatch,
  type EventOccurrenceMatch,
  type EventOccurrenceView,
  type ManagedEventOccurrences,
  type ManagedToolCalls,
  type ScoreMatch,
  type ToolMatch,
  type ToolOccurrenceMatch,
} from "../assertions/match.ts";
import {
  factuality,
  faithfulness,
  instructionFollowing,
  pairwisePreference,
  type FactualityMaterial,
  type FaithfulnessMaterial,
  type InstructionFollowingMaterial,
  type JudgePresetOptions,
  type PairwisePreferenceMaterial,
} from "../assertions/judge-presets.ts";
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
  type ObservedTurnSnapshot,
} from "../o11y/observed.ts";
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
  JsonValue,
  PriceOverride,
  ResolvedJudgeConfig,
  Sandbox,
  SandboxOperations,
  SandboxTransferOperations,
  StreamEvent,
  Turn,
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
  simulatedUserFailure: SimulatedUserError | undefined;
  readonly closeSimulatedUsers: () => Promise<void>;
  readonly notes: AttemptNotesCollector;
  readonly assertions: AssertionsRuntime<"pass" | "score">;
  readonly manager: SessionManager;
  readonly late: AssertFirstLateResult;
}

export interface AssertFirstCoreContextState {
  readonly notes: AttemptNotesCollector;
  readonly assertions: AssertionsRuntime<"pass" | "score">;
  skipReason: string | undefined;
}

export interface AssertFirstCoreContextDeps {
  readonly judgeUsage?: import("../o11y/judge-usage.ts").JudgeUsageCollector | undefined;
  readonly readUsage?: (() => EvalUsage) | undefined;
  readonly elapsedMs?: (() => number) | undefined;
  readonly model?: string | undefined;
  readonly reasoningEffort?: string | undefined;
  readonly flags: ExperimentFlags;
  readonly signal: AbortSignal;
  readonly log: (message: string) => void;
  readonly feedback?: import("../types.ts").ScopedFeedback | undefined;
  readonly judge: ResolvedJudgeConfig | undefined;
  readonly executeStop: import("../assertions/api.ts").AssertionStopExecutor;
  readonly evaluationKind: RuntimeKind;
}

export type AssertFirstCoreTestContext<Kind extends RuntimeKind = RuntimeKind> = JudgePresetMethods<Kind> & {
  /** Record display data without affecting Assertions, Verdict or score. */
  note(
    label: string,
    value: import("../shared/types.ts").JsonValue | import("../assertions/quantity.ts").Quantity,
  ): void;
  readonly usage: EvalUsage;
  readonly elapsedMs: import("../assertions/match.ts").NumericMaterial;
  maxTokens(max: number): BooleanAssertionHandle<Kind, number>;
  maxCost(usd: number | string): BooleanAssertionHandle<Kind, string>;
  readonly evaluationKind: Kind;
  readonly signal: AbortSignal;
  readonly model: string | undefined;
  readonly reasoningEffort: string | undefined;
  readonly flags: ExperimentFlags;
  progress(update: import("../types.ts").ProgressUpdate): void;
  diagnostic(input: import("../types.ts").DiagnosticInput): void;
  log(message: string): void;
  skip(reason: string): never;
  group<Value>(title: string, body: () => Value | PromiseLike<Value>): Promise<Awaited<Value>>;
  check: import("../assertions/api.ts").AssertionCheck<Kind>;
  agentJudge: import("../assertions/api.ts").AgentJudgeFunction<Kind>;
  judge: JudgeFunction<Kind>;
} & (Kind extends "score" ? { readonly score: ScoreFunction } : {});

/** The Runner-facing dependencies retain the current SessionManager boundary. */
export interface AssertFirstContextDeps {
  readonly captureSimulatedUser?: ((activity: SimulatedUserActivity) => Promise<void>) | undefined;
  readonly deadlineAt?: number | undefined;
  readonly judgeUsage?: import("../o11y/judge-usage.ts").JudgeUsageCollector | undefined;
  readonly agent: Agent;
  readonly sandbox: Sandbox;
  readonly evalId?: string | undefined;
  readonly attempt?: import("../types.ts").AgentContext["attempt"] | undefined;
  readonly evalGroup?: import("../types.ts").AgentContext["evalGroup"] | undefined;
  readonly model?: string | undefined;
  /** defineConfig({ pricing }) 的价目表,只供 maxCost 的 estimatedCostUSD 估算(estimateCost);与 observed usage.costUSD 无关。 */
  readonly pricing?: globalThis.Record<string, PriceOverride> | undefined;
  readonly reasoningEffort?: string | undefined;
  readonly flags: ExperimentFlags;
  readonly experimentId?: string | undefined;
  readonly signal: AbortSignal;
  readonly log: (message: string) => void;
  readonly telemetry?: import("../types.ts").Telemetry | undefined;
  readonly otel?: import("../o11y/otlp/turn-otel.ts").AgentOtelChannel | undefined;
  readonly feedback?: import("../types.ts").ScopedFeedback | undefined;
  readonly onSendActive?: ((active: boolean) => void) | undefined;
  readonly ledgerHooks?: import("./session.ts").SessionDeps["ledgerHooks"] | undefined;
  readonly elapsedMs?: (() => number) | undefined;
  readonly timingNow?: import("./session.ts").SessionDeps["timingNow"] | undefined;
  readonly onTurn?: import("./session.ts").SessionDeps["onTurn"] | undefined;
  readonly concurrencySlot?: ConcurrencySlot | undefined;
  /** Attempt-owned source snapshot registry; never inferred from an Effect fiber. */
  readonly sourceRegistry?: SourceRegistry | undefined;
  readonly resources: import("../types.ts").AttemptResourceRegistry;
  /** Shared ordering with Assertion runtime source facts and Session user events. */
  readonly nextSourceOrder?: (() => number) | undefined;
  readonly judge: ResolvedJudgeConfig | undefined;
  /** The Attempt-scoped bridge is the sole Promise facade for author sends. */
  readonly requestEffect: NonNullable<SessionDeps["requestEffect"]>;
  /** Ordinary immediate Assertion stop barriers stay in the Attempt Effect Scope. */
  readonly executeStop: import("../assertions/api.ts").AssertionStopExecutor;
  readonly evaluationKind: "pass" | "score";
}

type RuntimeKind = "pass" | "score";
type AssertFirstRespondAnswer = { readonly request: InputRequest } & AnswerValue;

export interface JudgePresetMethods<Kind extends RuntimeKind, Context = unknown> {
  factuality(material: FactualityMaterial, options?: JudgePresetOptions): MeasurementAssertionHandle<Kind>;
  faithfulness(material: FaithfulnessMaterial, options?: JudgePresetOptions): MeasurementAssertionHandle<Kind>;
  instructionFollowing(
    material: InstructionFollowingMaterial,
    options?: JudgePresetOptions,
  ): MeasurementAssertionHandle<Kind>;
  pairwisePreference(
    material: PairwisePreferenceMaterial,
    options?: JudgePresetOptions,
  ): MeasurementAssertionHandle<Kind>;
  closeQA<T>(
    selector: MaterialMatch<Context, T>,
    question: string,
    options?: JudgePresetOptions,
  ): MeasurementAssertionHandle<Kind>;
}

/** Agent supplies its receiver's complete default history to the shared QA capability. */
export interface AgentJudgePresetMethods<Kind extends RuntimeKind, Context> extends JudgePresetMethods<Kind, Context> {
  closeQA(question: string, options?: JudgePresetOptions): MeasurementAssertionHandle<Kind>;
  closeQA(
    selector: ToolMatch | EventMatch,
    question: string,
    options?: JudgePresetOptions,
  ): MeasurementAssertionHandle<Kind>;
  closeQA<T>(
    selector: MaterialMatch<Context, T>,
    question: string,
    options?: JudgePresetOptions,
  ): MeasurementAssertionHandle<Kind>;
}

interface AgentHistoryFrame {
  cut: MatcherSourceSnapshot | undefined;
  read: (cut: MatcherSourceSnapshot) => MaterialCollection<Readonly<Record<string, unknown>>>;
}
const agentQACapture = { maxItems: 16384, maxBytes: 4 * 1024 * 1024, maxNodes: 1048576, maxDepth: 64 };
function agentJudgePresetMethods<Kind extends RuntimeKind, S extends AssertionScope>(
  check: import("../assertions/api.ts").AssertionCheck<Kind, AgentMatchContext<S>>,
  frame: AgentHistoryFrame,
): AgentJudgePresetMethods<Kind, AgentMatchContext<S>> {
  const defaults = defineMaterialMatch<AgentMatchContext<S>, Readonly<Record<string, unknown>>>({
    name: "agent-history",
    read: () =>
      frame.cut === undefined
        ? { state: "unavailable", reason: "agent-history-receiver-closed" }
        : frame.read(frame.cut),
    match: defineValueMatch({
      name: "all-history-items",
      evaluate: (_value: Readonly<Record<string, unknown>>) => true,
    }),
    capture: agentQACapture,
  });
  const closeQA = (first: unknown, second?: unknown, third?: JudgePresetOptions, ...extra: readonly unknown[]) => {
    if (extra.length > 0)
      throw new TypeError("closeQA accepts question and options, or selector, question and options");
    let selector: ContextualMatch;
    let question: string;
    let options: JudgePresetOptions | undefined;
    if (typeof first === "string") {
      if (third !== undefined) throw new TypeError("closeQA(question, options) accepts two arguments");
      selector = defaults as ContextualMatch;
      question = first;
      options = second as JudgePresetOptions | undefined;
    } else {
      question = second as string;
      options = third;
      function contextualSelector(): ContextualMatch {
        if (isManagedToolMatch(first))
          return defineMaterialMatch<AgentMatchContext<S>>({
            name: "agent-tool-history",
            read: (ctx) => ctx.toolCalls as ManagedToolCalls<S>,
            match: first,
            capture: agentQACapture,
          }) as ContextualMatch;
        if (isManagedEventMatch(first))
          return defineMaterialMatch<AgentMatchContext<S>>({
            name: "agent-event-history",
            read: (ctx) => ctx.eventOccurrences as ManagedEventOccurrences<S>,
            match: first,
            capture: agentQACapture,
          }) as ContextualMatch;
        return first as ContextualMatch;
      }
      selector = contextualSelector();
    }
    return registerMaterialQA(check, selector, question, options) as MeasurementAssertionHandle<Kind>;
  };
  return { ...judgePresetMethods(check), closeQA } as AgentJudgePresetMethods<Kind, AgentMatchContext<S>>;
}

function judgePresetMethods<Kind extends RuntimeKind, C = unknown>(
  check: import("../assertions/api.ts").AssertionCheck<Kind, C>,
): JudgePresetMethods<Kind, C> {
  const apply = <Material>(
    factory: (options?: JudgePresetOptions) => ScoreMatch<Material>,
    material: Material,
    options: JudgePresetOptions | undefined,
    extra: readonly unknown[],
    name: string,
  ): MeasurementAssertionHandle<Kind> => {
    if (extra.length > 0) throw new TypeError(`${name}() accepts material and optional options`);
    return (check as (value: Material, match: ScoreMatch<Material>) => MeasurementAssertionHandle<Kind>)(
      material,
      factory(options),
    );
  };
  return {
    factuality: (material: FactualityMaterial, options?: JudgePresetOptions, ...extra: readonly unknown[]) =>
      apply(factuality, material, options, extra, "factuality"),
    faithfulness: (material: FaithfulnessMaterial, options?: JudgePresetOptions, ...extra: readonly unknown[]) =>
      apply(faithfulness, material, options, extra, "faithfulness"),
    instructionFollowing: (
      material: InstructionFollowingMaterial,
      options?: JudgePresetOptions,
      ...extra: readonly unknown[]
    ) => apply(instructionFollowing, material, options, extra, "instructionFollowing"),
    pairwisePreference: (
      material: PairwisePreferenceMaterial,
      options?: JudgePresetOptions,
      ...extra: readonly unknown[]
    ) => apply(pairwisePreference, material, options, extra, "pairwisePreference"),
    closeQA: <T>(
      selector: MaterialMatch<C, T>,
      question: string,
      options?: JudgePresetOptions,
      ...extra: readonly unknown[]
    ) => {
      if (extra.length > 0) throw new TypeError("closeQA accepts selector, question and optional options");
      return registerMaterialQA(
        check,
        selector as ContextualMatch,
        question,
        options,
      ) as MeasurementAssertionHandle<Kind>;
    },
  };
}

export interface FileChangedOptions {
  readonly status?: "added" | "modified" | "deleted" | undefined;
  readonly before?: BooleanMatch<string, string, "value"> | undefined;
  readonly after?: BooleanMatch<string, string, "value"> | undefined;
}

/** The only agent-attributed post-run diff surface exposed to Eval authors. */
export interface AssertFirstSandbox<Kind extends RuntimeKind> extends SandboxOperations, SandboxTransferOperations {
  changedPaths(paths: readonly string[]): PostRunBooleanAssertionHandle<Kind, void>;
  changedOnlyWithin(paths: readonly [string, ...string[]]): PostRunBooleanAssertionHandle<Kind, void>;
  /** 保护列出的文件或目录，任何 agent 归因变化落入范围都不满足；至少提供一项且不支持 glob。 */
  unchangedWithin(paths: readonly [string, ...string[]]): PostRunBooleanAssertionHandle<Kind, void>;
  noChanges(): PostRunBooleanAssertionHandle<Kind, void>;
  fileChanged(path: string, options?: FileChangedOptions): PostRunBooleanAssertionHandle<Kind, void>;
  fileDeleted(path: string): PostRunBooleanAssertionHandle<Kind, void>;
  /** Match changed paths or selected changed lines. With content: "none", only paths are searched. */
  inDiff(pattern: RegExp, options?: WorkspaceDiffNotInOptions): PostRunBooleanAssertionHandle<Kind, void>;
  /** Exclude patterns from changed paths and selected lines. content: "none" searches only paths. */
  notInDiff(pattern: RegExp, options?: WorkspaceDiffNotInOptions): PostRunBooleanAssertionHandle<Kind, void>;
}

export interface AssertFirstTurnHandle<Kind extends RuntimeKind>
  extends AgentJudgePresetMethods<Kind, AgentMatchContext<"turn">> {
  readonly input: string;
  readonly events: readonly StreamEvent[];
  readonly inputRequests: readonly InputRequest[];
  readonly toolCalls: ManagedToolCalls<"turn">;
  readonly eventOccurrences: ManagedEventOccurrences<"turn">;
  readonly status: "completed" | "failed" | "waiting";
  readonly reply: string;
  readonly data: JsonValue | undefined;
  readonly usage: EvalUsage;
  check: import("../assertions/api.ts").AssertionCheck<Kind, AgentMatchContext<"turn">>;
  agentJudge: import("../assertions/api.ts").AgentJudgeFunction<Kind>;
  judge: JudgeFunction<Kind>;
  succeeded(): BooleanAssertionHandle<Kind, void>;
  calledTool(match: ToolMatch | ToolOccurrenceMatch): BooleanAssertionHandle<Kind, void>;
  calledTool(name: string): BooleanAssertionHandle<Kind, void>;
  notCalledTool(match: ToolMatch): BooleanAssertionHandle<Kind, void>;
  notCalledTool(name: string): BooleanAssertionHandle<Kind, void>;
  toolOrder(matches: readonly [ToolMatch, ToolMatch, ...ToolMatch[]]): BooleanAssertionHandle<Kind, void>;
  usedNoTools(): BooleanAssertionHandle<Kind, void>;
  maxToolCalls(max: number): BooleanAssertionHandle<Kind, void>;
  noFailedActions(): BooleanAssertionHandle<Kind, void>;
  event(match: EventMatch | EventOccurrenceMatch): BooleanAssertionHandle<Kind, void>;
  notEvent(match: EventMatch): BooleanAssertionHandle<Kind, void>;
  eventOrder(matches: readonly [EventMatch, EventMatch, ...EventMatch[]]): BooleanAssertionHandle<Kind, void>;
  readonly elapsedMs: import("../assertions/match.ts").NumericMaterial;
  maxTokens(max: number): BooleanAssertionHandle<Kind, number>;
  maxCost(usd: number | string): BooleanAssertionHandle<Kind, string>;
}

export interface AssertFirstSessionHandle<Kind extends RuntimeKind>
  extends AgentJudgePresetMethods<Kind, AgentMatchContext<"session">> {
  simulatedUser(definition: SimulatedUserDefinition): SimulatedUser<Kind>;
  send(
    input: string | { readonly text: string; readonly files?: readonly InputFile[] },
  ): Promise<AssertFirstTurnHandle<Kind>>;
  sendFile(path: string, text?: string): Promise<AssertFirstTurnHandle<Kind>>;
  requireInputRequest(filter?: InputRequestFilter): InputRequest;
  respond(...responses: readonly (string | AssertFirstRespondAnswer)[]): Promise<AssertFirstTurnHandle<Kind>>;
  respondAll(optionId: string): Promise<AssertFirstTurnHandle<Kind>>;
  readonly reply: string;
  readonly sessionId: string | undefined;
  readonly events: readonly StreamEvent[];
  readonly usage: EvalUsage;
  readonly toolCalls: ManagedToolCalls<"session">;
  readonly eventOccurrences: ManagedEventOccurrences<"session">;
  check: import("../assertions/api.ts").AssertionCheck<Kind, AgentMatchContext<"session">>;
  agentJudge: import("../assertions/api.ts").AgentJudgeFunction<Kind>;
  judge: JudgeFunction<Kind>;
  succeeded(): BooleanAssertionHandle<Kind, void>;
  calledTool(match: ToolMatch | ToolOccurrenceMatch): BooleanAssertionHandle<Kind, void>;
  calledTool(name: string): BooleanAssertionHandle<Kind, void>;
  notCalledTool(match: ToolMatch): BooleanAssertionHandle<Kind, void>;
  notCalledTool(name: string): BooleanAssertionHandle<Kind, void>;
  toolOrder(matches: readonly [ToolMatch, ToolMatch, ...ToolMatch[]]): BooleanAssertionHandle<Kind, void>;
  usedNoTools(): BooleanAssertionHandle<Kind, void>;
  maxToolCalls(max: number): BooleanAssertionHandle<Kind, void>;
  noFailedActions(): BooleanAssertionHandle<Kind, void>;
  event(match: EventMatch | EventOccurrenceMatch): BooleanAssertionHandle<Kind, void>;
  notEvent(match: EventMatch): BooleanAssertionHandle<Kind, void>;
  eventOrder(matches: readonly [EventMatch, EventMatch, ...EventMatch[]]): BooleanAssertionHandle<Kind, void>;
  readonly elapsedMs: import("../assertions/match.ts").NumericMaterial;
  maxTokens(max: number): BooleanAssertionHandle<Kind, number>;
  maxCost(usd: number | string): BooleanAssertionHandle<Kind, string>;
}

type JudgeFunction<Kind extends RuntimeKind> = <Value>(
  value: AssertionSubject<Value>,
  definition: ScoreMatch<NoInfer<Value>>,
) => MeasurementAssertionHandle<Kind>;

export type AssertFirstTestContext<Kind extends RuntimeKind> = AgentJudgePresetMethods<
  Kind,
  AgentMatchContext<"attempt">
> & {
  simulatedUser(definition: SimulatedUserDefinition): SimulatedUser<Kind>;
  /** 保存 JSON 值或 Quantity 供结果展示，不登记 Assertion，也不影响 Verdict、score 或 coverage。 */
  note: AssertFirstCoreTestContext<Kind>["note"];
  readonly evaluationKind: Kind;
  send(
    input: string | { readonly text: string; readonly files?: readonly InputFile[] | undefined },
  ): Promise<AssertFirstTurnHandle<Kind>>;
  sendFile(path: string, text?: string): Promise<AssertFirstTurnHandle<Kind>>;
  requireInputRequest(filter?: InputRequestFilter): InputRequest;
  respond(...responses: readonly (string | AssertFirstRespondAnswer)[]): Promise<AssertFirstTurnHandle<Kind>>;
  respondAll(optionId: string): Promise<AssertFirstTurnHandle<Kind>>;
  readonly reply: string;
  readonly sessionId: string | undefined;
  readonly events: readonly StreamEvent[];
  readonly eventOccurrences: ManagedEventOccurrences<"attempt">;
  newSession(): AssertFirstSessionHandle<Kind>;
  readonly signal: AbortSignal;
  readonly model: string | undefined;
  readonly reasoningEffort: string | undefined;
  readonly flags: ExperimentFlags;
  progress(update: import("../types.ts").ProgressUpdate): void;
  diagnostic(input: import("../types.ts").DiagnosticInput): void;
  log(message: string): void;
  skip(reason: string): never;
  group<Value>(title: string, body: () => Value | PromiseLike<Value>): Promise<Awaited<Value>>;
  check: import("../assertions/api.ts").AssertionCheck<Kind, AgentMatchContext<"attempt">>;
  agentJudge: import("../assertions/api.ts").AgentJudgeFunction<Kind>;
  judge: JudgeFunction<Kind>;
  readonly toolCalls: ManagedToolCalls<"attempt">;
  readonly sandbox: AssertFirstSandbox<Kind>;
  readonly observability: import("../o11y/types.ts").ObservabilitySummary;
  readonly usage: EvalUsage;
  succeeded(): BooleanAssertionHandle<Kind, void>;
  calledTool(match: ToolMatch | ToolOccurrenceMatch): BooleanAssertionHandle<Kind, void>;
  calledTool(name: string): BooleanAssertionHandle<Kind, void>;
  notCalledTool(match: ToolMatch): BooleanAssertionHandle<Kind, void>;
  notCalledTool(name: string): BooleanAssertionHandle<Kind, void>;
  toolOrder(matches: readonly [ToolMatch, ToolMatch, ...ToolMatch[]]): BooleanAssertionHandle<Kind, void>;
  eventOrder(matches: readonly [EventMatch, EventMatch, ...EventMatch[]]): BooleanAssertionHandle<Kind, void>;
  usedNoTools(): BooleanAssertionHandle<Kind, void>;
  maxToolCalls(max: number): BooleanAssertionHandle<Kind, void>;
  noFailedActions(): BooleanAssertionHandle<Kind, void>;
  event(match: EventMatch | EventOccurrenceMatch): BooleanAssertionHandle<Kind, void>;
  notEvent(match: EventMatch): BooleanAssertionHandle<Kind, void>;
  readonly elapsedMs: import("../assertions/match.ts").NumericMaterial;
  maxTokens(max: number): BooleanAssertionHandle<Kind, number>;
  maxCost(usd: number | string): BooleanAssertionHandle<Kind, string>;
} & (Kind extends "score" ? { readonly score: ScoreFunction } : {});

/** Supplies readonly Agent facts for the current turn, session or Attempt; managed collections cannot be mixed across receivers or Attempts. */
export interface AgentMatchContext<Scope extends "turn" | "session" | "attempt" = "attempt"> {
  readonly scope: Scope;
  readonly toolCalls: ManagedToolCalls<Scope>;
  readonly eventOccurrences: ManagedEventOccurrences<Scope>;
  readonly usage: EvalUsage;
}
type AssertionScope = "turn" | "session" | "attempt";
type ScopeStatus = "completed" | "failed" | "waiting" | "not-started";
type ScopeCoverage = import("../assertions/coverage.ts").ResolvedEvidenceCoverage;

function scopeCriterion(
  scope: AssertionScope,
  assertion: "succeeded" | "no-failed-actions" = "succeeded",
): AssertionCriterion {
  return {
    kind: "scope-status" as const,
    scope,
    assertion,
  };
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
      Effect.sync(function succeededResult() {
        if (input.status === "not-started") return mismatchedVoid();
        if (scopeCoverageState(input.coverage, "status") !== "complete") {
          return unavailableDiffResult();
        }
        if (input.status === "completed") return matchedVoid();
        return mismatchedVoid();
      }),
    terminalCriterion: () => scopeCriterion(input.scope),
    terminalEvidence: () => [],
    terminalReceipt: () => undefined,
    retainedBytes: 0,
    evidence: [],
    interruptedMatcherArtifact: undefined,
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
}

type ResolveObservedEvaluation = (snapshot: ObservedTurnSnapshot) => ObservedEvaluationSegment | undefined;

interface ToolScopeSnapshot {
  readonly occurrences: readonly LogicalToolOccurrence[];
  readonly rows: readonly MatcherSourceRow<ProjectedMatcherCandidate<LogicalToolOccurrence>>[];
  readonly orphanFinishes: readonly OrphanToolOperationFinish[];
  readonly sourceSnapshot: MatcherSourceSnapshot;
  readonly coverage: ScopeCoverage;
  readonly snapshot: unknown;
}

interface ToolScopeProjectionCache {
  readonly cutKey: string;
  readonly value: ToolScopeSnapshot;
}

function toolScopeCutKey(sourceSnapshot: MatcherSourceSnapshot, snapshot: unknown): string {
  const encoded = JSON.stringify([sourceSnapshot, snapshot]);
  if (encoded === undefined) {
    throw new Error("Tool scope cut must be JSON-serializable");
  }
  return encoded;
}

function unavailableSourceSnapshot(snapshot: MatcherSourceSnapshot): MatcherSourceSnapshot {
  return { ...snapshot, collectionAtCut: "unavailable" as const };
}

function projectMatcherSources(
  turns: readonly MatcherScopeTurn[],
  resolveEvaluation: ResolveObservedEvaluation,
): MatcherSourceProjection {
  const evaluation = turns.map((turn) => resolveEvaluation(turn.observed));
  if (evaluation.some((segment) => segment === undefined)) {
    return {
      state: "invalid" as const,
      events: [],
      toolOccurrences: [],
      occurrenceCandidates: new Map<string, LogicalToolOccurrence>(),
      orphanFinishes: [],
    };
  }
  const segments = evaluation as readonly ObservedEvaluationSegment[];
  const projected = projectObservedSourceEvents(segments);
  const logicalTurns: readonly LogicalToolOccurrenceScopeTurn[] = segments.map((segment, index) => ({
    session: segment.sessionId,
    turn: segment.turnId,
    turnOrdinal: index + 1,
    events: segment.events,
    outcome: turns[index]!.outcome,
  }));
  const logical = deriveScopedLogicalToolOccurrences(logicalTurns);
  if (projected.state === "invalid") {
    return {
      state: "invalid" as const,
      events: [],
      toolOccurrences: [],
      occurrenceCandidates: new Map<string, LogicalToolOccurrence>(),
      orphanFinishes: logical.orphanFinishes,
    };
  }

  const occurrenceCandidates = new Map<string, LogicalToolOccurrence>();
  for (const occurrence of logical.occurrences) {
    const segment = segments[occurrence.start.turnOrdinal - 1];
    const start = segment?.items[occurrence.start.eventOrdinal];
    if (segment === undefined || start?.kind !== "tool-start") continue;
    occurrenceCandidates.set(start.toolOccurrenceId, {
      ...occurrence,
      id: start.toolOccurrenceId,
      session: segment.sessionId,
      turn: segment.turnId,
    });
  }
  return {
    state: "available" as const,
    events: projected.events,
    toolOccurrences: projected.toolOccurrences,
    occurrenceCandidates,
    orphanFinishes: logical.orphanFinishes,
  };
}

function exactToolLocator(toolOccurrenceId: string): MatcherSourceLocator {
  return {
    kind: "tool-occurrence" as const,
    toolOccurrenceId,
    relation: { state: "exact" as const },
  };
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
  const sourceSnapshot =
    projection.state === "invalid" ? unavailableSourceSnapshot(input.sourceSnapshot) : input.sourceSnapshot;
  const sourceRows =
    input.homeTurnId === undefined
      ? projection.toolOccurrences
      : projection.toolOccurrences.filter((row) => row.homeTurnId === input.homeTurnId);
  const rows = sourceRows.map((row) => {
    const candidate = projection.occurrenceCandidates.get(row.toolOccurrenceId);
    return {
      locator: exactToolLocator(row.toolOccurrenceId),
      sessionId: row.sessionId,
      sessionSequence: row.startSessionSequence,
      candidate:
        candidate === undefined
          ? {
              state: "unavailable" as const,
              reason: "source-occurrence-material-unavailable",
            }
          : { state: "available" as const, value: candidate },
    };
  });
  return {
    occurrences: rows.flatMap((row) => (row.candidate.state === "available" ? [row.candidate.value] : [])),
    rows,
    orphanFinishes: projection.orphanFinishes,
    sourceSnapshot,
    coverage: input.coverage,
    snapshot: input.snapshot,
  };
}

function resolveToolTarget(target: ToolMatch | string, label: "calledTool" | "notCalledTool"): ToolMatch {
  if (typeof target === "string") return toolMatch(target);
  return assertManagedToolMatch(target, `${label}() match`);
}

function toolScopeCoverageReason(snapshot: ToolScopeSnapshot): string | undefined {
  const actions = snapshot.coverage.actions;
  // Missing command/not-command classification limits commandMatch(), not the
  // completeness of the already captured tool occurrence set. Tool name/input/
  // lifecycle counts remain decidable; commandMatch itself retains unavailable
  // evidence when an occurrence has no command projection.
  if (actions.status !== "complete" && actions.reason !== UNCLASSIFIED_TOOL_ACTIONS_REASON) {
    return `scope-actions-${actions.status}:${actions.reason}`;
  }
  if (snapshot.orphanFinishes.length > 0) {
    return `orphan-tool-finish:${snapshot.orphanFinishes.length}`;
  }
  return undefined;
}

function registerCollectionCheck<Kind extends RuntimeKind, Subject>(
  runtime: AssertionsRuntime<Kind>,
  subject: Subject,
  match: unknown,
): BooleanAssertionHandle<Kind, void> {
  return (runtime.t.check as unknown as (subject: Subject, match: unknown) => BooleanAssertionHandle<Kind, void>)(
    subject,
    match,
  );
}

function calledToolHandle<Kind extends RuntimeKind>(input: {
  readonly runtime: AssertionsRuntime<Kind>;
  readonly subject: ManagedToolCalls;
  readonly target: ToolMatch | ToolOccurrenceMatch | string;
}): BooleanAssertionHandle<Kind, void> {
  if (typeof input.target === "string")
    return registerCollectionCheck(input.runtime, input.subject, toolMatch(input.target));
  if (!isManagedCollectionMatch(input.target)) {
    return registerCollectionCheck(
      input.runtime,
      input.subject,
      assertManagedToolMatch(input.target, "calledTool() match"),
    );
  }
  const spec = collectionMatchSpecOf(input.target);
  if (spec.kind !== "occurrence" || spec.domain !== "tool") {
    throw new TypeError("calledTool() accepts only a ToolMatch or positive ToolOccurrenceMatch");
  }
  if ((spec.quantifier.kind === "exact" || spec.quantifier.kind === "at-least") && spec.quantifier.count === 0) {
    throw new TypeError("calledTool() requires a positive occurrence; exactly(0) and atLeast(0) are invalid");
  }
  if (spec.quantifier.kind === "at-most" || spec.quantifier.kind === "less-than" || spec.quantifier.kind === "absent") {
    throw new TypeError("calledTool() does not accept an upper-bound occurrence Match");
  }
  return registerCollectionCheck(input.runtime, input.subject, input.target);
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

function matchedVoid(diagnostic?: import("../assertions/match.ts").MatchDiagnostic): BooleanAssertionEvaluation<void> {
  return matchedAssertionEvaluation(undefined, diagnostic);
}

function mismatchedVoid(
  diagnostic?: import("../assertions/match.ts").MatchDiagnostic,
): BooleanAssertionEvaluation<void> {
  return mismatchedAssertionEvaluation(diagnostic);
}

function unavailableVoid(): BooleanAssertionEvaluation<void> {
  return unavailableAssertionEvaluation("evidence-unavailable");
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
    interruptedMatcherArtifact: input.interruptedMatcherArtifact,
    evaluate: input.evaluate,
    terminalEvidence: () => [],
    terminalCriterion: () => input.criterion,
    terminalReceipt: () => undefined,
    evidence: [],
    retainedBytes: 0,
  });
}

function hasCompleteCoverage(coverage: ScopeCoverage, channel: "actions" | "events" | "usage"): boolean {
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
  return registerCollectionCheck(input.runtime, input.subject, toolMatch({}).exactly(0));
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
    snapshot: {
      scope: input.scope,
      assertion: "no-failed-actions",
      eventCount: input.events.length,
      coverage: input.coverage.actions,
      snapshot: input.snapshot,
    },
    evaluate: () =>
      Effect.sync(() => {
        const facts = deriveRunFacts(input.events);
        const failed =
          facts.toolCalls.some((call) => call.status === "failed") ||
          facts.subagentCalls.some((call) => call.status === "failed");
        if (failed) return mismatchedVoid();
        return hasCompleteCoverage(input.coverage, "actions") ? matchedVoid() : unavailableVoid();
      }),
  });
}

function toolOrderHandle<Kind extends RuntimeKind>(input: {
  readonly runtime: AssertionsRuntime<Kind>;
  readonly subject: ManagedToolCalls<"turn"> | ManagedToolCalls<"session">;
  readonly matches: readonly [ToolMatch, ToolMatch, ...ToolMatch[]];
}): BooleanAssertionHandle<Kind, void> {
  return registerCollectionCheck(input.runtime, input.subject, inOrder(input.matches));
}

function managedToolCalls(scope: AssertionScope, snapshot: ToolScopeSnapshot, check: object): ManagedToolCalls {
  const incompleteReason = toolScopeCoverageReason(snapshot);
  const collection = freezeManagedToolCalls({
    scope,
    sourceSnapshot: snapshot.sourceSnapshot,
    rows: snapshot.rows,
    ...(incompleteReason === undefined ? {} : { incompleteReason }),
    actionsCoverage: snapshot.coverage.actions,
    orphanFinishCount: snapshot.orphanFinishes.length,
    snapshot: snapshot.snapshot,
  });
  ownMaterialCollection(check, collection);
  return collection;
}

function managedEventOccurrences(
  scope: AssertionScope,
  snapshot: EventScopeSnapshot,
  check: object,
): ManagedEventOccurrences {
  const collection = freezeManagedEventOccurrences({
    scope,
    sourceSnapshot: snapshot.sourceSnapshot,
    rows: snapshot.rows,
    coverage: snapshot.coverage.events,
    snapshot: snapshot.snapshot,
    unassociatedOperation: snapshot.unassociatedOperation,
  });
  ownMaterialCollection(check, collection);
  return collection;
}

function eventHandle<Kind extends RuntimeKind>(input: {
  readonly runtime: AssertionsRuntime<Kind>;
  readonly subject: ManagedEventOccurrences;
  readonly match: EventMatch | EventOccurrenceMatch;
}): BooleanAssertionHandle<Kind, void> {
  if (!isManagedCollectionMatch(input.match)) {
    return registerCollectionCheck(input.runtime, input.subject, assertManagedEventMatch(input.match, "event() match"));
  }
  const spec = collectionMatchSpecOf(input.match);
  if (spec.kind !== "occurrence" || spec.domain !== "event") {
    throw new TypeError("event() accepts only an EventMatch or positive EventOccurrenceMatch");
  }
  if ((spec.quantifier.kind === "exact" || spec.quantifier.kind === "at-least") && spec.quantifier.count === 0) {
    throw new TypeError("event() requires a positive occurrence; exactly(0) and atLeast(0) are invalid");
  }
  if (spec.quantifier.kind === "at-most" || spec.quantifier.kind === "less-than" || spec.quantifier.kind === "absent") {
    throw new TypeError("event() does not accept an upper-bound occurrence Match");
  }
  return registerCollectionCheck(input.runtime, input.subject, input.match);
}

function notEventOccurrenceHandle<Kind extends RuntimeKind>(input: {
  readonly runtime: AssertionsRuntime<Kind>;
  readonly subject: ManagedEventOccurrences;
  readonly match: EventMatch;
}): BooleanAssertionHandle<Kind, void> {
  return registerCollectionCheck(
    input.runtime,
    input.subject,
    assertManagedEventMatch(input.match, "notEvent() match").exactly(0),
  );
}

interface EventScopeSnapshot {
  readonly events: readonly EventOccurrenceView[];
  readonly rows: readonly MatcherSourceRow<{ readonly state: "available"; readonly value: EventOccurrenceView }>[];
  readonly unassociatedOperation: boolean;
  readonly sourceSnapshot: MatcherSourceSnapshot;
  readonly coverage: ScopeCoverage;
  readonly snapshot: unknown;
}

function eventLocator(row: ObservedEventLedgerRow): MatcherSourceLocator {
  if (row.event.kind === "tool-start") {
    return {
      kind: "event" as const,
      eventId: row.eventId,
      toolOccurrenceId: row.event.toolOccurrenceId,
      relation: { state: "exact" as const },
    };
  }
  if (row.event.kind === "tool-finish") {
    return row.event.occurrence.state === "exact"
      ? {
          kind: "event" as const,
          eventId: row.eventId,
          toolOccurrenceId: row.event.occurrence.toolOccurrenceId,
          relation: { state: "exact" as const },
        }
      : {
          kind: "event" as const,
          eventId: row.eventId,
          relation: {
            state: "unavailable" as const,
            reason: "ambiguous" as const,
          },
        };
  }
  return {
    kind: "event" as const,
    eventId: row.eventId,
    relation: { state: "exact" as const },
  };
}

function projectEventScope(input: {
  readonly turns: readonly MatcherScopeTurn[];
  readonly sourceSnapshot: MatcherSourceSnapshot;
  readonly coverage: ScopeCoverage;
  readonly snapshot: unknown;
  readonly resolveEvaluation: ResolveObservedEvaluation;
}): EventScopeSnapshot {
  const projection = projectMatcherSources(input.turns, input.resolveEvaluation);
  const baseSourceSnapshot =
    projection.state === "invalid" ? unavailableSourceSnapshot(input.sourceSnapshot) : input.sourceSnapshot;
  const turnIndex = new Map(input.turns.map((turn, index) => [turn.observed.turnId, index]));
  const eventOrdinals = new Map<string, Map<string, number>>();
  for (const turn of input.turns) {
    const segment = input.resolveEvaluation(turn.observed);
    if (segment !== undefined) {
      eventOrdinals.set(turn.observed.turnId, new Map(segment.items.map((event, index) => [event.eventId, index])));
    }
  }
  const toolNames = new Map(
    projection.events.flatMap((row) =>
      row.event.kind === "tool-start" ? [[row.event.toolOccurrenceId, row.event.tool] as const] : [],
    ),
  );
  const rows: MatcherSourceRow<{ readonly state: "available"; readonly value: EventOccurrenceView }>[] = [];
  let omittedProjection = false;
  let incompleteRelation = false;
  for (const row of projection.events) {
    if (row.event.kind !== "message" && row.event.kind !== "tool-start" && row.event.kind !== "tool-finish") {
      continue;
    }
    const turnOrdinal = turnIndex.get(row.turnId);
    const sourceTurnPresent = turnOrdinal !== undefined && input.turns[turnOrdinal] !== undefined;
    const eventOrdinal = eventOrdinals.get(row.turnId)?.get(row.eventId) ?? -1;
    let publicView: EventOccurrenceView | undefined;
    if (row.event.kind === "message") {
      publicView = Object.freeze({ type: "message" as const, role: row.event.role, text: row.event.text });
    } else if (row.event.kind === "tool-start") {
      publicView = Object.freeze({
        type: "operation.started" as const,
        tool: Object.freeze({ name: row.event.tool }),
      });
    } else if (row.event.occurrence.state === "exact" && row.event.outcome !== "cancelled") {
      const name = toolNames.get(row.event.occurrence.toolOccurrenceId);
      if (name !== undefined) {
        publicView = Object.freeze({
          type: "operation.finished" as const,
          tool: Object.freeze({ name }),
          status: row.event.outcome,
        });
      }
    }
    if (publicView === undefined) {
      omittedProjection = true;
      continue;
    }

    let value: EventOccurrenceView = publicView;
    if (sourceTurnPresent && eventOrdinal >= 0 && row.event.kind === "message") {
      value = makeAssertionMessageEvent({
        eventId: row.eventId,
        turnOrdinal: (turnOrdinal ?? 0) + 1,
        eventOrdinal,
        role: row.event.role,
        text: row.event.text,
      });
    } else if (sourceTurnPresent && eventOrdinal >= 0 && row.event.kind !== "message") {
      function eventToolOccurrenceId() {
        if (row.event.kind === "tool-start") return row.event.toolOccurrenceId;
        if (row.event.kind === "tool-finish" && row.event.occurrence.state === "exact")
          return row.event.occurrence.toolOccurrenceId;
        return undefined;
      }
      const toolOccurrenceId = eventToolOccurrenceId();
      const occurrence =
        toolOccurrenceId === undefined ? undefined : projection.occurrenceCandidates.get(toolOccurrenceId);
      if (occurrence !== undefined) {
        value = makeAssertionToolEvent({
          eventId: row.eventId,
          toolOccurrenceId: toolOccurrenceId ?? occurrence.id,
          turnOrdinal: (turnOrdinal ?? 0) + 1,
          eventOrdinal,
          occurrence,
          ...(row.event.kind === "tool-start"
            ? { type: "operation.started" }
            : { type: "operation.finished", status: row.event.outcome }),
        });
      } else {
        incompleteRelation = true;
      }
    } else {
      incompleteRelation = true;
    }
    rows.push({
      locator: eventLocator(row),
      sessionId: row.sessionId,
      sessionSequence: row.sessionSequence,
      candidate: { state: "available" as const, value },
    });
  }
  const sourceSnapshot =
    omittedProjection && baseSourceSnapshot.collectionAtCut === "complete"
      ? { ...baseSourceSnapshot, collectionAtCut: "partial" as const }
      : baseSourceSnapshot;
  return {
    events: rows.map((row) => row.candidate.value),
    rows,
    unassociatedOperation: projection.state === "invalid" || omittedProjection || incompleteRelation,
    sourceSnapshot,
    coverage: input.coverage,
    snapshot: input.snapshot,
  };
}

const DIFF_REFERENCE_PREVIEW = "agent-attributed send-window endpoint deltas";

function changedPathsCriterion(paths: readonly string[]): AssertionCriterion {
  return {
    kind: "sandbox-result" as const,
    operation: "changed-paths" as const,
    paths,
  };
}

function noChangesCriterion(): AssertionCriterion {
  return {
    kind: "sandbox-result" as const,
    operation: "no-changes" as const,
  };
}

function fileChangedCriterion(path: string, options: Readonly<FileChangedOptions>): AssertionCriterion {
  return {
    kind: "sandbox-result" as const,
    operation: "file-changed" as const,
    path,
    status: options.status,
    before: options.before?.name,
    after: options.after?.name,
  };
}

function fileDeletedCriterion(path: string): AssertionCriterion {
  return {
    kind: "sandbox-result" as const,
    operation: "file-deleted" as const,
    path,
  };
}

function notInDiffCriterion(pattern: RegExp, options: Readonly<WorkspaceDiffNotInOptions>): AssertionCriterion {
  if (options.content === "none")
    return {
      kind: "sandbox-diff-paths" as const,
      operation: "not-in-diff" as const,
      pattern: pattern.source,
      flags: pattern.flags,
    };
  return {
    kind: "sandbox-result" as const,
    operation: "not-in-diff" as const,
    pattern: pattern.source,
    flags: pattern.flags,
    content: options.content ?? "both",
  };
}

function diffReferenceMaterial(): AssertionMaterial {
  return {
    kind: "record-attachment" as const,
    preview: DIFF_REFERENCE_PREVIEW,
  };
}

function assertDiffPath(path: unknown, operation: string): asserts path is string {
  assertCanonicalWorkspaceRelativePath(path, `${operation} path`);
}

function normalizeFileChangedOptions(value: FileChangedOptions | undefined): Readonly<FileChangedOptions> {
  if (value === undefined) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("fileChanged() options must be an object");
  }
  for (const key of Object.keys(value)) {
    if (key !== "status" && key !== "before" && key !== "after") {
      throw new TypeError(`fileChanged() options has unknown key ${JSON.stringify(key)}`);
    }
  }
  if (
    value.status !== undefined &&
    value.status !== "added" &&
    value.status !== "modified" &&
    value.status !== "deleted"
  ) {
    throw new TypeError("fileChanged() options.status must be added, modified, or deleted");
  }
  return { ...value };
}

function normalizeNotInDiffOptions(
  value: WorkspaceDiffNotInOptions | undefined,
  operation = "notInDiff()",
): Readonly<WorkspaceDiffNotInOptions> {
  if (value === undefined) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${operation} options must be an object`);
  }
  for (const key of Object.keys(value)) {
    if (key !== "content") throw new TypeError(`${operation} options has unknown key ${JSON.stringify(key)}`);
  }
  if (
    value.content !== undefined &&
    value.content !== "added" &&
    value.content !== "removed" &&
    value.content !== "both" &&
    value.content !== "none"
  ) {
    throw new TypeError(`${operation} options.content must be added, removed, both, or none`);
  }
  return { ...value };
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

function unavailableDiffResult(): BooleanAssertionEvaluation<void> {
  return unavailableAssertionEvaluation("source-unavailable");
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
    evaluate: () => Effect.Effect<BooleanAssertionEvaluation<void>, unknown, never>,
    terminalEvidence?: () => readonly AssertionMaterial[],
  ): PostRunBooleanAssertionHandle<Kind, void> =>
    postRunBooleanAssertionHandle(
      input.runtime.registerBoolean<void>({
        criterion,
        subject: diffReferenceMaterial(),
        terminalEvidence: terminalEvidence ?? (() => []),
        terminalCriterion: () => criterion,
        terminalReceipt: () => undefined,
        evidence: [],
        coverage: { state: "complete" },
        limitations: [],
        retainedBytes: 0,
        evaluate,
        interruptedMatcherArtifact: undefined,
      }),
      input.runtime.evaluationKind,
    );

  const changedPaths = (paths: readonly string[]): PostRunBooleanAssertionHandle<Kind, void> => {
    requireCapability();
    if (!Array.isArray(paths)) throw new TypeError("changedPaths() requires an array of paths");
    for (const path of paths) assertDiffPath(path, "changedPaths()");
    validateExpectedTouchedPaths(paths);
    const expected = [...paths];
    return register(changedPathsCriterion(expected), () =>
      Effect.sync(() => {
        const diff = input.late.diff;
        if (diff.state !== "available") return unavailableDiffResult();
        return agentWorkspaceDiffPathsMatch(diff.document, expected) ? matchedVoid() : mismatchedVoid();
      }),
    );
  };

  // @concord-code
  // @concord-implements docs/feature/sandbox/README.md
  const changedOnlyWithin = (paths: readonly [string, ...string[]]): PostRunBooleanAssertionHandle<Kind, void> => {
    requireCapability();
    if (!Array.isArray(paths) || paths.length === 0)
      throw new TypeError(
        "changedOnlyWithin() requires at least one allowed path; use noChanges() for zero allowed paths",
      );
    for (const path of paths) {
      assertDiffPath(path, "changedOnlyWithin()");
      if (/[*?]/u.test(path))
        throw new TypeError(
          "changedOnlyWithin() does not support glob patterns; use the directory name directly for a directory prefix",
        );
    }
    const allowed = [...new Set(paths)].sort();
    return register({ kind: "sandbox-change-scope", paths: allowed }, () =>
      Effect.sync(() => {
        const diff = input.late.diff;
        if (diff.state !== "available") return unavailableDiffResult();
        const outside = [
          ...new Set(diff.document.windows.flatMap((window) => window.changes.map((change) => change.path))),
        ]
          .filter((path) => !allowed.some((prefix) => path === prefix || path.startsWith(`${prefix}/`)))
          .sort();
        return outside.length === 0
          ? matchedVoid()
          : mismatchedVoid(
              createMatchDiagnostic(
                "outside-allowed-paths",
                "Agent changes exceeded the allowed paths",
                [],
                allowed.slice(0, 16).join(", "),
                outside.slice(0, 16).join(", "),
                outside.length <= 16 ? undefined : `Showing 16 of ${outside.length} paths outside the allowed scope`,
              ),
            );
      }),
    );
  };

  // @concord-code
  // @concord-implements docs/feature/sandbox/README.md
  const unchangedWithin = (paths: readonly [string, ...string[]]): PostRunBooleanAssertionHandle<Kind, void> => {
    requireCapability();
    if (!Array.isArray(paths) || paths.length === 0)
      throw new TypeError("unchangedWithin() requires at least one protected path");
    for (const path of paths) {
      assertDiffPath(path, "unchangedWithin()");
      if (/[*?]/u.test(path))
        throw new TypeError(
          "unchangedWithin() does not support glob patterns; use the directory name directly for a directory prefix",
        );
    }
    const protectedPaths = [...new Set(paths)].sort();
    return register({ kind: "sandbox-unchanged-within", paths: protectedPaths }, () =>
      Effect.sync(() => {
        const diff = input.late.diff;
        if (diff.state !== "available") return unavailableDiffResult();
        const protectedChanges = [
          ...new Set(diff.document.windows.flatMap((window) => window.changes.map((change) => change.path))),
        ]
          .filter((path) => protectedPaths.some((prefix) => path === prefix || path.startsWith(`${prefix}/`)))
          .sort();
        return protectedChanges.length === 0
          ? matchedVoid()
          : mismatchedVoid(
              createMatchDiagnostic(
                "protected-paths-changed",
                "Agent changed protected paths",
                [],
                protectedPaths.slice(0, 16).join(", "),
                protectedChanges.slice(0, 16).join(", "),
                protectedChanges.length <= 16
                  ? undefined
                  : `Showing 16 of ${protectedChanges.length} paths within the protected scope`,
              ),
            );
      }),
    );
  };

  const fileChanged = (path: string, rawOptions?: FileChangedOptions): PostRunBooleanAssertionHandle<Kind, void> => {
    requireCapability();
    assertDiffPath(path, "fileChanged()");
    const options = normalizeFileChangedOptions(rawOptions);
    return register(fileChangedCriterion(path, options), () =>
      Effect.tryPromise({
        try: async () => {
          const diff = input.late.diff;
          if (diff.state !== "available") return unavailableDiffResult();
          let unavailable = false;
          for (const candidate of agentWorkspaceDiffChangesForPath(diff.document, path)) {
            if (options.status !== undefined && candidate.status !== options.status) continue;
            const before = await endpointMatches(candidate.before, options.before);
            const after = await endpointMatches(candidate.after, options.after);
            if (before === "matched" && after === "matched") {
              return matchedVoid();
            }
            // Both endpoint constraints belong to this one WindowChange. A
            // cross-send restore therefore remains visible, while a same-send
            // restore never became a ledger endpoint delta in the first place.
            if (before === "mismatched" || after === "mismatched") continue;
            if (before === "unavailable" || after === "unavailable") unavailable = true;
          }
          return unavailable ? unavailableDiffResult() : mismatchedVoid();
        },
        catch: (error) => error,
      }),
    );
  };

  const notInDiff = (
    pattern: RegExp,
    rawOptions?: WorkspaceDiffNotInOptions,
  ): PostRunBooleanAssertionHandle<Kind, void> => {
    requireCapability();
    if (!(pattern instanceof RegExp)) throw new TypeError("notInDiff() pattern must be a RegExp");
    const options = normalizeNotInDiffOptions(rawOptions);
    return register(notInDiffCriterion(pattern, options), () =>
      Effect.sync(() => {
        const diff = input.late.diff;
        if (diff.state !== "available") return unavailableDiffResult();
        const result = evaluateWorkspaceDiffNotIn(diff.document, pattern, options);
        if (result.state === "matched") return matchedVoid();
        if (result.state === "mismatched") return mismatchedVoid();
        return unavailableDiffResult();
      }),
    );
  };

  const inDiff = (
    pattern: RegExp,
    rawOptions?: WorkspaceDiffNotInOptions,
  ): PostRunBooleanAssertionHandle<Kind, void> => {
    requireCapability();
    if (!(pattern instanceof RegExp)) throw new TypeError("inDiff() pattern must be a RegExp");
    const options = normalizeNotInDiffOptions(rawOptions, "inDiff()");
    const frozenPattern = new RegExp(pattern.source, pattern.flags);
    let evidence: readonly AssertionMaterial[] = [];
    const criterion: AssertionCriterion =
      options.content === "none"
        ? {
            kind: "sandbox-diff-paths",
            operation: "in-diff",
            pattern: frozenPattern.source,
            flags: frozenPattern.flags,
          }
        : {
            kind: "sandbox-in-diff",
            pattern: frozenPattern.source,
            flags: frozenPattern.flags,
            content: options.content ?? "both",
          };
    return register(
      criterion,
      () =>
        Effect.sync(() => {
          const diff = input.late.diff;
          if (diff.state !== "available") return unavailableDiffResult();
          const result = evaluateWorkspaceDiffIn(diff.document, frozenPattern, options);
          if (result.state === "unavailable") return unavailableDiffResult();
          if (result.state === "mismatched") return mismatchedVoid();
          evidence = [
            {
              kind: "snapshot" as const,
              value: { path: result.path, preview: result.preview },
            },
          ];
          return matchedVoid(
            createMatchDiagnostic(
              "diff-pattern-witness",
              "Pattern matched agent changes",
              [],
              frozenPattern.toString(),
              `${result.path}: ${result.preview}`,
            ),
          );
        }),
      () => evidence,
    );
  };

  const noChanges = (): PostRunBooleanAssertionHandle<Kind, void> => {
    requireCapability();
    return register(noChangesCriterion(), () =>
      Effect.sync(() => {
        const diff = input.late.diff;
        if (diff.state !== "available") return unavailableDiffResult();
        return agentWorkspaceDiffPathsMatch(diff.document, []) ? matchedVoid() : mismatchedVoid();
      }),
    );
  };
  const fileDeleted = (path: string): PostRunBooleanAssertionHandle<Kind, void> => {
    requireCapability();
    assertDiffPath(path, "fileDeleted()");
    return register(fileDeletedCriterion(path), () =>
      Effect.sync(() => {
        const diff = input.late.diff;
        if (diff.state !== "available") return unavailableDiffResult();
        return agentWorkspaceDiffChangesForPath(diff.document, path).some((change) => change.status === "deleted")
          ? matchedVoid()
          : mismatchedVoid();
      }),
    );
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
    changedOnlyWithin,
    unchangedWithin,
    noChanges,
    fileChanged,
    fileDeleted,
    notInDiff,
    inDiff,
  };
  Object.setPrototypeOf(view, null);
  return Object.freeze(view);
}

function freezeInputRequest(request: InputRequest): InputRequest {
  const freeze = <Value>(value: Value): Value => {
    if (value !== null && typeof value === "object") {
      for (const child of Object.values(value)) freeze(child);
      Object.freeze(value);
    }
    return value;
  };
  return freeze(structuredClone(request));
}

function requireInputRequest(session: RunSession, filter: InputRequestFilter | undefined): InputRequest {
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
    throw new Error(
      `A string response requires exactly one pending input request, found ${session.pendingInputRequests.length}`,
    );
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
  return { text: text.join("\n"), responses };
}

function mimeTypeFor(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

function readInputFileEffect(path: string): Effect.Effect<InputFile, unknown> {
  return Effect.tryPromise({
    try: () => readFile(path),
    catch: (error) => error,
  }).pipe(
    Effect.map((bytes) => ({
      filename: basename(path),
      mimeType: mimeTypeFor(path),
      dataBase64: bytes.toString("base64"),
    })),
  );
}

/**
 * Builds the Adapter-neutral part of `t`. Agent contexts extend this exact
 * runtime instead of recreating Assertion, group, Judge, score, feedback, or
 * author-control semantics around a SessionManager.
 */
export function createAssertFirstCoreContext(deps: AssertFirstCoreContextDeps): {
  readonly context: AssertFirstCoreTestContext<RuntimeKind>;
  readonly state: AssertFirstCoreContextState;
} {
  const runtime: AssertionsRuntime<RuntimeKind> =
    deps.evaluationKind === "score"
      ? createAssertionsRuntime({
          evaluationKind: "score",
          executeStop: deps.executeStop,
          judge: deps.judge,
          signal: deps.signal,
          judgeUsage: deps.judgeUsage,
        })
      : createAssertionsRuntime({
          evaluationKind: "pass",
          executeStop: deps.executeStop,
          judge: deps.judge,
          signal: deps.signal,
          judgeUsage: deps.judgeUsage,
        });
  // Preserve the function identity: contextual Matches resolve their bound
  // receiver through this check, independently of JavaScript's call-site `this`.
  const check = runtime.t.check;
  const judge = ((subject: unknown, definition: unknown, ...extra: readonly unknown[]) => {
    if (extra.length > 0) throw new TypeError("judge() accepts exactly (subject, definition)");
    runtime.assertAuthoringOpen();
    assertAssertionSubject(subject, "judge");
    if (managedScoreMatchOf(definition) === undefined)
      throw new TypeError("judge() definition must be a managed ScoreMatch");
    return (runtime.t.check as (subject: unknown, match: unknown) => MeasurementAssertionHandle<RuntimeKind>)(
      subject,
      definition,
    );
  }) as JudgeFunction<RuntimeKind>;
  const state: AssertFirstCoreContextState = {
    assertions: runtime,
    notes: new AttemptNotesCollector(),
    skipReason: undefined,
  };
  const presets = judgePresetMethods(runtime.t.check);
  const readUsage = (): EvalUsage => {
    runtime.assertAuthoringOpen();
    return (
      deps.readUsage?.() ??
      projectAgentEvalUsage({
        contributions: [],
        scope: "attempt",
        pricing: undefined,
      })
    );
  };
  const elapsedMs = (): import("../assertions/match.ts").NumericMaterial => {
    runtime.assertAuthoringOpen();
    const value = deps.elapsedMs?.();
    const provenance = { source: "runtime", scope: "attempt", unit: "milliseconds", cut: "call-time" };
    return value === undefined || !Number.isFinite(value) || value < 0
      ? {
          state: "unavailable",
          reason: "runtime-timing-not-recorded",
          provenance,
          unit: undefined,
        }
      : {
          state: "exact",
          value,
          provenance,
          unit: undefined,
        };
  };
  const { maxTokens, maxCost } = usageBudgetMethods(runtime, readUsage);
  const base = {
    note: (
      label: string,
      value: import("../shared/types.ts").JsonValue | import("../assertions/quantity.ts").Quantity,
    ): void => {
      runtime.assertAuthoringOpen();
      state.notes.add(label, value);
    },
    get usage() {
      return readUsage();
    },
    get elapsedMs() {
      return elapsedMs();
    },
    maxTokens,
    maxCost,
    evaluationKind: deps.evaluationKind,
    signal: deps.signal,
    model: deps.model,
    reasoningEffort: deps.reasoningEffort,
    flags: deps.flags,
    progress: (update: import("../types.ts").ProgressUpdate) => {
      if (deps.feedback !== undefined) {
        deps.feedback.progress(update);
      } else {
        deps.log(
          update.current === undefined || update.total === undefined
            ? update.message
            : `${update.message} (${update.current}/${update.total})`,
        );
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
    check,
    judge,
    agentJudge: runtime.t.agentJudge,
    ...presets,
  };
  if (deps.evaluationKind === "score")
    Object.defineProperty(base, "score", { value: (runtime as AssertionsRuntime<"score">).t.score, enumerable: true });
  const context = Object.freeze(base);
  return {
    context: context as AssertFirstCoreTestContext<RuntimeKind>,
    state,
  };
}

function usageBudgetMethods<Kind extends RuntimeKind>(runtime: AssertionsRuntime<Kind>, readUsage: () => EvalUsage) {
  const maxTokens = (maximum: number, ...extra: readonly unknown[]): BooleanAssertionHandle<Kind, number> => {
    if (extra.length > 0) throw new TypeError("maxTokens() accepts exactly one maximum");
    assertNonNegativeFinite(maximum, "maxTokens() max");
    return runtime.t.check(readUsage().totalTokens, atMost(maximum)) as BooleanAssertionHandle<Kind, number>;
  };
  const maxCost = (maximum: number | string, ...extra: readonly unknown[]): BooleanAssertionHandle<Kind, string> => {
    if (extra.length > 0) throw new TypeError("maxCost() accepts exactly one maximum");
    const threshold = typeof maximum === "number" ? canonicalDecimalFromNumber(maximum) : maximum;
    if (threshold == null || !/^(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/.test(threshold) || threshold.length > 128)
      throw new TypeError("maxCost() requires a nonnegative canonical USD amount");
    const usage = readUsage();
    const usd = usage.costs.values.find((cost) => cost.currency === "USD");
    const complete = usage.costs.state === "complete" && usage.costs.values.length === 1;
    const captured = captureAssertionSnapshot({
      source: usage.source,
      scope: usage.scope,
      cut: usage.cut,
      unit: "USD",
      threshold,
      amount: usd?.value ?? null,
      complete,
      costs: usage.costs,
    });
    return runtime.registerBoolean<string>({
      criterion: {
        kind: "value-match",
        subject: "explicit-value",
        matcher: { state: "declared", name: "max-cost-usd" },
      },
      subject: captured.material,
      coverage: captured.coverage,
      limitations: captured.limitations,
      evaluate: function evaluateMaxCost() {
        if (usd === undefined) return Effect.succeed(unavailableAssertionEvaluation("source-unavailable"));
        if (compareCanonicalDecimal(usd.value, threshold) > 0) return Effect.succeed(mismatchedAssertionEvaluation());
        if (complete) return Effect.succeed(matchedAssertionEvaluation(usd.value));
        return Effect.succeed(unavailableAssertionEvaluation("source-unavailable"));
      },
      terminalCriterion: () => ({
        kind: "value-match",
        subject: "explicit-value",
        matcher: { state: "declared", name: "max-cost-usd" },
      }),
      terminalReceipt: () => undefined,
      terminalEvidence: () => [],
      retainedBytes: 0,
      evidence: [],
      interruptedMatcherArtifact: undefined,
    });
  };
  return { maxTokens, maxCost };
}

/**
 * Creates the Context that Runner actually hands to `test(t)`. Its only
 * authoring state is the Attempt-local Assert-first runtime.
 */
export function createAssertFirstEvalContext(deps: AssertFirstContextDeps): {
  readonly context: AssertFirstTestContext<RuntimeKind>;
  readonly state: AssertFirstContextState;
} {
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
    nextSourceOrder: deps.nextSourceOrder,
    sourceRegistry: deps.sourceRegistry,
    resources: deps.resources,
  });
  const readAttemptUsage = () =>
    projectAgentEvalUsage({
      contributions: manager.usageContributionsSnapshot(),
      scope: "attempt",
      pricing: deps.pricing,
    });
  const core = createAssertFirstCoreContext({ ...deps, readUsage: readAttemptUsage });
  const runtime = core.state.assertions;
  const check = core.context.check;
  const judge = core.context.judge;
  const simulatedUserCleanups: Array<() => Promise<void>> = [];
  let simulatedUsersClosed = false;
  const closeSimulatedUsers = async () => {
    simulatedUsersClosed = true;
    deps.signal.removeEventListener("abort", abortSimulatedUsers);
    await Promise.all(simulatedUserCleanups.map((close) => close()));
  };
  const abortSimulatedUsers = () => {
    void closeSimulatedUsers().catch(() => undefined);
  };
  deps.signal.addEventListener("abort", abortSimulatedUsers, { once: true });
  const state: AssertFirstContextState = {
    simulatedUserFailure: undefined,
    closeSimulatedUsers,
    notes: core.state.notes,
    assertions: runtime,
    manager,
    late: { diff: { state: "pending" as const }, scripts: {} },
  };
  const resolveObservedEvaluation: ResolveObservedEvaluation = (snapshot) =>
    manager.observedEvaluationSegment(snapshot);

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
    latestTurn: AssertFirstTurnHandle<RuntimeKind> | undefined;
    simulatedUserBusy: boolean;
    queuedDrives: number;
    readonly session: RunSession;
    readonly turns: MatcherScopeTurn[];
    started: boolean;
    inFlight: number;
    failed: boolean;
    toolScopeCache: ToolScopeProjectionCache | undefined;
  }

  const sessions: SessionScopeState[] = [];
  const turnOwners = new WeakMap<object, { readonly scope: SessionScopeState; readonly turnId: string }>();
  let attemptToolScopeCache: ToolScopeProjectionCache | undefined;
  const matcherSource = {
    family: "niceeval.agent-turns" as const,
  };
  const attemptScopeId =
    deps.attempt === undefined
      ? JSON.stringify(["niceeval.attempt-scope/1", manager.primary.sessionScopeId])
      : JSON.stringify(["niceeval.attempt-scope/1", deps.experimentId ?? null, deps.attempt.id, deps.attempt.index]);

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
    return turns.every((turn) => resolveObservedEvaluation(turn.observed)?.collectionAtCut === "complete")
      ? "complete"
      : "unavailable";
  };

  const turnSourceSnapshot = (
    turn: MatcherScopeTurn,
    coverage: ScopeCoverage["actions" | "events"],
    allowUnclassifiedActions = false,
  ): Extract<MatcherSourceSnapshot, { readonly scope: "turn" }> => ({
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
    return {
      scope: "session" as const,
      sessionId: observed.sessionId,
      scopeId: observed.sessionId,
      throughSessionSequence: observed.throughSessionSequence,
      source: matcherSource,
      collectionAtCut: collectionAtCut(observedMatcherTurns(observed.sessionId), coverage, allowUnclassifiedActions),
    };
  };

  const attemptSourceSnapshot = (
    turns: readonly MatcherScopeTurn[],
    coverage: ScopeCoverage["actions" | "events"],
    allowUnclassifiedActions = false,
  ): Extract<MatcherSourceSnapshot, { readonly scope: "attempt" }> => ({
    scope: "attempt" as const,
    scopeId: attemptScopeId,
    sessions: manager.observedAttemptCut().sessions,
    source: matcherSource,
    collectionAtCut: collectionAtCut(turns, coverage, allowUnclassifiedActions),
  });

  const coverageWhileInFlight = (coverage: ScopeCoverage): ScopeCoverage => ({
    ...coverage,
    actions: { status: "partial" as const, reason: "scope-still-running" },
    status: { status: "partial" as const, reason: "scope-still-running" },
  });

  const sessionCoverage = (scope: SessionScopeState): ScopeCoverage =>
    scope.inFlight === 0 ? scope.session.evidenceCoverage : coverageWhileInFlight(scope.session.evidenceCoverage);

  const sessionStatus = (scope: SessionScopeState): ScopeStatus => {
    if (!scope.started) return "not-started";
    if (scope.inFlight > 0) return "waiting";
    return scope.failed ? "failed" : scope.session.lastStatus;
  };

  const attemptCoverage = (): ScopeCoverage => {
    const active = sessions.filter((scope) => scope.started);
    if (active.length === 0) return manager.evidenceCoverage;
    if (active.some((scope) => scope.inFlight > 0)) return coverageWhileInFlight(manager.evidenceCoverage);
    return manager.evidenceCoverage;
  };

  const observedMatcherTurns = (sessionId?: string): readonly MatcherScopeTurn[] =>
    manager
      .observedSessionSnapshots()
      .filter((session) => sessionId === undefined || session.sessionId === sessionId)
      .flatMap((session) =>
        session.turns.map((observed) => ({
          observed,
          events: resolveObservedEvaluation(observed)?.events ?? [],
          outcome: manager.observedTurnState(observed)?.outcome ?? ("failed" as const),
        })),
      );

  const readDefaultHistory = (cut: MatcherSourceSnapshot): MaterialCollection<Readonly<Record<string, unknown>>> => {
    const ends =
      cut.scope === "attempt"
        ? new Map(cut.sessions.map((session) => [session.sessionId, session.throughSessionSequence]))
        : new Map([[cut.sessionId, cut.throughSessionSequence]]);
    const prefix = observedMatcherTurns().filter((turn) => {
      const end = ends.get(turn.observed.sessionId);
      return end !== undefined && turn.observed.throughSessionSequence <= end;
    });
    const selected = prefix.filter((turn) => cut.scope !== "turn" || turn.observed.turnId === cut.turnId);
    const projection = projectMatcherSources(prefix, resolveObservedEvaluation);
    let reason: string | undefined = manager.observedHistoryIncompleteReason();
    if (projection.state === "invalid") reason ??= "agent-history-invalid-relation";
    const active =
      cut.scope === "attempt"
        ? sessions.some((scope) => scope.inFlight > 0)
        : sessions.some((scope) => scope.session.observedSnapshot().sessionId === cut.sessionId && scope.inFlight > 0);
    if (active) reason ??= "scope-still-running";
    const items: { readonly id: string; readonly value: Readonly<Record<string, unknown>> }[] = [];
    for (const turn of selected) {
      const segment = resolveObservedEvaluation(turn.observed);
      if (segment === undefined) {
        reason ??= "agent-history-segment-unavailable";
        continue;
      }
      if (turn.observed.collectionAtCut !== "complete") reason ??= "agent-history-truncated";
      const coverage = manager.observedTurnState(turn.observed)?.coverage;
      for (const channel of ["events", "messages", "actions"] as const) {
        if (coverage?.[channel].status !== "complete")
          reason ??= coverage?.[channel].reason ?? `agent-history-${channel}-unavailable`;
      }
      segment.items.forEach((event, index) => {
        const raw = segment.events[index];
        if (raw === undefined) reason ??= "agent-history-event-unavailable";
        if ((raw?.truncated?.length ?? 0) > 0) reason ??= "agent-history-truncated";
        if (event.kind === "tool-finish" && event.occurrence.state !== "exact")
          reason ??= `agent-history-${event.occurrence.reason}`;
        function eventToolOccurrenceId() {
          if (event.kind === "tool-start") return event.toolOccurrenceId;
          if (event.kind === "tool-finish" && event.occurrence.state === "exact")
            return event.occurrence.toolOccurrenceId;
          return undefined;
        }
        const occurrenceId = eventToolOccurrenceId();
        const occurrence = occurrenceId === undefined ? undefined : projection.occurrenceCandidates.get(occurrenceId);
        items.push(
          Object.freeze({
            id: event.eventId,
            value: Object.freeze({
              eventId: event.eventId,
              itemId: event.itemId,
              sessionId: segment.sessionId,
              turnId: segment.turnId,
              sessionSequence: event.sessionSequence,
              event: raw ?? event,
              observed: event,
              ...(occurrence === undefined ? {} : { occurrence }),
              ordering: "first-session appearance, then sessionSequence; no cross-session causal order",
            }),
          }),
        );
      });
    }
    return reason === undefined
      ? Object.freeze({ state: "complete" as const, items: Object.freeze(items) })
      : Object.freeze({ state: "partial" as const, items: Object.freeze(items), reason });
  };

  const historyFrame = (): AgentHistoryFrame => ({ cut: undefined, read: readDefaultHistory });
  const latchHistoryCut = (frame: AgentHistoryFrame, cut: MatcherSourceSnapshot): MatcherSourceSnapshot => {
    frame.cut = cut;
    return cut;
  };
  const releaseHistoryFrame = (frame: AgentHistoryFrame): void => {
    frame.cut = undefined;
    frame.read = () => ({ state: "unavailable", reason: "agent-history-receiver-closed" });
  };

  const attemptStatus = (): ScopeStatus => {
    const active = sessions.filter((scope) => scope.started);
    if (active.length === 0) return "not-started";
    const statuses = active.map(sessionStatus);
    if (statuses.includes("waiting")) return "waiting";
    if (statuses.includes("failed")) return "failed";
    return "completed";
  };

  const sessionSnapshot = (scope: SessionScopeState) => ({
    sessionIndex: scope.session.index,
    turnCount: scope.session.turnCount,
    status: sessionStatus(scope),
    coverage: sessionCoverage(scope),
  });

  const attemptSnapshot = () => ({
    sessions: sessions.filter((scope) => scope.started).map((scope) => sessionSnapshot(scope)),
    status: attemptStatus(),
    coverage: attemptCoverage(),
  });

  const sessionToolScope = (scope: SessionScopeState): ToolScopeSnapshot => {
    const coverage = sessionCoverage(scope);
    const turns = observedMatcherTurns(scope.session.observedSnapshot().sessionId);
    const sourceSnapshot = sessionSourceSnapshot(scope, coverage.actions, true);
    const snapshot = {
      sessionIndex: scope.session.index,
      turnCount: scope.turns.length,
      status: sessionStatus(scope),
      coverage,
    };
    const cutKey = toolScopeCutKey(sourceSnapshot, snapshot);
    const cached = scope.toolScopeCache;
    if (cached !== undefined && cached.cutKey === cutKey) return cached.value;
    const value = projectToolScope({
      turns,
      sourceSnapshot,
      coverage,
      snapshot,
      resolveEvaluation: resolveObservedEvaluation,
    });
    scope.toolScopeCache = { cutKey, value };
    return value;
  };

  const attemptToolScope = (): ToolScopeSnapshot => {
    const active = sessions.filter((scope) => scope.started);
    const coverage = attemptCoverage();
    const turns = observedMatcherTurns();
    const sourceSnapshot = attemptSourceSnapshot(turns, coverage.actions, true);
    const snapshot = {
      sessions: active.map((scope) => ({
        sessionIndex: scope.session.index,
        turnCount: scope.turns.length,
        status: sessionStatus(scope),
        coverage: sessionCoverage(scope),
      })),
      status: attemptStatus(),
      coverage,
    };
    const cutKey = toolScopeCutKey(sourceSnapshot, snapshot);
    const cached = attemptToolScopeCache;
    if (cached !== undefined && cached.cutKey === cutKey) return cached.value;
    const value = projectToolScope({
      turns,
      sourceSnapshot,
      coverage,
      snapshot,
      resolveEvaluation: resolveObservedEvaluation,
    });
    attemptToolScopeCache = { cutKey, value };
    return value;
  };

  const sessionScopedEvents = (scope: SessionScopeState): readonly StreamEvent[] =>
    observedMatcherTurns(scope.session.observedSnapshot().sessionId).flatMap((turn) => turn.events);

  const sessionEventScope = (scope: SessionScopeState): EventScopeSnapshot => {
    const coverage = sessionCoverage(scope);
    return projectEventScope({
      turns: observedMatcherTurns(scope.session.observedSnapshot().sessionId),
      sourceSnapshot: sessionSourceSnapshot(scope, coverage.events),
      coverage,
      snapshot: sessionSnapshot(scope),
      resolveEvaluation: resolveObservedEvaluation,
    });
  };

  const attemptScopedEvents = (): readonly StreamEvent[] =>
    sessions
      .filter((scope) => scope.started)
      .flatMap((scope) =>
        observedMatcherTurns(scope.session.observedSnapshot().sessionId).flatMap((turn) => turn.events),
      );

  const attemptEventScope = (): EventScopeSnapshot => {
    const coverage = attemptCoverage();
    const turns = observedMatcherTurns();
    return projectEventScope({
      turns,
      sourceSnapshot: attemptSourceSnapshot(turns, coverage.events),
      coverage,
      snapshot: attemptSnapshot(),
      resolveEvaluation: resolveObservedEvaluation,
    });
  };

  // @concord-code
  // @concord-implements docs/feature/eval/README.md
  const conversationTurn = (turn: MatcherScopeTurn) => ({
    events: turn.events,
    reply: lastAssistantText(turn.events) ?? "",
    partial: ["events", "messages", "actions"].flatMap((channel) => {
      const coverage = manager.observedTurnState(turn.observed)?.coverage[channel as "events" | "messages" | "actions"];
      return coverage?.status === "complete" ? [] : [coverage?.reason ?? `${channel}-unavailable`];
    }),
  });

  const makeTurn = <Kind extends RuntimeKind>(
    scope: SessionScopeState,
    turn: Turn,
    input: string,
  ): AssertFirstTurnHandle<Kind> => {
    const events = [...turn.events];
    const scopedEvents = [{ type: "message" as const, role: "user" as const, text: input }, ...events];
    const coverage = manager.resolveTurnEvidenceCoverage(turn);
    const observed = observedSnapshotForTurn(turn);
    if (observed === undefined) {
      throw new Error("SessionManager returned a Turn without its sealed observed source snapshot");
    }
    const matcherTurn: MatcherScopeTurn = {
      observed,
      events: scopedEvents,
      outcome: turn.status,
    };
    scope.turns.push(matcherTurn);
    const scopeSnapshot = {
      sessionId: observed.sessionId,
      turnId: observed.turnId,
      throughSessionSequence: observed.throughSessionSequence,
      events: scopedEvents.length,
    };
    const toolScope = projectToolScope({
      turns: [matcherTurn],
      sourceSnapshot: turnSourceSnapshot(matcherTurn, coverage.actions, true),
      homeTurnId: observed.turnId,
      coverage,
      snapshot: scopeSnapshot,
      resolveEvaluation: resolveObservedEvaluation,
    });
    const eventScope = projectEventScope({
      turns: [matcherTurn],
      sourceSnapshot: turnSourceSnapshot(matcherTurn, coverage.events),
      coverage,
      snapshot: scopeSnapshot,
      resolveEvaluation: resolveObservedEvaluation,
    });
    const toolCalls = managedToolCalls("turn", toolScope, check) as ManagedToolCalls<"turn">;
    const eventOccurrences = managedEventOccurrences("turn", eventScope, check) as ManagedEventOccurrences<"turn">;
    const readTurnUsage = () => {
      runtime.assertAuthoringOpen();
      return projectAgentEvalUsage({
        contributions: manager.usageContributionsSnapshot().filter((call) => call.turnId === observed.turnId),
        scope: "turn",
        pricing: deps.pricing,
      });
    };
    const frame = historyFrame();
    const scopedCheck = createScopedAssertionCheck<Kind, AgentMatchContext<"turn">>(
      check,
      () =>
        Object.freeze({
          scope: "turn" as const,
          toolCalls,
          eventOccurrences,
          get usage() {
            return readTurnUsage();
          },
        }),
      () => latchHistoryCut(frame, turnSourceSnapshot(matcherTurn, coverage.actions, true)),
      () => releaseHistoryFrame(frame),
    );
    const snapshot: TurnScopeSnapshot = {
      events,
      toolCalls,
      toolScope,
      status: turn.status,
      coverage,
      input,
      output: lastAssistantText(events) ?? "",
    };
    const calledTool = (target: ToolMatch | ToolOccurrenceMatch | string, ...extra: readonly unknown[]) => {
      if (extra.length > 0) throw new TypeError("calledTool() accepts exactly one match or name");
      return calledToolHandle({
        runtime: runtime as AssertionsRuntime<Kind>,
        subject: snapshot.toolCalls,
        target,
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
    const toolOrder = (matches: readonly [ToolMatch, ToolMatch, ...ToolMatch[]], ...extra: readonly unknown[]) => {
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
    const event = (match: EventMatch | EventOccurrenceMatch, ...extra: readonly unknown[]) => {
      if (extra.length > 0) throw new TypeError("event() accepts exactly one match");
      return eventHandle({
        runtime: runtime as AssertionsRuntime<Kind>,
        subject: eventOccurrences,
        match,
      });
    };
    const notEvent = (match: EventMatch, ...extra: readonly unknown[]) => {
      if (extra.length > 0) throw new TypeError("notEvent() accepts exactly one match");
      return notEventOccurrenceHandle({
        runtime: runtime as AssertionsRuntime<Kind>,
        subject: eventOccurrences,
        match,
      });
    };
    const eventOrder = (matches: readonly [EventMatch, EventMatch, ...EventMatch[]], ...extra: readonly unknown[]) => {
      if (extra.length > 0) throw new TypeError("eventOrder() accepts exactly one ordered match list");
      return registerCollectionCheck(runtime as AssertionsRuntime<Kind>, eventOccurrences, inOrder(matches));
    };
    const { maxTokens, maxCost } = usageBudgetMethods(runtime as AssertionsRuntime<Kind>, readTurnUsage);
    const handle = bindConversationMaterial(
      Object.freeze({
        input: snapshot.input,
        events: snapshot.events,
        inputRequests: Object.freeze(
          snapshot.events.flatMap((event) =>
            event.type === "input.requested" ? [freezeInputRequest(event.request)] : [],
          ),
        ),
        toolCalls: snapshot.toolCalls,
        eventOccurrences,
        status: snapshot.status,
        reply: snapshot.output,
        data: turn.data,
        get usage() {
          return readTurnUsage();
        },
        get elapsedMs() {
          return core.context.elapsedMs;
        },
        check: scopedCheck,
        judge: judge as JudgeFunction<Kind>,
        agentJudge: core.context.agentJudge as import("../assertions/api.ts").AgentJudgeFunction<Kind>,
        ...agentJudgePresetMethods<Kind, "turn">(scopedCheck, frame),
        succeeded: () =>
          succeededHandle({
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
      }),
      () => projectConversation([conversationTurn(matcherTurn)]),
    );
    scope.latestTurn = handle;
    turnOwners.set(handle, { scope, turnId: observed.turnId });
    return handle;
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
        Effect.tapError(() =>
          Effect.sync(() => {
            scope.failed = true;
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            scope.inFlight -= 1;
          }),
        ),
      );
    });
  };

  const send = <Kind extends RuntimeKind>(
    scope: SessionScopeState,
    text: string,
    files?: readonly InputFile[],
    responses?: readonly InputResponse[],
  ): Promise<AssertFirstTurnHandle<Kind>> => {
    scope.queuedDrives += 1;
    return deps
      .requestEffect(sendEffect<Kind>(scope, text, files, responses, captureLoc({ registry: deps.sourceRegistry })))
      .finally(() => {
        scope.queuedDrives--;
      });
  };

  const makeSession = <Kind extends RuntimeKind>(scope: SessionScopeState): AssertFirstSessionHandle<Kind> => {
    const session = scope.session;
    const sessionCalls = (): ManagedToolCalls<"session"> =>
      managedToolCalls("session", sessionToolScope(scope), check) as ManagedToolCalls<"session">;
    const sessionEventOccurrences = (): ManagedEventOccurrences<"session"> =>
      managedEventOccurrences("session", sessionEventScope(scope), check) as ManagedEventOccurrences<"session">;
    const readSessionUsage = () => {
      runtime.assertAuthoringOpen();
      return projectAgentEvalUsage({
        contributions: manager
          .usageContributionsSnapshot()
          .filter((call) => call.sessionScopeId === session.sessionScopeId),
        scope: "session",
        pricing: deps.pricing,
      });
    };
    const frame = historyFrame();
    const scopedCheck = createScopedAssertionCheck<Kind, AgentMatchContext<"session">>(
      check,
      () =>
        Object.freeze({
          scope: "session" as const,
          get toolCalls() {
            return sessionCalls();
          },
          get eventOccurrences() {
            return sessionEventOccurrences();
          },
          get usage() {
            return readSessionUsage();
          },
        }),
      () => latchHistoryCut(frame, sessionSourceSnapshot(scope, sessionCoverage(scope).actions, true)),
      () => releaseHistoryFrame(frame),
    );
    const toolOrder = (matches: readonly [ToolMatch, ToolMatch, ...ToolMatch[]], ...extra: readonly unknown[]) => {
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
    const event = (match: EventMatch | EventOccurrenceMatch, ...extra: readonly unknown[]) => {
      if (extra.length > 0) throw new TypeError("event() accepts exactly one match");
      return eventHandle({
        runtime: runtime as AssertionsRuntime<Kind>,
        subject: sessionEventOccurrences(),
        match,
      });
    };
    const notEvent = (match: EventMatch, ...extra: readonly unknown[]) => {
      if (extra.length > 0) throw new TypeError("notEvent() accepts exactly one match");
      return notEventOccurrenceHandle({
        runtime: runtime as AssertionsRuntime<Kind>,
        subject: sessionEventOccurrences(),
        match,
      });
    };
    const eventOrder = (matches: readonly [EventMatch, EventMatch, ...EventMatch[]], ...extra: readonly unknown[]) => {
      if (extra.length > 0) throw new TypeError("eventOrder() accepts exactly one ordered match list");
      return registerCollectionCheck(runtime as AssertionsRuntime<Kind>, sessionEventOccurrences(), inOrder(matches));
    };
    const { maxTokens, maxCost } = usageBudgetMethods(runtime as AssertionsRuntime<Kind>, readSessionUsage);
    return bindConversationMaterial(
      Object.freeze({
        simulatedUser: (definition: SimulatedUserDefinition) =>
          bindSimulatedUser<Kind>(
            definition,
            {
              assertCurrent(turn) {
                if (simulatedUsersClosed) throw new SimulatedUserError("simulated-user-invalid-turn", "closed");
                const owner = turn !== null && typeof turn === "object" ? turnOwners.get(turn) : undefined;
                if (owner?.scope !== scope) throw new SimulatedUserError("simulated-user-invalid-turn", "foreign-turn");
                if (scope.latestTurn !== turn)
                  throw new SimulatedUserError("simulated-user-invalid-turn", "stale-turn");
                if (scope.inFlight > 0 || scope.queuedDrives > 0)
                  throw new SimulatedUserError("simulated-user-invalid-turn", "session-busy");
                if (
                  turn.status === "waiting" &&
                  JSON.stringify(turn.inputRequests) !== JSON.stringify(session.pendingInputRequests)
                )
                  throw new SimulatedUserError("simulated-user-invalid-turn", "stale-turn");
                return { sessionId: session.sessionScopeId, turnId: owner.turnId };
              },
              acquire() {
                if (scope.simulatedUserBusy)
                  throw new SimulatedUserError("simulated-user-invalid-turn", "session-busy");
                scope.simulatedUserBusy = true;
                return () => {
                  scope.simulatedUserBusy = false;
                };
              },
              drive(answer) {
                const operation =
                  "message" in answer
                    ? sendEffect<Kind>(scope, answer.message)
                    : sendEffect<Kind>(scope, answer.text, undefined, answer.responses);
                return deps.requestEffect(operation);
              },
            },
            {
              signal: deps.signal,
              assertOpen: () => runtime.assertAuthoringOpen(),
              now: deps.timingNow ?? (() => performance.now()),
              deadlineAt: deps.deadlineAt,
              createConversation: (definition) => createSimulatedUserConversation(definition, deps.judge, deps.pricing),
              latchFailure: (error) => {
                state.simulatedUserFailure ??= error;
              },
              capture: (activity) => deps.captureSimulatedUser?.(activity) ?? Promise.resolve(),
              onClose: (close) => {
                simulatedUserCleanups.push(close);
              },
            },
          ),
        send: (input: string | { readonly text: string; readonly files?: readonly InputFile[] }) => {
          const text = typeof input === "string" ? input : input.text;
          const files = typeof input === "string" ? undefined : input.files;
          return send<Kind>(scope, text, files);
        },
        sendFile: (path: string, text?: string) => {
          const loc = captureLoc({ registry: deps.sourceRegistry });
          scope.queuedDrives += 1;
          return deps
            .requestEffect(
              readInputFileEffect(path).pipe(
                Effect.flatMap((file) => sendEffect<Kind>(scope, text ?? "", [file], undefined, loc)),
              ),
            )
            .finally(() => {
              scope.queuedDrives--;
            });
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
          return readSessionUsage();
        },
        get toolCalls() {
          return sessionCalls();
        },
        get eventOccurrences() {
          return sessionEventOccurrences();
        },
        get elapsedMs() {
          return core.context.elapsedMs;
        },
        check: scopedCheck,
        judge: judge as JudgeFunction<Kind>,
        agentJudge: core.context.agentJudge as import("../assertions/api.ts").AgentJudgeFunction<Kind>,
        ...agentJudgePresetMethods<Kind, "session">(scopedCheck, frame),
        succeeded: () =>
          succeededHandle({
            runtime: runtime as AssertionsRuntime<Kind>,
            scope: "session",
            status: sessionStatus(scope),
            coverage: sessionCoverage(scope),
            snapshot: sessionSnapshot(scope),
          }),
        calledTool: (target: ToolMatch | ToolOccurrenceMatch | string, ...extra: readonly unknown[]) => {
          if (extra.length > 0) throw new TypeError("calledTool() accepts exactly one match or name");
          return calledToolHandle({
            runtime: runtime as AssertionsRuntime<Kind>,
            subject: sessionCalls(),
            target,
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
      }),
      () => projectConversation(scope.turns.map(conversationTurn)),
    );
  };

  const primaryScope: SessionScopeState = {
    latestTurn: undefined,
    simulatedUserBusy: false,
    queuedDrives: 0,
    toolScopeCache: undefined,
    session: manager.primary,
    turns: [],
    started: false,
    inFlight: 0,
    failed: false,
  };
  sessions.push(primaryScope);
  const primary = makeSession<RuntimeKind>(primaryScope);

  const attemptCalls = (): ManagedToolCalls<"attempt"> =>
    managedToolCalls("attempt", attemptToolScope(), check) as ManagedToolCalls<"attempt">;
  const attemptEventOccurrences = (): ManagedEventOccurrences<"attempt"> =>
    managedEventOccurrences("attempt", attemptEventScope(), check) as ManagedEventOccurrences<"attempt">;
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
  const rootEvent = (match: EventMatch | EventOccurrenceMatch, ...extra: readonly unknown[]) => {
    if (extra.length > 0) throw new TypeError("event() accepts exactly one match");
    return eventHandle({
      runtime,
      subject: attemptEventOccurrences(),
      match,
    });
  };
  const rootNotEvent = (match: EventMatch, ...extra: readonly unknown[]) => {
    if (extra.length > 0) throw new TypeError("notEvent() accepts exactly one match");
    return notEventOccurrenceHandle({
      runtime,
      subject: attemptEventOccurrences(),
      match,
    });
  };
  const rootFrame = historyFrame();
  bindAssertionContext(
    check,
    () =>
      Object.freeze({
        scope: "attempt" as const,
        get toolCalls() {
          return attemptCalls();
        },
        get eventOccurrences() {
          return attemptEventOccurrences();
        },
        get usage() {
          return readAttemptUsage();
        },
      }),
    () => latchHistoryCut(rootFrame, attemptSourceSnapshot(observedMatcherTurns(), attemptCoverage().actions, true)),
    () => releaseHistoryFrame(rootFrame),
  );
  const { maxTokens: rootMaxTokens, maxCost: rootMaxCost } = usageBudgetMethods(runtime, readAttemptUsage);

  // @concord-code
  // @concord-implements docs/feature/assertions/README.md
  const rootOrder = (
    occurrence: "tool" | "event",
    matches: readonly [ToolMatch, ToolMatch, ...ToolMatch[]] | readonly [EventMatch, EventMatch, ...EventMatch[]],
    extra: readonly unknown[],
  ) => {
    if (extra.length > 0) throw new TypeError(`${occurrence}Order() accepts exactly one ordered match list`);
    runtime.assertAuthoringOpen();
    const match = inOrder(matches as readonly [ToolMatch, ToolMatch, ...ToolMatch[]]);
    const registrations = sessions
      .filter((scope) => scope.started)
      .map((scope) => ({
        sessionId: scope.session.observedSnapshot().sessionId,
        registration:
          occurrence === "tool"
            ? collectionMatchRegistration(managedToolCalls("session", sessionToolScope(scope), check), match)
            : collectionMatchRegistration(managedEventOccurrences("session", sessionEventScope(scope), check), match),
      }));
    return scopedBooleanHandle({
      runtime,
      criterion: {
        kind: "occurrence",
        scope: "attempt",
        occurrence,
        assertion: "order",
        matcher: matches.map((item) => item.name).join(", "),
        quantifier: undefined,
      },
      snapshot: attemptSnapshot(),
      evaluate: () =>
        Effect.gen(function* () {
          let selected: BooleanAssertionEvaluation<void> = mismatchedVoid();
          for (const { sessionId, registration } of registrations) {
            const result = yield* registration.evaluate();
            const diagnostic = createMatchDiagnostic(
              "session-order",
              `Order witness Session: ${sessionId}`,
              [],
              undefined,
              undefined,
              undefined,
              undefined,
              result.diagnostic === undefined
                ? undefined
                : [
                    {
                      index: 0,
                      state: result.state === "not-applicable" ? "unavailable" : result.state,
                      label: undefined,
                      diagnostic: result.diagnostic,
                    },
                  ],
            );
            const evaluation: BooleanAssertionEvaluation<void> =
              result.state === "matched"
                ? matchedAssertionEvaluation(undefined, diagnostic, result.receipt, result.matcherArtifact)
                : { ...result, diagnostic };
            if (evaluation.state === "matched") return evaluation;
            if (selected.state !== "unavailable" || evaluation.state === "unavailable") selected = evaluation;
          }
          return selected;
        }),
    });
  };

  const base = {
    ...Object.fromEntries(
      Object.entries(Object.getOwnPropertyDescriptors(core.context))
        .filter(([, descriptor]) => "value" in descriptor)
        .map(([key, descriptor]) => [key, descriptor.value]),
    ),
    ...agentJudgePresetMethods<RuntimeKind, "attempt">(
      check as import("../assertions/api.ts").AssertionCheck<RuntimeKind, AgentMatchContext<"attempt">>,
      rootFrame,
    ),
    get elapsedMs() {
      return core.context.elapsedMs;
    },
    send: primary.send,
    simulatedUser: primary.simulatedUser,
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
    get eventOccurrences() {
      return attemptEventOccurrences();
    },
    newSession: () => {
      const scope: SessionScopeState = {
        latestTurn: undefined,
        simulatedUserBusy: false,
        queuedDrives: 0,
        toolScopeCache: undefined,
        session: manager.newSession(),
        turns: [],
        started: false,
        inFlight: 0,
        failed: false,
      };
      sessions.push(scope);
      return makeSession<RuntimeKind>(scope);
    },
    sandbox: createAssertFirstSandbox({
      agent: deps.agent,
      sandbox: deps.sandbox,
      runtime,
      late: state.late,
    }),
    get observability() {
      return buildO11ySummary(manager.allEvents);
    },
    get usage() {
      runtime.assertAuthoringOpen();
      return readAttemptUsage();
    },
    get toolCalls() {
      return attemptCalls();
    },
    succeeded: () =>
      succeededHandle({
        runtime,
        scope: "attempt",
        status: attemptStatus(),
        coverage: attemptCoverage(),
        snapshot: attemptSnapshot(),
      }),
    calledTool: (target: ToolMatch | ToolOccurrenceMatch | string, ...extra: readonly unknown[]) => {
      if (extra.length > 0) throw new TypeError("calledTool() accepts exactly one match or name");
      return calledToolHandle({
        runtime,
        subject: attemptCalls(),
        target,
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
    toolOrder: (matches: readonly [ToolMatch, ToolMatch, ...ToolMatch[]], ...extra: readonly unknown[]) =>
      rootOrder("tool", matches, extra),
    eventOrder: (matches: readonly [EventMatch, EventMatch, ...EventMatch[]], ...extra: readonly unknown[]) =>
      rootOrder("event", matches, extra),
    usedNoTools: rootUsedNoTools,
    maxToolCalls: rootMaxToolCalls,
    noFailedActions: rootNoFailedActions,
    event: rootEvent,
    notEvent: rootNotEvent,
    maxTokens: rootMaxTokens,
    maxCost: rootMaxCost,
  };
  if (deps.evaluationKind === "score")
    Object.defineProperty(base, "score", { value: (runtime as AssertionsRuntime<"score">).t.score, enumerable: true });
  const context = Object.freeze(base);
  return {
    context: context as AssertFirstTestContext<RuntimeKind>,
    state,
  };
}
