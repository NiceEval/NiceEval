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
  createAssertionsRuntimeV1,
} from "../assertions/runtime.ts";
import type {
  AssertionsRuntimeV1,
  BooleanAssertionHandleV1,
} from "../assertions/api.ts";
import type {
  AssertionSnapshotMaterialV1,
} from "../assertions/api.ts";
import type { WritableCriterionEnvelopeV1 } from "../assertions/record/model.ts";
import { emptyDiffData } from "../assertions/diff.ts";
import { buildO11ySummary, deriveRunFacts } from "../o11y/derive.ts";
import { lastAssistantText, RunSession, SessionManager } from "./session.ts";
import { EvalSkipped } from "./control-flow.ts";
import type { ConcurrencySlot } from "./send-retry.ts";
import type { AnswerValue, InputResponse } from "../agents/types.ts";
import { matchesJson } from "../shared/json-match.ts";
import type {
  Agent,
  DiffData,
  InputFile,
  InputRequest,
  InputRequestFilter,
  JsonValue,
  Sandbox,
  StreamEvent,
  Turn,
  Usage,
} from "../types.ts";

export interface AssertFirstLateResult {
  diff: DiffData;
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
  readonly evaluationKind: "pass" | "score";
}

type RuntimeKind = "pass" | "score";
type AssertFirstRespondAnswerV1 = { readonly request: InputRequest } & AnswerValue;

export interface AssertFirstTurnHandleV1<Kind extends RuntimeKind> {
  readonly events: readonly StreamEvent[];
  readonly toolCalls: readonly import("../o11y/types.ts").ToolCall[];
  readonly status: "completed" | "failed" | "waiting";
  readonly message: string;
  readonly data?: JsonValue;
  readonly usage?: Usage;
  succeeded(): BooleanAssertionHandleV1<Kind, void>;
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
  group<Value, Error>(
    title: string,
    body: () => Effect.Effect<Value, Error, never>,
  ): Effect.Effect<Value, Error, never>;
  check: AssertionsRuntimeV1<Kind>["t"]["check"];
  readonly sandbox: Sandbox;
  readonly o11y: import("../o11y/types.ts").O11ySummary;
  readonly usage: Usage;
  succeeded(): BooleanAssertionHandleV1<Kind, void>;
} & (Kind extends "score" ? { score(points: number): import("../assertions/api.ts").DirectScoreAssertionHandleV1 } : {});

function snapshot(value: string | number | boolean | null | { readonly [key: string]: string | number | boolean | null }): AssertionSnapshotMaterialV1 {
  const material = typeof value === "object" && value !== null
    ? Object.freeze({ ...value })
    : value;
  return Object.freeze({ kind: "snapshot" as const, value: material });
}

function scopeCriterion(
  scope: "turn" | "session" | "attempt",
): WritableCriterionEnvelopeV1 {
  return Object.freeze({
    kind: "builtin" as const,
    id: "scope-status/v1" as const,
    data: Object.freeze({ scope, assertion: "succeeded" as const }),
  });
}

function succeededHandle<Kind extends RuntimeKind>(input: {
  readonly runtime: AssertionsRuntimeV1<Kind>;
  readonly scope: "turn" | "session" | "attempt";
  readonly status: () => "completed" | "failed" | "waiting";
}): BooleanAssertionHandleV1<Kind, void> {
  return input.runtime.registerBoolean<void>({
    criterion: scopeCriterion(input.scope),
    subject: snapshot({ scope: input.scope, assertion: "succeeded" }),
    evaluate: () =>
      Effect.sync(() =>
        input.status() === "completed"
          ? Object.freeze({ state: "matched" as const, value: undefined })
          : Object.freeze({ state: "mismatched" as const }),
      ),
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

async function readInputFile(path: string): Promise<InputFile> {
  const bytes = await readFile(path);
  return Object.freeze({
    filename: basename(path),
    mimeType: mimeTypeFor(path),
    dataBase64: bytes.toString("base64"),
  });
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
    ? createAssertionsRuntimeV1({ evaluationKind: "score" })
    : createAssertionsRuntimeV1({ evaluationKind: "pass" });
  const state: AssertFirstContextState = {
    assertions: runtime,
    manager,
    late: { diff: emptyDiffData(), scripts: {} },
  };

  const makeTurn = <Kind extends RuntimeKind>(turn: Turn): AssertFirstTurnHandleV1<Kind> => ({
    events: turn.events,
    toolCalls: deriveRunFacts(turn.events).toolCalls,
    status: turn.status,
    message: lastAssistantText(turn.events) ?? "",
    ...(turn.data === undefined ? {} : { data: turn.data }),
    ...(turn.usage === undefined ? {} : { usage: turn.usage }),
    succeeded: () => succeededHandle({
      runtime: runtime as AssertionsRuntimeV1<Kind>,
      scope: "turn",
      status: () => turn.status,
    }),
  });

  const send = async <Kind extends RuntimeKind>(
    session: RunSession,
    input: string | { readonly text: string; readonly files?: readonly InputFile[] },
  ): Promise<AssertFirstTurnHandleV1<Kind>> => {
    const text = typeof input === "string" ? input : input.text;
    const files = typeof input === "string" ? undefined : input.files;
    return makeTurn<Kind>(await manager.send(session, text, files));
  };

  const makeSession = <Kind extends RuntimeKind>(session: RunSession): AssertFirstSessionHandleV1<Kind> => ({
    send: (input) => send<Kind>(session, input),
    async sendFile(path, text) {
      const file = await readInputFile(path);
      return makeTurn<Kind>(await manager.send(session, text ?? "", [file]));
    },
    requireInputRequest: (filter) => requireInputRequest(session, filter),
    async respond(...responses) {
      if (responses.length === 0) throw new Error("respond() requires at least one answer");
      const built = buildRespondInput(session, responses);
      session.pendingInputRequests.length = 0;
      return makeTurn<Kind>(await manager.send(session, built.text, undefined, built.responses));
    },
    async respondAll(optionId) {
      if (session.pendingInputRequests.length === 0) {
        throw new Error("There is no pending input request to answer");
      }
      const requests = session.pendingInputRequests.slice();
      for (const request of requests) validateOptionId(request, optionId);
      session.pendingInputRequests.length = 0;
      return makeTurn<Kind>(await manager.send(
        session,
        requests.map(() => optionId).join("\n"),
        undefined,
        requests.map((request) => ({ requestId: requireRequestId(request), optionId })),
      ));
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
      status: () => session.lastStatus,
    }),
  });

  const primary = makeSession<RuntimeKind>(manager.primary);

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
    newSession: () => makeSession<RuntimeKind>(manager.newSession()),
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
    sandbox: guardSandbox(deps.agent, deps.sandbox),
    get o11y() {
      return buildO11ySummary(manager.allEvents);
    },
    get usage() {
      return Object.freeze({ ...manager.usage });
    },
    succeeded: () => succeededHandle({
      runtime,
      scope: "attempt",
      status: () => manager.lastStatus,
    }),
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
