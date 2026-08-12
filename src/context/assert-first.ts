/**
 * The active Eval context. Assertion authoring deliberately enters through
 * `AssertionsRuntimeV1`; this module never constructs a Fact or a Fact
 * collector. The legacy Context implementation remains internal compatibility
 * code; Runner never hands it to an Eval author.
 */

import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";

import { Effect } from "effect";

import {
  captureAssertionSnapshotV1,
  createAssertionsRuntimeV1,
  postRunBooleanAssertionHandleV1,
} from "../assertions/runtime.ts";
import type {
  AssertionsRuntimeV1,
  BooleanAssertionHandleV1,
  MeasurementAssertionHandleV1,
  PostRunBooleanAssertionHandleV1,
} from "../assertions/api.ts";
import type { WritableCriterionEnvelopeV1 } from "../assertions/record/model.ts";
import {
  assertJudgeCapabilityV1,
  evaluateJudgeMeasurementV1,
  freezeJudgeMaterialV1,
  type JudgeRecipeV1,
} from "../assertions/judge.ts";
import {
  agentWorkspaceDiffChangesForPathV1,
  agentWorkspaceDiffPathsMatchV1,
  assertCanonicalWorkspaceRelativePathV1,
  evaluateWorkspaceDiffNotInV1,
  validateExpectedTouchedPaths,
  type AgentWorkspaceDiffEndpointV1,
  type PostRunWorkspaceDiffStateV1,
  type WorkspaceDiffNotInOptionsV1,
} from "../assertions/diff.ts";
import {
  assertManagedToolMatch,
  evaluateBooleanMatch,
  evaluateToolMatchCollection,
  toolMatch,
  type BooleanMatch,
  type ToolMatch,
  type ToolMatchQuantifier,
} from "../assertions/match.ts";
import { buildO11ySummary, deriveRunFacts, deriveScopedLogicalToolOccurrences } from "../o11y/derive.ts";
import { captureLoc } from "../source-loc.ts";
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
  diff: PostRunWorkspaceDiffStateV1;
  scripts: globalThis.Record<string, import("../types.ts").ScriptResult>;
}

