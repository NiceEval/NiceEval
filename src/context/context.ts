// 构造 eval 作者拿到的高层上下文 t。这里把会话驱动(SessionManager)、
// 断言收集(AssertionCollector)、作用域断言、judge 命名空间接到一起。

import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { SessionManager, RunSession, lastAssistantText } from "./session.ts";
import { AssertionCollector } from "../scoring/collector.ts";
import type { Spec } from "../scoring/collector.ts";
import * as Scoped from "../scoring/scoped.ts";
import { buildJudge } from "../scoring/judge.ts";
import { EvalSkipped, EvalRequirementFailed, TurnFailed } from "./control-flow.ts";
import { deriveRunFacts } from "../o11y/derive.ts";
import { t } from "../i18n/index.ts";
import { resolveLocalPath } from "../sandbox/paths.ts";
import type {
  Agent,
  DiffData,
  DiffView,
  InputFile,
  InputRequest,
  InputRequestFilter,
  JudgeConfig,
  Sandbox,
  SandboxHandle,
  ScoringContext,
  ScriptResult,
  SessionHandle,
  StreamEvent,
  Telemetry,
  TestContext,
  Turn,
  TurnHandle,
  Usage,
  ValueAssertion,
} from "../types.ts";

/** t.file(path) 返回它,延迟到 finalize 再读沙箱文件;t.check 识别并解析它。 */
export class FileRef {
  constructor(public readonly path: string) {}
}

/** 运行器在 test 跑完后填进来的「迟到结果」(diff / 脚本),供 finalize 用。 */
export interface LateResult {
  diff: DiffData;
  scripts: Record<string, ScriptResult>;
}

export interface ContextState {
  readonly collector: AssertionCollector;
  readonly manager: SessionManager;
  skipReason?: string;
  readonly late: LateResult;
}

export interface ContextDeps {
  agent: Agent;
  sandbox: Sandbox;
  model?: string;
  flags: Record<string, unknown>;
  signal: AbortSignal;
  log(msg: string): void;
  judge: JudgeConfig | undefined;
  /** tracing agent 的 OTLP 端点(运行器起接收器后注入);经 send ctx 透给 adapter。 */
  telemetry?: Telemetry;
  /** Eval definition directory; used to resolve host-side relative fixture paths. */
  evalBaseDir?: string;
}

