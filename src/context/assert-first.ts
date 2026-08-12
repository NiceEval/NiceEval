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
  evaluateWorkspaceDiffNotInV1,
  validateExpectedTouchedPaths,
  type AgentWorkspaceDiffEndpointV1,
  type PostRunWorkspaceDiffStateV1,
  type WorkspaceDiffNotInOptionsV1,
} from "../assertions/diff.ts";
import { evaluateBooleanMatch, type BooleanMatch } from "../assertions/match.ts";
import { buildO11ySummary, deriveRunFacts } from "../o11y/derive.ts";
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
  StreamEvent,
  Turn,
  Usage,
} from "../types.ts";

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
type AssertFirstRespondAnswerV1 = { readonly request: InputRequest } & AnswerValue;

export interface AssertFirstCalledToolCountV1 {
  readonly atLeast: number;
}

export type AssertFirstCalledToolCountMatcherV1 =
  | number
  | AssertFirstCalledToolCountV1
  | ((count: number) => boolean);

export interface AssertFirstCalledToolOptionsV1 {
  readonly input?: JsonMatch;
  readonly output?: JsonMatch;
  readonly status?: "pending" | "completed" | "failed" | "rejected";
  readonly count?: AssertFirstCalledToolCountMatcherV1;
}

export interface AssertFirstFileChangedOptionsV1 {
  readonly status?: "added" | "modified" | "deleted";
  readonly before?: BooleanMatch<string, string, "value">;
  readonly after?: BooleanMatch<string, string, "value">;
}

/** The only agent-attributed post-run diff surface exposed to Eval authors. */
export interface AssertFirstSandboxV1<Kind extends RuntimeKind> extends Sandbox {
  changedPaths(paths: readonly string[]): PostRunBooleanAssertionHandleV1<Kind, void>;
  noChanges(): PostRunBooleanAssertionHandleV1<Kind, void>;
  fileChanged(
    path: string,
    options?: AssertFirstFileChangedOptionsV1,
  ): PostRunBooleanAssertionHandleV1<Kind, void>;
  fileDeleted(path: string): PostRunBooleanAssertionHandleV1<Kind, void>;
  notInDiff(
    pattern: RegExp,
    options?: WorkspaceDiffNotInOptionsV1,
  ): PostRunBooleanAssertionHandleV1<Kind, void>;
}

export interface AssertFirstRootJudgeV1<Kind extends RuntimeKind> {
  readonly autoevals: {
    closedQA(question: string, material: JudgeMaterial): MeasurementAssertionHandleV1<Kind>;
    factuality(expected: string, material: JudgeMaterial): MeasurementAssertionHandleV1<Kind>;
    summarizes(source: string, material: JudgeMaterial): MeasurementAssertionHandleV1<Kind>;
  };
}

export interface AssertFirstTurnJudgeV1<Kind extends RuntimeKind> {
  readonly autoevals: {
    closedQA(question: string): MeasurementAssertionHandleV1<Kind>;
    factuality(expected: string): MeasurementAssertionHandleV1<Kind>;
    summarizes(source: string): MeasurementAssertionHandleV1<Kind>;
  };
}

export interface AssertFirstTurnHandleV1<Kind extends RuntimeKind> {
  readonly events: readonly StreamEvent[];
  readonly toolCalls: readonly import("../o11y/types.ts").ToolCall[];
  readonly status: "completed" | "failed" | "waiting";
  readonly message: string;
  readonly data?: JsonValue;
  readonly usage?: Usage;
  succeeded(): BooleanAssertionHandleV1<Kind, void>;
  calledTool(
    name: string,
    options?: AssertFirstCalledToolOptionsV1,
  ): BooleanAssertionHandleV1<Kind, void>;
  readonly judge: AssertFirstTurnJudgeV1<Kind>;
}