export interface AssertFirstContextState {
  readonly assertions: AssertionsRuntimeV1<"pass" | "score">;
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
  readonly model?: string;
  readonly reasoningEffort?: string;
  readonly flags: globalThis.Record<string, JsonValue>;
  readonly experimentId?: string;
  readonly signal: AbortSignal;
  readonly log: (message: string) => void;
  readonly telemetry?: import("../types.ts").Telemetry;
  readonly otel?: import("../o11y/otlp/turn-otel.ts").AgentOtelChannel;
  readonly feedback?: import("../types.ts").ScopedFeedback;
  readonly fact?: (key: string, value: string | number | boolean) => void;
  readonly onSendActive?: (active: boolean) => void;
  readonly ledgerHooks?: import("./session.ts").SessionDeps["ledgerHooks"];
  readonly timingNow?: import("./session.ts").SessionDeps["timingNow"];
  readonly onTurn?: import("./session.ts").SessionDeps["onTurn"];
  readonly concurrencySlot?: ConcurrencySlot;
  readonly experimentClassifier?: import("./session.ts").SessionDeps["experimentClassifier"];
  readonly retryRandom?: import("./session.ts").SessionDeps["retryRandom"];
  readonly retrySleep?: import("./session.ts").SessionDeps["retrySleep"];
  readonly judge: ResolvedJudgeConfig | undefined;
  /** The Attempt-scoped bridge is the sole Promise facade for author sends. */
  readonly requestEffect: NonNullable<SessionDeps["requestEffect"]>;
  /** Ordinary immediate Assertion stop barriers stay in the Attempt Effect Scope. */
  readonly executeStop: import("../assertions/api.ts").AssertionStopExecutorV1;
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

export interface FileChangedOptions {
  readonly status?: "added" | "modified" | "deleted";
  readonly before?: BooleanMatch<string, string, "value">;
  readonly after?: BooleanMatch<string, string, "value">;
}

/** The only agent-attributed post-run diff surface exposed to Eval authors. */
export interface AssertFirstSandbox<Kind extends RuntimeKind>
  extends SandboxOperations, SandboxTransferOperations {
  changedPaths(paths: readonly string[]): PostRunBooleanAssertionHandleV1<Kind, void>;
  noChanges(): PostRunBooleanAssertionHandleV1<Kind, void>;
  fileChanged(
    path: string,
    options?: FileChangedOptions,
  ): PostRunBooleanAssertionHandleV1<Kind, void>;
  fileDeleted(path: string): PostRunBooleanAssertionHandleV1<Kind, void>;
  notInDiff(
    pattern: RegExp,
    options?: WorkspaceDiffNotInOptionsV1,
  ): PostRunBooleanAssertionHandleV1<Kind, void>;
}

export interface AssertFirstRootJudge<Kind extends RuntimeKind> {
  readonly autoevals: {
    closedQA(question: string, material: JudgeMaterial): MeasurementAssertionHandleV1<Kind>;
    factuality(expected: string, material: JudgeMaterial): MeasurementAssertionHandleV1<Kind>;
    summarizes(source: string, material: JudgeMaterial): MeasurementAssertionHandleV1<Kind>;
  };
}

export interface AssertFirstTurnJudge<Kind extends RuntimeKind> {
  readonly autoevals: {
    closedQA(question: string): MeasurementAssertionHandleV1<Kind>;
    factuality(expected: string): MeasurementAssertionHandleV1<Kind>;
    summarizes(source: string): MeasurementAssertionHandleV1<Kind>;
  };
}

export interface AssertFirstTurnHandle<Kind extends RuntimeKind> {
  readonly events: readonly StreamEvent[];
  readonly toolCalls: readonly import("../o11y/types.ts").ToolCall[];
  readonly status: "completed" | "failed" | "waiting";
  readonly message: string;
  readonly data?: JsonValue;
  readonly usage?: Usage;
  succeeded(): BooleanAssertionHandleV1<Kind, void>;
  calledTool(match: ToolMatch, options?: CalledToolOptions): BooleanAssertionHandleV1<Kind, void>;
  calledTool(name: string, options?: CalledToolOptions): BooleanAssertionHandleV1<Kind, void>;
  notCalledTool(match: ToolMatch): BooleanAssertionHandleV1<Kind, void>;
  notCalledTool(name: string): BooleanAssertionHandleV1<Kind, void>;
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
  succeeded(): BooleanAssertionHandleV1<Kind, void>;
  calledTool(match: ToolMatch, options?: CalledToolOptions): BooleanAssertionHandleV1<Kind, void>;
  calledTool(name: string, options?: CalledToolOptions): BooleanAssertionHandleV1<Kind, void>;
  notCalledTool(match: ToolMatch): BooleanAssertionHandleV1<Kind, void>;
  notCalledTool(name: string): BooleanAssertionHandleV1<Kind, void>;
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
  check: AssertionsRuntimeV1<Kind>["t"]["check"];
  readonly sandbox: AssertFirstSandbox<Kind>;
  readonly o11y: import("../o11y/types.ts").O11ySummary;
  readonly usage: Usage;
  succeeded(): BooleanAssertionHandleV1<Kind, void>;
  calledTool(match: ToolMatch, options?: CalledToolOptions): BooleanAssertionHandleV1<Kind, void>;
  calledTool(name: string, options?: CalledToolOptions): BooleanAssertionHandleV1<Kind, void>;
  notCalledTool(match: ToolMatch): BooleanAssertionHandleV1<Kind, void>;
  notCalledTool(name: string): BooleanAssertionHandleV1<Kind, void>;
  readonly judge: AssertFirstRootJudge<Kind>;
} & (Kind extends "score" ? { score(points: number): import("../assertions/api.ts").DirectScoreAssertionHandleV1 } : {});

type AssertionScopeV1 = "turn" | "session" | "attempt";
type ScopeStatusV1 = "completed" | "failed" | "waiting" | "not-started";
type ScopeCoverageV1 = import("../assertions/coverage.ts").ResolvedEvidenceCoverage;

function scopeCriterion(scope: AssertionScopeV1): WritableCriterionEnvelopeV1 {
  return Object.freeze({
    kind: "builtin" as const,
    id: "scope-status/v1" as const,
    data: Object.freeze({ scope, assertion: "succeeded" as const }),
  });
}

function occurrenceCriterion(
  scope: AssertionScopeV1,
  match: ToolMatch,
  quantifier: ToolMatchQuantifier,
): WritableCriterionEnvelopeV1 {
  return Object.freeze({
    kind: "builtin" as const,
    id: "occurrence/v1" as const,
    data: Object.freeze({
      scope,
      occurrence: "tool" as const,
      assertion: quantifier.kind === "absent"
        ? "absent" as const
        : quantifier.kind === "exact"
          ? "count" as const
          : "present" as const,
      matcher: match.name,
      quantifier: Object.freeze(
        quantifier.kind === "absent"
          ? { kind: "absent" as const }
          : { kind: quantifier.kind, count: quantifier.count },
      ),
    }),
  });
}

function scopeCoverageState(
  coverage: ScopeCoverageV1,
  channel: "actions" | "status",
): "complete" | "partial" | "unavailable" {
  return coverage[channel].status;
}

function succeededHandle<Kind extends RuntimeKind>(input: {
  readonly runtime: AssertionsRuntimeV1<Kind>;
  readonly scope: AssertionScopeV1;
  readonly status: ScopeStatusV1;
  readonly coverage: ScopeCoverageV1;
  readonly snapshot: unknown;
}): BooleanAssertionHandleV1<Kind, void> {
  const captured = captureAssertionSnapshotV1({
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

interface ToolScopeSnapshot {
  readonly occurrences: readonly LogicalToolOccurrence[];
  readonly orphanFinishes: readonly OrphanToolOperationFinish[];
  readonly coverage: ScopeCoverageV1;
  readonly snapshot: unknown;
}

function projectToolScope(input: {
  readonly turns: readonly LogicalToolOccurrenceScopeTurn[];
  readonly coverage: ScopeCoverageV1;
  readonly snapshot: unknown;
}): ToolScopeSnapshot {
  const projection = deriveScopedLogicalToolOccurrences(input.turns);
  return Object.freeze({
    occurrences: projection.occurrences,
    orphanFinishes: projection.orphanFinishes,
    coverage: input.coverage,
    snapshot: input.snapshot,
  });
}

function resolveToolTarget(target: ToolMatch | string, label: "calledTool" | "notCalledTool"): ToolMatch {
  if (typeof target === "string") return toolMatch(target);
  return assertManagedToolMatch(target, `${label}() match`);
}

function normalizeCalledToolOptions(value: CalledToolOptions | undefined): ToolMatchQuantifier {
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
  if (actions.status !== "complete") {
    return `scope-actions-${actions.status}:${actions.reason}`;
  }
  if (snapshot.orphanFinishes.length > 0) {
    return `orphan-tool-finish:${snapshot.orphanFinishes.length}`;
  }
  return undefined;
}

function collectionAssertionEvaluation(
  result: Awaited<ReturnType<typeof evaluateToolMatchCollection>>,
): import("../assertions/api.ts").BooleanAssertionEvaluationV1<void> {
  switch (result.state) {
    case "matched":
      return Object.freeze({ state: "matched" as const, value: undefined, diagnostic: result.diagnostic });
    case "mismatched":
      return Object.freeze({ state: "mismatched" as const, diagnostic: result.diagnostic });
    case "unavailable":
      return Object.freeze({
        state: "unavailable" as const,
        reason: "evidence-unavailable" as const,
        diagnostic: result.diagnostic,
      });
  }
}

function toolAssertionHandle<Kind extends RuntimeKind>(input: {
  readonly runtime: AssertionsRuntimeV1<Kind>;
  readonly scope: AssertionScopeV1;
  readonly match: ToolMatch;
  readonly quantifier: ToolMatchQuantifier;
  readonly snapshot: ToolScopeSnapshot;
}): BooleanAssertionHandleV1<Kind, void> {
  const captured = captureAssertionSnapshotV1({
    scope: input.scope,
    occurrence: "tool",
    matcher: input.match.name,
    quantifier: input.quantifier,
    candidates: input.snapshot.occurrences,
    orphanFinishes: input.snapshot.orphanFinishes,
    coverage: input.snapshot.coverage.actions,
    snapshot: input.snapshot.snapshot,
  });
  return input.runtime.registerBoolean<void>({
    criterion: occurrenceCriterion(input.scope, input.match, input.quantifier),
    subject: captured.material,
    coverage: captured.coverage,
    limitations: captured.limitations,
    evaluate: () => Effect.tryPromise({
      try: async () => collectionAssertionEvaluation(await evaluateToolMatchCollection(
        input.match,
        input.snapshot.occurrences,
        {
          quantifier: input.quantifier,
          ...(toolScopeCoverageReason(input.snapshot) === undefined
            ? {}
            : { coverageReason: toolScopeCoverageReason(input.snapshot)! }),
        },
      )),
      catch: (error) => error,
    }),
  });
}

function calledToolHandle<Kind extends RuntimeKind>(input: {
  readonly runtime: AssertionsRuntimeV1<Kind>;
  readonly scope: AssertionScopeV1;
  readonly target: ToolMatch | string;
  readonly options: CalledToolOptions | undefined;
  readonly snapshot: ToolScopeSnapshot;
}): BooleanAssertionHandleV1<Kind, void> {
  return toolAssertionHandle({
    runtime: input.runtime,
    scope: input.scope,
    match: resolveToolTarget(input.target, "calledTool"),
    quantifier: normalizeCalledToolOptions(input.options),
    snapshot: input.snapshot,
  });
}

function notCalledToolHandle<Kind extends RuntimeKind>(input: {
  readonly runtime: AssertionsRuntimeV1<Kind>;
  readonly scope: AssertionScopeV1;
  readonly target: ToolMatch | string;
  readonly snapshot: ToolScopeSnapshot;
}): BooleanAssertionHandleV1<Kind, void> {
  return toolAssertionHandle({
    runtime: input.runtime,
    scope: input.scope,
    match: resolveToolTarget(input.target, "notCalledTool"),
    quantifier: Object.freeze({ kind: "absent" as const }),
    snapshot: input.snapshot,
  });
}

function judgeCriterion(recipe: JudgeRecipeV1): WritableCriterionEnvelopeV1 {
  return Object.freeze({
    kind: "builtin" as const,
    id: "judge-measurement/v1" as const,
    data: Object.freeze({ recipe: recipe === "closedQA" ? "closed-qa" as const : recipe, scale: "unit-interval" as const }),
  });
}

function judgeHandle<Kind extends RuntimeKind>(input: {
  readonly runtime: AssertionsRuntimeV1<Kind>;
  readonly judge: ResolvedJudgeConfig | undefined;
  readonly signal: AbortSignal;
  readonly recipe: JudgeRecipeV1;
  readonly reference: string;
  readonly material: JudgeMaterial;
}): MeasurementAssertionHandleV1<Kind> {
  const judge = input.judge;
  assertJudgeCapabilityV1(judge);
  if (typeof input.reference !== "string" || input.reference.trim() === "") {
    throw new TypeError("Judge recipe reference must be a non-empty string");
  }
  const material = freezeJudgeMaterialV1(input.material);
  const captured = captureAssertionSnapshotV1({
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
    evaluate: () => evaluateJudgeMeasurementV1({
      judge,
      recipe: input.recipe,
      reference: input.reference,
      material,
      signal: input.signal,
    }),
  });
}

const DIFF_REFERENCE_PREVIEW_V1 = "agent-attributed send-window endpoint deltas";

function changedPathsCriterion(paths: readonly string[]): WritableCriterionEnvelopeV1 {
  return Object.freeze({
    kind: "builtin" as const,
    id: "sandbox-result/v1" as const,
    data: Object.freeze({ operation: "changed-paths" as const, paths: Object.freeze([...paths]) }),
  });
}

function noChangesCriterion(): WritableCriterionEnvelopeV1 {
  return Object.freeze({
    kind: "builtin" as const,
    id: "sandbox-result/v1" as const,
    data: Object.freeze({ operation: "no-changes" as const }),
  });
}

function fileChangedCriterion(
  path: string,
  options: Readonly<FileChangedOptions>,
): WritableCriterionEnvelopeV1 {
  return Object.freeze({
    kind: "builtin" as const,
    id: "sandbox-result/v1" as const,
    data: Object.freeze({
      operation: "file-changed" as const,
      path,
      ...(options.status === undefined ? {} : { status: options.status }),
      ...(options.before === undefined ? {} : { before: options.before.name }),
      ...(options.after === undefined ? {} : { after: options.after.name }),
    }),
  });
}

function fileDeletedCriterion(path: string): WritableCriterionEnvelopeV1 {
  return Object.freeze({
    kind: "builtin" as const,
    id: "sandbox-result/v1" as const,
    data: Object.freeze({ operation: "file-deleted" as const, path }),
  });
}

function notInDiffCriterion(
  pattern: RegExp,
  options: Readonly<WorkspaceDiffNotInOptionsV1>,
): WritableCriterionEnvelopeV1 {
  return Object.freeze({
    kind: "builtin" as const,
    id: "sandbox-result/v1" as const,
    data: Object.freeze({
      operation: "not-in-diff" as const,
      pattern: pattern.source,
      flags: pattern.flags,
      content: options.content ?? "both",
    }),
  });
}

function diffReferenceMaterial() {
  return Object.freeze({
    kind: "record-attachment" as const,
    schemaId: "niceeval.diff/v1" as const,
    preview: DIFF_REFERENCE_PREVIEW_V1,
  });
}

function assertDiffPath(path: unknown, operation: string): asserts path is string {
  assertCanonicalWorkspaceRelativePathV1(path, `${operation} path`);
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
  value: WorkspaceDiffNotInOptionsV1 | undefined,
): Readonly<WorkspaceDiffNotInOptionsV1> {
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
  endpoint: AgentWorkspaceDiffEndpointV1,
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
  readonly runtime: AssertionsRuntimeV1<Kind>;
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
    criterion: WritableCriterionEnvelopeV1,
    evaluate: () => import("effect").Effect.Effect<
      import("../assertions/api.ts").BooleanAssertionEvaluationV1<void>,
      unknown,
      never
    >,
  ): PostRunBooleanAssertionHandleV1<Kind, void> => postRunBooleanAssertionHandleV1(
    input.runtime.registerBoolean<void>({
      criterion,
      subject: diffReferenceMaterial(),
      evaluate,
    }),
    input.runtime.evaluationKind,
  );

  const changedPaths = (paths: readonly string[]): PostRunBooleanAssertionHandleV1<Kind, void> => {
    requireCapability();
    if (!Array.isArray(paths)) throw new TypeError("changedPaths() requires an array of paths");
    for (const path of paths) assertDiffPath(path, "changedPaths()");
    validateExpectedTouchedPaths(paths);
    const expected = Object.freeze([...paths]);
    return register(changedPathsCriterion(expected), () => Effect.sync(() => {
      const diff = input.late.diff;
      if (diff.state !== "available") return unavailableDiffResult();
      return agentWorkspaceDiffPathsMatchV1(diff.document, expected)
        ? Object.freeze({ state: "matched" as const, value: undefined })
        : Object.freeze({ state: "mismatched" as const });
    }));
  };

  const fileChanged = (
    path: string,
    rawOptions?: FileChangedOptions,
  ): PostRunBooleanAssertionHandleV1<Kind, void> => {
    requireCapability();
    assertDiffPath(path, "fileChanged()");
    const options = normalizeFileChangedOptions(rawOptions);
    return register(fileChangedCriterion(path, options), () => Effect.tryPromise({
      try: async () => {
        const diff = input.late.diff;
        if (diff.state !== "available") return unavailableDiffResult();
        let unavailable = false;
        for (const candidate of agentWorkspaceDiffChangesForPathV1(diff.document, path)) {
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
    rawOptions?: WorkspaceDiffNotInOptionsV1,
  ): PostRunBooleanAssertionHandleV1<Kind, void> => {
    requireCapability();
    if (!(pattern instanceof RegExp)) throw new TypeError("notInDiff() pattern must be a RegExp");
    const options = normalizeNotInDiffOptions(rawOptions);
    return register(notInDiffCriterion(pattern, options), () => Effect.sync(() => {
      const diff = input.late.diff;
      if (diff.state !== "available") return unavailableDiffResult();
      const result = evaluateWorkspaceDiffNotInV1(diff.document, pattern, options);
      return result.state === "matched"
        ? Object.freeze({ state: "matched" as const, value: undefined })
        : result.state === "mismatched"
          ? Object.freeze({ state: "mismatched" as const })
          : unavailableDiffResult();
    }));
  };

  const noChanges = (): PostRunBooleanAssertionHandleV1<Kind, void> => {
    requireCapability();
    return register(noChangesCriterion(), () => Effect.sync(() => {
      const diff = input.late.diff;
      if (diff.state !== "available") return unavailableDiffResult();
      return agentWorkspaceDiffPathsMatchV1(diff.document, [])
        ? Object.freeze({ state: "matched" as const, value: undefined })
        : Object.freeze({ state: "mismatched" as const });
    }));
  };
  const fileDeleted = (path: string): PostRunBooleanAssertionHandleV1<Kind, void> => {
    requireCapability();
    assertDiffPath(path, "fileDeleted()");
    return register(fileDeletedCriterion(path), () => Effect.sync(() => {
      const diff = input.late.diff;
      if (diff.state !== "available") return unavailableDiffResult();
      return agentWorkspaceDiffChangesForPathV1(diff.document, path)
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
  let sourceOrder = 0;
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
    requestEffect: deps.requestEffect,
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
    nextSourceOrder: () => ++sourceOrder,
  });
  const runtime: AssertionsRuntimeV1<RuntimeKind> = deps.evaluationKind === "score"
    ? createAssertionsRuntimeV1({ evaluationKind: "score", executeStop: deps.executeStop })
    : createAssertionsRuntimeV1({ evaluationKind: "pass", executeStop: deps.executeStop });
  const state: AssertFirstContextState = {
    assertions: runtime,
    manager,
    late: { diff: Object.freeze({ state: "pending" as const }), scripts: {} },
  };

  interface TurnScopeSnapshot {
    readonly events: readonly StreamEvent[];
    readonly toolCalls: readonly import("../o11y/types.ts").ToolCall[];
    readonly toolScope: ToolScopeSnapshot;
    readonly status: "completed" | "failed" | "waiting";
    readonly coverage: ScopeCoverageV1;
    readonly input: string;
    readonly output: string;
  }

  interface SessionScopeState {
    readonly session: RunSession;
    readonly turns: LogicalToolOccurrenceScopeTurn[];
    started: boolean;
    inFlight: number;
    failed: boolean;
  }

  const sessions: SessionScopeState[] = [];
  let toolTurnOrdinal = 0;

  const coverageWhileInFlight = (coverage: ScopeCoverageV1): ScopeCoverageV1 =>
    Object.freeze({
      ...coverage,
      actions: Object.freeze({ status: "partial" as const, reason: "scope-still-running" }),
      status: Object.freeze({ status: "partial" as const, reason: "scope-still-running" }),
    });

  const sessionCoverage = (scope: SessionScopeState): ScopeCoverageV1 =>
    scope.inFlight === 0
      ? scope.session.evidenceCoverage
      : coverageWhileInFlight(scope.session.evidenceCoverage);

  const sessionStatus = (scope: SessionScopeState): ScopeStatusV1 => {
    if (!scope.started) return "not-started";
    if (scope.inFlight > 0) return "waiting";
    return scope.failed ? "failed" : scope.session.lastStatus;
  };

  const attemptCoverage = (): ScopeCoverageV1 => {
    const active = sessions.filter((scope) => scope.started);
    const coverage = active.length === 0
      ? manager.evidenceCoverage
      : active.some((scope) => scope.inFlight > 0)
        ? coverageWhileInFlight(manager.evidenceCoverage)
        : manager.evidenceCoverage;
    return coverage;
  };

  const attemptStatus = (): ScopeStatusV1 => {
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
      coverage,
      snapshot: Object.freeze({
        sessionIndex: scope.session.index,
        turnCount: scope.turns.length,
        status: sessionStatus(scope),
        coverage,
      }),
    });
  };

  const attemptToolScope = (): ToolScopeSnapshot => {
    const active = sessions.filter((scope) => scope.started);
    const coverage = attemptCoverage();
    return projectToolScope({
      turns: Object.freeze(active.flatMap((scope) => scope.turns)),
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
    });
  };

  const makeTurn = <Kind extends RuntimeKind>(
    scope: SessionScopeState,
    turn: Turn,
    input: string,
  ): AssertFirstTurnHandle<Kind> => {
    const events = Object.freeze([...turn.events]);
    const toolCalls = Object.freeze([...deriveRunFacts(events).toolCalls]);
    const coverage = manager.resolveTurnEvidenceCoverage(turn);
    const occurrenceTurn: LogicalToolOccurrenceScopeTurn = Object.freeze({
      session: `session-${scope.session.index}`,
      turn: `turn-${scope.session.turnCount}`,
      turnOrdinal: ++toolTurnOrdinal,
      events,
      outcome: turn.status,
    });
    scope.turns.push(occurrenceTurn);
    const toolScope = projectToolScope({
      turns: Object.freeze([occurrenceTurn]),
      coverage,
      snapshot: Object.freeze({
        sessionIndex: scope.session.index,
        turnIndex: scope.session.turnCount,
        events: events.length,
      }),
    });
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
          runtime: runtime as AssertionsRuntimeV1<Kind>,
          judge: deps.judge,
          signal: deps.signal,
          recipe: "closedQA",
          reference: question,
          material: { input: snapshot.input, output: snapshot.output },
        }),
        factuality: (expected: string) => judgeHandle({
          runtime: runtime as AssertionsRuntimeV1<Kind>,
          judge: deps.judge,
          signal: deps.signal,
          recipe: "factuality",
          reference: expected,
          material: { input: snapshot.input, output: snapshot.output },
        }),
        summarizes: (source: string) => judgeHandle({
          runtime: runtime as AssertionsRuntimeV1<Kind>,
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
        runtime: runtime as AssertionsRuntimeV1<Kind>,
        scope: "turn",
        target,
        options,
        snapshot: toolScope,
      });
    };
    const notCalledTool = (target: ToolMatch | string, ...extra: readonly unknown[]) => {
      if (extra.length > 0) throw new TypeError("notCalledTool() accepts exactly one match or name");
      return notCalledToolHandle({
        runtime: runtime as AssertionsRuntimeV1<Kind>,
        scope: "turn",
        target,
        snapshot: toolScope,
      });
    };
    return Object.freeze({
      events: snapshot.events,
      toolCalls: snapshot.toolCalls,
      status: snapshot.status,
      message: snapshot.output,
      ...(turn.data === undefined ? {} : { data: turn.data }),
      ...(turn.usage === undefined ? {} : { usage: turn.usage }),
      succeeded: () => succeededHandle({
        runtime: runtime as AssertionsRuntimeV1<Kind>,
        scope: "turn",
        status: snapshot.status,
        coverage: snapshot.coverage,
        snapshot: Object.freeze({
          sessionIndex: scope.session.index,
          turnIndex: scope.session.turnCount,
          events: snapshot.events.length,
        }),
      }),
      calledTool,
      notCalledTool,
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
    const capturedLoc = loc ?? captureLoc();
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
    deps.requestEffect(sendEffect<Kind>(scope, text, files, responses, captureLoc()));

  const makeSession = <Kind extends RuntimeKind>(scope: SessionScopeState): AssertFirstSessionHandle<Kind> => {
    const session = scope.session;
    return Object.freeze({
      send: (input: string | { readonly text: string; readonly files?: readonly InputFile[] }) => {
        const text = typeof input === "string" ? input : input.text;
        const files = typeof input === "string" ? undefined : input.files;
        return send<Kind>(scope, text, files);
      },
      sendFile: (path: string, text?: string) => {
        const loc = captureLoc();
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
      succeeded: () => succeededHandle({
        runtime: runtime as AssertionsRuntimeV1<Kind>,
        scope: "session",
        status: sessionStatus(scope),
        coverage: sessionCoverage(scope),
        snapshot: sessionSnapshot(scope),
      }),
      calledTool: (target: ToolMatch | string, options?: CalledToolOptions, ...extra: readonly unknown[]) => {
        if (extra.length > 0) throw new TypeError("calledTool() accepts exactly (match, options)");
        return calledToolHandle({
          runtime: runtime as AssertionsRuntimeV1<Kind>,
          scope: "session",
          target,
          options,
          snapshot: sessionToolScope(scope),
        });
      },
      notCalledTool: (target: ToolMatch | string, ...extra: readonly unknown[]) => {
        if (extra.length > 0) throw new TypeError("notCalledTool() accepts exactly one match or name");
        return notCalledToolHandle({
          runtime: runtime as AssertionsRuntimeV1<Kind>,
          scope: "session",
          target,
          snapshot: sessionToolScope(scope),
        });
      },
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
        scope: "attempt",
        target,
        options,
        snapshot: attemptToolScope(),
      });
    },
    notCalledTool: (target: ToolMatch | string, ...extra: readonly unknown[]) => {
      if (extra.length > 0) throw new TypeError("notCalledTool() accepts exactly one match or name");
      return notCalledToolHandle({
        runtime,
        scope: "attempt",
        target,
        snapshot: attemptToolScope(),
      });
    },
    judge: rootJudge,
  };
  const context = deps.evaluationKind === "score"
    ? Object.freeze({
        ...base,
        score: (runtime as AssertionsRuntimeV1<"score">).t.score,
      })
    : Object.freeze(base);
  return {
    context: context as AssertFirstTestContext<RuntimeKind>,
    state,
  };
}