export function createEvalContext(deps: ContextDeps): { context: TestContext; state: ContextState } {
  const manager = new SessionManager({
    agent: deps.agent,
    sandbox: deps.sandbox,
    model: deps.model,
    flags: deps.flags,
    signal: deps.signal,
    log: deps.log,
    telemetry: deps.telemetry,
  });
  const collector = new AssertionCollector();
  const state: ContextState = {
    collector,
    manager,
    late: { diff: { generatedFiles: {}, deletedFiles: [] }, scripts: {} },
  };

  async function resolveValue(value: unknown, sc: ScoringContext): Promise<unknown> {
    if (value instanceof FileRef) return (await sc.readFile(value.path)) ?? "";
    return value;
  }

  const diffView: DiffView = {
    get: (path) => state.late.diff.generatedFiles[path],
    isEmpty: () =>
      Object.keys(state.late.diff.generatedFiles).length === 0 &&
      state.late.diff.deletedFiles.length === 0,
    matches: (re) =>
      Object.entries(state.late.diff.generatedFiles).some(([p, c]) => re.test(p) || re.test(c)),
  };

  const sandboxHandle: SandboxHandle = {
    get workdir() {
      return deps.sandbox.workdir;
    },
    get sandboxId() {
      return deps.sandbox.sandboxId;
    },
    get diff() {
      return diffView;
    },
    runCommand: (cmd, args, opts) => deps.sandbox.runCommand(cmd, args, opts),
    runShell: (script, opts) => deps.sandbox.runShell(script, opts),
    readFile: (path) => deps.sandbox.readFile(path),
    fileExists: (path) => deps.sandbox.fileExists(path),
    readSourceFiles: (opts) => deps.sandbox.readSourceFiles(opts),
    writeFiles: (files, targetDir) => deps.sandbox.writeFiles(files, targetDir),
    uploadFiles: (files, targetDir) => deps.sandbox.uploadFiles(files, targetDir),
    uploadDirectory: (localDir, targetDir, opts) =>
      deps.sandbox.uploadDirectory(resolveLocalPath(deps.evalBaseDir, localDir), targetDir, opts),
    downloadFile: (path) => deps.sandbox.downloadFile(path),
    uploadFile: (path, content) => deps.sandbox.uploadFile(path, content),
  };

  function recordScoped(
    spec: Spec,
    getEvents: () => readonly StreamEvent[],
    getStatus: () => "completed" | "failed" | "waiting",
    getUsage: () => Usage,
  ) {
    return collector.record({
      ...spec,
      evaluate: (ctx) => {
        const events = getEvents();
        return spec.evaluate({
          ...ctx,
          events,
          facts: deriveRunFacts(events),
          status: getStatus(),
          usage: getUsage(),
        });
      },
    });
  }

  function makeJudge(session: RunSession) {
    return buildJudge({
      record: (spec) => collector.record(spec),
      judge: deps.judge,
      getOutput: () => conversationText(session.events),
      getInput: () => session.lastInput,
      signal: deps.signal,
    });
  }

  function makeSessionHandle(session: RunSession): SessionHandle {
    const scoped = (spec: Spec) =>
      recordScoped(spec, () => session.events, () => session.lastStatus, () => session.usage);

    const handle: SessionHandle = {
      send: async (text) => makeTurnHandle(await manager.send(session, text), collector, deps),
      sendFile: async (path, text) =>
        makeTurnHandle(await manager.send(session, text ?? "", [await readInputFile(path)]), collector, deps),
      requireInputRequest: (filter) => requireInputRequest(session, filter),
      respond: async (...responses) => {
        if (responses.length === 0) throw new Error("respond() requires at least one response");
        session.pendingInputRequests.length = 0;
        return makeTurnHandle(await manager.send(session, responses.join("\n")), collector, deps);
      },
      respondAll: async (optionId) => {
        if (session.pendingInputRequests.length === 0) {
          throw new Error("respondAll() requires at least one pending input request");
        }
        const responses = session.pendingInputRequests.map(() => optionId);
        session.pendingInputRequests.length = 0;
        return makeTurnHandle(await manager.send(session, responses.join("\n")), collector, deps);
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
      succeeded: () => scoped(Scoped.succeeded()),
      parked: () => scoped(Scoped.parked()),
      messageIncludes: (token) => scoped(Scoped.messageIncludes(token)),
      calledTool: (name, match) => scoped(Scoped.calledTool(name, match)),
      notCalledTool: (name, match) => scoped(Scoped.notCalledTool(name, match)),
      toolOrder: (names) => scoped(Scoped.toolOrder(names)),
      usedNoTools: () => scoped(Scoped.usedNoTools()),
      maxToolCalls: (max) => scoped(Scoped.maxToolCalls(max)),
      loadedSkill: (skill) => scoped(Scoped.loadedSkill(skill)),
      noFailedActions: () => scoped(Scoped.noFailedActions()),
      event: (type, opts) => scoped(Scoped.eventOfType(type, opts)),
      notEvent: (type) => scoped(Scoped.notEventOfType(type)),
      calledSubagent: (name, match) => scoped(Scoped.calledSubagent(name, match)),
      eventOrder: (types) => scoped(Scoped.eventOrder(types)),
      eventsSatisfy: (predicate, label) => scoped(Scoped.eventsSatisfy(predicate, label)),
      maxTokens: (max) => scoped(Scoped.maxTokens(max)),
      maxCost: (usd) => scoped(Scoped.maxCost(usd)),
      get usage() {
        return session.usage;
      },
      get judge() {
        return makeJudge(session);
      },
    };
    return handle;
  }

  const primary = makeSessionHandle(manager.primary);
  // primary.reply/sessionId/events/usage/judge 是 getter,读的是 manager.primary 的实时状态。
  // 不能 `{ ...primary, ... }` 展开——对象展开会在展开的那一刻把每个 getter 求值成静态值,
  // 之后 t.reply 就永远冻结在「还没 send 过」的初始状态(空字符串)。改用
  // Object.getOwnPropertyDescriptors 搬运属性描述符,getter 保持 getter,照常读到最新状态。
  const extra = {
    newSession: () => makeSessionHandle(manager.newSession()),
    signal: deps.signal,
    model: deps.model,
    flags: deps.flags,
    log: deps.log,
    skip: (reason: string) => {
      if (reason.trim().length === 0) throw new Error(t("context.skipEmpty"));
      state.skipReason = reason;
      throw new EvalSkipped(reason);
    },

    check: (value: unknown, assertion: ValueAssertion) =>
      collector.record({
        name: assertion.name,
        severity: assertion.severity,
        threshold: assertion.threshold,
        evaluate: async (sc) => assertion.score(await resolveValue(value, sc)),
      }),
    group: <T,>(title: string, fn: () => Promise<T> | T) => collector.withGroup(title, fn),
    require: async (value: unknown, assertion: ValueAssertion) => {
      const v = value instanceof FileRef ? await deps.sandbox.readFile(value.path).catch(() => "") : value;
      const score = await assertion.score(v);
      const passed = assertion.threshold === undefined ? score > 0 : score >= assertion.threshold;
      collector.record({
        name: assertion.name,
        severity: "gate",
        threshold: assertion.threshold,
        evaluate: () => score,
      });
      if (!passed) throw new EvalRequirementFailed(assertion.name);
      return value;
    },

    sandbox: sandboxHandle,
    file: (path: string) => new FileRef(path) as unknown as string,
    fileChanged: (path: string) => collector.record(Scoped.fileChanged(path)),
    fileDeleted: (path: string) => collector.record(Scoped.fileDeleted(path)),
    notInDiff: (re: RegExp) => collector.record(Scoped.notInDiff(re)),
    noFailedShellCommands: () => collector.record(Scoped.noFailedShellCommands()),
  };
  const context = Object.defineProperties(
    {},
    {
      ...Object.getOwnPropertyDescriptors(primary),
      ...Object.getOwnPropertyDescriptors(extra),
    },
  ) as TestContext;

  return { context, state };
}

/** 读本地文件(相对项目根)成 InputFile:推断 MIME + base64 编码,供 t.sendFile。 */
async function readInputFile(path: string): Promise<InputFile> {
  const buf = await readFile(path);
  return { filename: basename(path), mimeType: mimeTypeFor(path), dataBase64: buf.toString("base64") };
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

function makeTurnHandle(turn: Turn, collector: AssertionCollector, deps: ContextDeps): TurnHandle {
  const message = lastAssistantText(turn.events) ?? "";
  const facts = deriveRunFacts(turn.events);
  const usage = turn.usage ?? { inputTokens: 0, outputTokens: 0 };

  const scoped = (spec: Spec) =>
    collector.record({
      ...spec,
      evaluate: (ctx) =>
        spec.evaluate({
          ...ctx,
          events: turn.events,
          facts,
          status: turn.status,
          usage,
        }),
    });

  const handle: TurnHandle = {
    events: turn.events,
    toolCalls: facts.toolCalls,
    status: turn.status,
    message,
    data: turn.data,
    usage: turn.usage,
    expectOk() {
      if (turn.status === "failed") {
        const lastError = [...turn.events]
          .reverse()
          .find((e): e is Extract<StreamEvent, { type: "error" }> => e.type === "error");
        throw new TurnFailed(
          lastError ? t("context.turnFailed", { message: lastError.message }) : undefined,
        );
      }
      return handle;
    },
    outputEquals: (value) =>
      collector.record({
        name: "outputEquals",
        severity: "gate",
        evaluate: () => (deepEqual(turn.data, value) ? 1 : 0),
      }),
    outputMatches: (schema) =>
      collector.record({
        name: "outputMatches",
        severity: "gate",
        evaluate: () => (validateSchema(turn.data, schema) ? 1 : 0),
      }),
    messageIncludes: (token) => scoped(Scoped.messageIncludes(token)),
    succeeded: () => scoped(Scoped.succeeded()),
    calledTool: (name, match) => scoped(Scoped.calledTool(name, match)),
    notCalledTool: (name, match) => scoped(Scoped.notCalledTool(name, match)),
    toolOrder: (names) => scoped(Scoped.toolOrder(names)),
    usedNoTools: () => scoped(Scoped.usedNoTools()),
    maxToolCalls: (max) => scoped(Scoped.maxToolCalls(max)),
    event: (type, opts) => scoped(Scoped.eventOfType(type, opts)),
    notEvent: (type) => scoped(Scoped.notEventOfType(type)),
    calledSubagent: (name, match) => scoped(Scoped.calledSubagent(name, match)),
    eventOrder: (types) => scoped(Scoped.eventOrder(types)),
    eventsSatisfy: (predicate, label) => scoped(Scoped.eventsSatisfy(predicate, label)),
    judge: buildJudge({
      record: (spec) => collector.record(spec),
      judge: deps.judge,
      getOutput: () => message,
      getInput: () => "",
      signal: deps.signal,
    }),
  };
  return handle;
}

function conversationText(events: readonly StreamEvent[]): string {
  return events
    .filter((e): e is Extract<StreamEvent, { type: "message" }> => e.type === "message")
    .map((e) => `${e.role}: ${e.text}`)
    .join("\n");
}

function requireInputRequest(session: RunSession, filter?: InputRequestFilter): InputRequest {
  const matches = session.pendingInputRequests.filter((request) => inputRequestMatches(request, filter));
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one pending input request, found ${matches.length}`);
  }
  return matches[0] as InputRequest;
}

function inputRequestMatches(request: InputRequest, filter?: InputRequestFilter): boolean {
  if (!filter) return true;
  if (filter.id !== undefined && !stringMatches(request.id ?? "", filter.id)) return false;
  if (filter.prompt !== undefined && !stringMatches(request.prompt ?? "", filter.prompt)) return false;
  if (filter.display !== undefined && !stringMatches(request.display ?? "", filter.display)) return false;
  if (filter.action !== undefined && !stringMatches(request.action ?? "", filter.action)) return false;
  if (filter.optionIds !== undefined) {
    const optionIds = new Set((request.options ?? []).map((o) => o.id));
    if (!filter.optionIds.every((id) => optionIds.has(id))) return false;
  }
  if (filter.input !== undefined && !partialObjectMatches(request.input, filter.input)) return false;
  return true;
}

function stringMatches(actual: string, expected: string | RegExp): boolean {
  return expected instanceof RegExp ? expected.test(actual) : actual === expected;
}

function partialObjectMatches(actual: unknown, expected: Record<string, unknown>): boolean {
  if (actual === null || typeof actual !== "object") return false;
  const obj = actual as Record<string, unknown>;
  for (const [key, value] of Object.entries(expected)) {
    if (!deepEqual(obj[key], value)) return false;
  }
  return true;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ak = Object.keys(a as object);
  const bk = Object.keys(b as object);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  }
  return true;
}

function validateSchema(value: unknown, schema: unknown): boolean {
  try {
    const std = (schema as { ["~standard"]?: { validate(v: unknown): { issues?: unknown } } })["~standard"];
    if (std && typeof std.validate === "function") {
      const r = std.validate(value) as { issues?: unknown };
      return !(r && r.issues);
    }
    const zodLike = schema as { safeParse?(v: unknown): { success: boolean }; parse?(v: unknown): unknown };
    if (typeof zodLike.safeParse === "function") return zodLike.safeParse(value).success;
    if (typeof zodLike.parse === "function") {
      zodLike.parse(value);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}