export interface AssertFirstSessionHandleV1<Kind extends RuntimeKind> {
  send(input: string | { readonly text: string; readonly files?: readonly InputFile[] }): Promise<AssertFirstTurnHandleV1<Kind>>;
  sendFile(path: string, text?: string): Promise<AssertFirstTurnHandleV1<Kind>>;
  requireInputRequest(filter?: InputRequestFilter): InputRequest;
  respond(...responses: readonly (string | AssertFirstRespondAnswerV1)[]): Promise<AssertFirstTurnHandleV1<Kind>>;
  respondAll(optionId: string): Promise<AssertFirstTurnHandleV1<Kind>>;
  readonly reply: string;
  readonly sessionId: string | undefined;
  readonly events: readonly StreamEvent[];
  readonly usage: Usage;
  succeeded(): BooleanAssertionHandleV1<Kind, void>;
  calledTool(
    name: string,
    options?: AssertFirstCalledToolOptionsV1,
  ): BooleanAssertionHandleV1<Kind, void>;
}

export type AssertFirstTestContextV1<Kind extends RuntimeKind> = {
  readonly evaluationKind: Kind;
  send(input: string | { readonly text: string; readonly files?: readonly InputFile[] }): Promise<AssertFirstTurnHandleV1<Kind>>;
  sendFile(path: string, text?: string): Promise<AssertFirstTurnHandleV1<Kind>>;
  requireInputRequest(filter?: InputRequestFilter): InputRequest;
  respond(...responses: readonly (string | AssertFirstRespondAnswerV1)[]): Promise<AssertFirstTurnHandleV1<Kind>>;
  respondAll(optionId: string): Promise<AssertFirstTurnHandleV1<Kind>>;
  readonly reply: string;
  readonly sessionId: string | undefined;
  readonly events: readonly StreamEvent[];
  newSession(): AssertFirstSessionHandleV1<Kind>;
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
  readonly sandbox: AssertFirstSandboxV1<Kind>;
  readonly o11y: import("../o11y/types.ts").O11ySummary;
  readonly usage: Usage;
  succeeded(): BooleanAssertionHandleV1<Kind, void>;
  calledTool(
    name: string,
    options?: AssertFirstCalledToolOptionsV1,
  ): BooleanAssertionHandleV1<Kind, void>;
  readonly judge: AssertFirstRootJudgeV1<Kind>;
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

function occurrenceCriterion(scope: AssertionScopeV1, count: boolean): WritableCriterionEnvelopeV1 {
  return Object.freeze({
    kind: "builtin" as const,
    id: "occurrence/v1" as const,
    data: Object.freeze({
      scope,
      occurrence: "tool" as const,
      assertion: count ? "count" as const : "present" as const,
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

function assertCalledToolName(name: unknown): asserts name is string {
  if (typeof name !== "string" || name.trim() === "") {
    throw new TypeError("calledTool() name must be a non-empty string");
  }
}

function normalizeCalledToolOptions(
  value: AssertFirstCalledToolOptionsV1 | undefined,
): Readonly<AssertFirstCalledToolOptionsV1> {
  if (value === undefined) return Object.freeze({});
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("calledTool() options must be an object");
  }
  const { count, status } = value;
  if (status !== undefined && status !== "pending" && status !== "completed" && status !== "failed" && status !== "rejected") {
    throw new TypeError("calledTool() options.status must be pending, completed, failed, or rejected");
  }
  if (count !== undefined) {
    if (typeof count === "number") {
      if (!Number.isSafeInteger(count) || count < 0) {
        throw new TypeError("calledTool() options.count must be a non-negative safe integer");
      }
    } else if (typeof count === "function") {
      // The predicate is deliberately retained only by the evaluator closure.
      // Persisted material records that a predicate was used, rather than
      // attempting to serialize arbitrary author code.
    } else if (
      typeof count !== "object"
      || count === null
      || !Number.isSafeInteger(count.atLeast)
      || count.atLeast < 0
    ) {
      throw new TypeError("calledTool() options.count must be a non-negative integer or { atLeast: non-negative integer }");
    }
  }
  return Object.freeze({ ...value });
}

function toolName(call: import("../o11y/types.ts").ToolCall): string {
  return call.name === "unknown" && call.originalName !== undefined
    ? call.originalName
    : call.name;
}

function calledToolHandle<Kind extends RuntimeKind>(input: {
  readonly runtime: AssertionsRuntimeV1<Kind>;
  readonly scope: AssertionScopeV1;
  readonly calls: readonly import("../o11y/types.ts").ToolCall[];
  readonly coverage: ScopeCoverageV1;
  readonly name: string;
  readonly options: AssertFirstCalledToolOptionsV1 | undefined;
  readonly snapshot: unknown;
}): BooleanAssertionHandleV1<Kind, void> {
  assertCalledToolName(input.name);
  const options = normalizeCalledToolOptions(input.options);
  const calls = Object.freeze(input.calls.map((call) => Object.freeze({
    operationId: call.operationId,
    name: toolName(call),
    input: call.input,
    ...(call.output === undefined ? {} : { output: call.output }),
    status: call.status,
  })));
  const captured = captureAssertionSnapshotV1({
    scope: input.scope,
    occurrence: "tool",
    name: input.name,
    options: Object.freeze({
      ...options,
      ...(typeof options.count === "function" ? { count: "predicate" } : {}),
    }),
    calls,
    coverage: input.coverage.actions.status,
    snapshot: input.snapshot,
  });
  const exactCount = typeof options.count === "number" ? options.count : undefined;
  const minimum = typeof options.count === "object" && options.count !== null
    ? options.count.atLeast
    : undefined;
  const predicate = typeof options.count === "function" ? options.count : undefined;
  return input.runtime.registerBoolean<void>({
    criterion: occurrenceCriterion(input.scope, exactCount !== undefined),
    subject: captured.material,
    coverage: captured.coverage,
    limitations: captured.limitations,
    evaluate: () =>
      Effect.sync(() => {
        const matches = calls.filter((call) =>
          call.name === input.name
          && (options.input === undefined || matchesJson(call.input, options.input))
          && (options.output === undefined || matchesJson(call.output, options.output))
          && (options.status === undefined || call.status === options.status)
        ).length;
        const complete = scopeCoverageState(input.coverage, "actions") === "complete";
        if (exactCount !== undefined) {
          if (matches > exactCount) return Object.freeze({ state: "mismatched" as const });
          if (matches === exactCount && complete) {
            return Object.freeze({ state: "matched" as const, value: undefined });
          }
          return complete
            ? Object.freeze({ state: "mismatched" as const })
            : Object.freeze({ state: "unavailable" as const, reason: "evidence-unavailable" as const });
        }
        if (predicate !== undefined) {
          if (predicate(matches)) return Object.freeze({ state: "matched" as const, value: undefined });
        } else if (matches >= (minimum ?? 1)) {
          return Object.freeze({ state: "matched" as const, value: undefined });
        }
        return complete
          ? Object.freeze({ state: "mismatched" as const })
          : Object.freeze({ state: "unavailable" as const, reason: "evidence-unavailable" as const });
      }),
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

function guardSandbox(agent: Agent, sandbox: Sandbox): Sandbox {
  if (agent.kind === "sandbox") return sandbox;
  return new Proxy(sandbox, {
    get(_target, property) {
      throw new Error(
        `Agent ${JSON.stringify(agent.name)} does not provide sandbox; t.sandbox.${String(property)} is unavailable.`,
      );
    },
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
  options: Readonly<AssertFirstFileChangedOptionsV1>,
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
  if (typeof path !== "string" || path.length === 0 || path.includes("\u0000")) {
    throw new TypeError(`${operation} path must be a non-empty string without NUL`);
  }
}

function normalizeFileChangedOptions(
  value: AssertFirstFileChangedOptionsV1 | undefined,
): Readonly<AssertFirstFileChangedOptionsV1> {
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
}): AssertFirstSandboxV1<Kind> {
  const guarded = guardSandbox(input.agent, input.sandbox);
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
  ): PostRunBooleanAssertionHandleV1<Kind, void> => input.runtime.registerBoolean<void>({
    criterion,
    subject: diffReferenceMaterial(),
    evaluate,
  });

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
    rawOptions?: AssertFirstFileChangedOptionsV1,
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

  return Object.freeze(new Proxy(guarded, {
    get(target, property, receiver) {
      switch (property) {
        case "changedPaths": return changedPaths;
        case "noChanges": return () => {
          requireCapability();
          return register(noChangesCriterion(), () => Effect.sync(() => {
            const diff = input.late.diff;
            if (diff.state !== "available") return unavailableDiffResult();
            return agentWorkspaceDiffPathsMatchV1(diff.document, [])
              ? Object.freeze({ state: "matched" as const, value: undefined })
              : Object.freeze({ state: "mismatched" as const });
          }));
        };
        case "fileChanged": return fileChanged;
        case "fileDeleted": return (path: string) => {
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
        case "notInDiff": return notInDiff;
        default: return Reflect.get(target, property, receiver);
      }
    },
  })) as AssertFirstSandboxV1<Kind>;
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
  answers: readonly (string | AssertFirstRespondAnswerV1)[],
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
): { readonly context: AssertFirstTestContextV1<RuntimeKind>; readonly state: AssertFirstContextState } {
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
    readonly status: "completed" | "failed" | "waiting";
    readonly coverage: ScopeCoverageV1;
    readonly input: string;
    readonly output: string;
  }

  interface SessionScopeState {
    readonly session: RunSession;
    started: boolean;
    inFlight: number;
    failed: boolean;
  }

  const sessions: SessionScopeState[] = [];

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

  const makeTurn = <Kind extends RuntimeKind>(
    scope: SessionScopeState,
    turn: Turn,
    input: string,
  ): AssertFirstTurnHandleV1<Kind> => {
    const events = Object.freeze([...turn.events]);
    const toolCalls = Object.freeze([...deriveRunFacts(events).toolCalls]);
    const coverage = manager.resolveTurnEvidenceCoverage(turn);
    const snapshot: TurnScopeSnapshot = Object.freeze({
      events,
      toolCalls,
      status: turn.status,
      coverage,
      input,
      output: lastAssistantText(events) ?? "",
    });
    const judge: AssertFirstTurnJudgeV1<Kind> = Object.freeze({
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
      calledTool: (name: string, options?: AssertFirstCalledToolOptionsV1) => calledToolHandle({
        runtime: runtime as AssertionsRuntimeV1<Kind>,
        scope: "turn",
        calls: snapshot.toolCalls,
        coverage: snapshot.coverage,
        name,
        options,
        snapshot: Object.freeze({
          sessionIndex: scope.session.index,
          turnIndex: scope.session.turnCount,
        }),
      }),
      judge,
    });
  };

  const sendEffect = <Kind extends RuntimeKind>(
    scope: SessionScopeState,
    text: string,
    files?: readonly InputFile[],
    responses?: readonly InputResponse[],
    loc?: ReturnType<typeof captureLoc>,
  ): Effect.Effect<AssertFirstTurnHandleV1<Kind>, unknown> => {
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
  ): Promise<AssertFirstTurnHandleV1<Kind>> =>
    deps.requestEffect(sendEffect<Kind>(scope, text, files, responses, captureLoc()));

  const makeSession = <Kind extends RuntimeKind>(scope: SessionScopeState): AssertFirstSessionHandleV1<Kind> => {
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
      async respond(...responses: readonly (string | AssertFirstRespondAnswerV1)[]) {
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
      calledTool: (name: string, options?: AssertFirstCalledToolOptionsV1) => calledToolHandle({
        runtime: runtime as AssertionsRuntimeV1<Kind>,
        scope: "session",
        calls: Object.freeze([...deriveRunFacts(session.events).toolCalls]),
        coverage: sessionCoverage(scope),
        name,
        options,
        snapshot: sessionSnapshot(scope),
      }),
    });
  };

  const primaryScope: SessionScopeState = {
    session: manager.primary,
    started: false,
    inFlight: 0,
    failed: false,
  };
  sessions.push(primaryScope);
  const primary = makeSession<RuntimeKind>(primaryScope);

  const rootJudge: AssertFirstRootJudgeV1<RuntimeKind> = Object.freeze({
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
    calledTool: (name: string, options?: AssertFirstCalledToolOptionsV1) => calledToolHandle({
      runtime,
      scope: "attempt",
      calls: Object.freeze([...deriveRunFacts(manager.allEvents).toolCalls]),
      coverage: attemptCoverage(),
      name,
      options,
      snapshot: attemptSnapshot(),
    }),
    judge: rootJudge,
  };
  const context = deps.evaluationKind === "score"
    ? Object.freeze({
        ...base,
        score: (runtime as AssertionsRuntimeV1<"score">).t.score,
      })
    : Object.freeze(base);
  return {
    context: context as AssertFirstTestContextV1<RuntimeKind>,
    state,
  };
}
