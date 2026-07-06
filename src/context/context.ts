// 构造 eval 作者拿到的高层上下文 t。这里把会话驱动(SessionManager)、
// 断言收集(AssertionCollector)、作用域断言、judge 命名空间接到一起。

import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { SessionManager, RunSession, lastAssistantText } from "./session.ts";
import { AssertionCollector, computePassed } from "../scoring/collector.ts";
import { deepEqual, validateSchema } from "../scoring/match.ts";
import type { Spec } from "../scoring/collector.ts";
import * as Scoped from "../scoring/scoped.ts";
import { buildJudge } from "../scoring/judge.ts";
import { EvalSkipped, EvalRequirementFailed, TurnFailed } from "./control-flow.ts";
import { deriveRunFacts } from "../o11y/derive.ts";
import { t } from "../i18n/index.ts";
import { resolveLocalPath } from "../sandbox/paths.ts";
import { brief } from "../util.ts";
import type {
  Agent,
  DiffData,
  DiffView,
  InputFile,
  InputRequest,
  InputRequestFilter,
  InputResponse,
  JudgeConfig,
  RespondAnswer,
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

/** t.sandbox.file(path) 返回它,延迟到 finalize 再读沙箱文件;t.check 识别并解析它。 */
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
  /** 非沙箱 tracing agent 的共享 OTLP 通道(逐轮 span 归属,只进瀑布图)。 */
  otel?: import("../o11y/otlp/turn-otel.ts").AgentOtelChannel;
  /** Eval definition directory; used to resolve host-side relative fixture paths. */
  evalBaseDir?: string;
}

/**
 * 沙箱能力守卫:非沙箱型 agent(kind !== "sandbox")调文件系统类断言就报清晰错误。
 * 这是唯一仍需要构造证据之外强制检查的能力——`t.sandbox.file`/`t.sandbox.fileChanged()` 等直接读沙箱
 * 文件系统,没有沙箱就没有东西可读,不报错会静默返回空结果。其余能力(多轮对话、
 * 工具断言……)都不再问卷式声明,由「做没做到」的构造证据决定,见
 * docs-site/zh/concepts/adapter.mdx「能力从哪来」一节。
 */
function capabilityGuard(agentName: string, cap: string, method: string): () => never {
  return () => {
    throw new Error(t("context.capabilityMissing", { agent: agentName, cap, method }));
  };
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
    otel: deps.otel,
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

  /** 断言失败时给 view 看的「实际被检查了什么」,而不是重复 matcher 自己的名字。 */
  function previewCheckedValue(value: unknown): string {
    if (value && typeof value === "object" && typeof (value as { path?: unknown }).path === "string") {
      const content = (value as { content?: unknown }).content;
      if (typeof content === "string") return brief(`// ${(value as { path: string }).path}\n${content}`, 4000);
    }
    return brief(value, 4000);
  }

  const diffView: DiffView = {
    get: (path) => state.late.diff.generatedFiles[path],
    isEmpty: () =>
      Object.keys(state.late.diff.generatedFiles).length === 0 &&
      state.late.diff.deletedFiles.length === 0,
    matches: (re) =>
      Object.entries(state.late.diff.generatedFiles).some(([p, c]) => re.test(p) || re.test(c)),
  };

  const sandboxAssertions = {
    file: (path: string) => new FileRef(path) as unknown as string,
    fileChanged: (path: string) => collector.record(Scoped.fileChanged(path)),
    fileDeleted: (path: string) => collector.record(Scoped.fileDeleted(path)),
    notInDiff: (re: RegExp) => collector.record(Scoped.notInDiff(re)),
    noFailedShellCommands: () => collector.record(Scoped.noFailedShellCommands()),
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
    ...sandboxAssertions,
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
      send: async (text) => makeTurnHandle(await manager.send(session, text), collector, deps, text),
      sendFile: async (path, text) =>
        makeTurnHandle(await manager.send(session, text ?? "", [await readInputFile(path)]), collector, deps, text ?? ""),
      requireInputRequest: (filter) => requireInputRequest(session, filter),
      respond: async (...answers) => {
        if (answers.length === 0) throw new Error(t("hitl.respondEmpty"));
        const built = buildRespondInput(session, answers);
        session.pendingInputRequests.length = 0;
        return makeTurnHandle(
          await manager.send(session, built.text, undefined, built.responses),
          collector,
          deps,
          built.text,
        );
      },
      respondAll: async (optionId) => {
        if (session.pendingInputRequests.length === 0) {
          throw new Error(t("hitl.respondAllEmpty"));
        }
        const requests = session.pendingInputRequests.slice();
        for (const request of requests) validateOptionId(request, optionId);
        const responses: InputResponse[] = requests.map((request) => ({
          requestId: requireRequestId(request),
          optionId,
        }));
        session.pendingInputRequests.length = 0;
        const input = requests.map(() => optionId).join("\n");
        return makeTurnHandle(await manager.send(session, input, undefined, responses), collector, deps, input);
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

  // 沙箱能力守卫:非沙箱型 agent(kind !== "sandbox")把文件系统类动作替换成「一调用就报清晰错误」。
  // 其余能力(多轮对话、工具断言……)不再问卷式声明——没接 ctx.session 续接存取器的 agent
  // 每轮各是新对话,没吐 action.* 事件的 agent 上正断言自然不命中,负断言按事件完整性证明
  // 提示可信度,都不需要在这里拦。
  const guards: Record<string, unknown> = {};
  if (deps.agent.kind !== "sandbox") {
    Object.defineProperty(guards, "sandbox", {
      get: capabilityGuard(deps.agent.name, "sandbox", "sandbox"),
      enumerable: true,
    });
  }

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

    check: (value: unknown, assertion: ValueAssertion) => {
      // evaluate 读 spec 自己的 severity/threshold(而不是捕获记录时的快照):
      // 句柄的 .gate()/.atLeast() 会事后改写 spec,evidence 判定必须和 finalize 同一口径。
      const spec: Spec = {
        name: assertion.name,
        severity: assertion.severity,
        threshold: assertion.threshold,
        evaluate: async (sc) => {
          const resolved = await resolveValue(value, sc);
          const score = await assertion.score(resolved);
          if (computePassed(spec.severity, spec.threshold, score)) return score;
          return { score, evidence: previewCheckedValue(resolved) };
        },
      };
      return collector.record(spec);
    },
    group: <T,>(title: string, fn: () => Promise<T> | T) => collector.withGroup(title, fn),
    require: async (value: unknown, assertion: ValueAssertion) => {
      const v = value instanceof FileRef ? await deps.sandbox.readFile(value.path).catch(() => "") : value;
      const score = await assertion.score(v);
      // require 恒为硬门槛(不过即中止 eval),判定口径与 finalize 同一份 computePassed。
      const passed = computePassed("gate", assertion.threshold, score);
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
  };
  const context = Object.defineProperties(
    {},
    {
      ...Object.getOwnPropertyDescriptors(primary),
      ...Object.getOwnPropertyDescriptors(extra),
      // 守卫最后盖上:缺能力的动作被替换成报错闭包。
      ...Object.getOwnPropertyDescriptors(guards),
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

function makeTurnHandle(turn: Turn, collector: AssertionCollector, deps: ContextDeps, input: string): TurnHandle {
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
        evaluate: async () => ((await validateSchema(turn.data, schema)) ? 1 : 0),
      }),
    messageIncludes: (token) => scoped(Scoped.messageIncludes(token)),
    succeeded: () => scoped(Scoped.succeeded()),
    parked: () => scoped(Scoped.parked()),
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
    judge: buildJudge({
      record: (spec) => collector.record(spec),
      judge: deps.judge,
      getOutput: () => message,
      getInput: () => input,
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

/** InputRequest.id 是 InputResponse.requestId 的唯一来源;adapter 没给稳定 id 就没法对位。 */
function requireRequestId(request: InputRequest): string {
  if (!request.id) throw new Error(t("hitl.requestMissingId"));
  return request.id;
}

/** optionId 必须命中 request.options 里的某个 id,写错直接抛,不会静默传给应用。 */
function validateOptionId(request: InputRequest, optionId: string): void {
  const optionIds = (request.options ?? []).map((o) => o.id);
  if (!optionIds.includes(optionId)) {
    throw new Error(
      t("hitl.invalidOption", {
        optionId,
        requestId: request.id ?? "?",
        options: optionIds.length > 0 ? optionIds.join(" / ") : t("hitl.noOptions"),
      }),
    );
  }
}

/**
 * t.respond(...) 的每个参数翻成一条 InputResponse + 拼进 input.text 的那一小段文本。
 * 字符串形式只在恰好一条待处理请求时才能自动对位——命中该请求 options 里的某个 id 就是
 * optionId,否则整句落自由文本;多个请求并停时字符串形式无法消歧,直接抛错,要求改用
 * `{ request, optionId }` / `{ request, text }` 对象形式显式指名。
 */
function buildRespondInput(
  session: RunSession,
  answers: readonly (string | RespondAnswer)[],
): { text: string; responses: InputResponse[] } {
  const pieces: string[] = [];
  const responses: InputResponse[] = [];
  for (const answer of answers) {
    if (typeof answer === "string") {
      const resolved = resolveStringAnswer(session, answer);
      pieces.push(answer);
      responses.push(resolved);
    } else {
      const requestId = requireRequestId(answer.request);
      if (answer.optionId !== undefined) {
        validateOptionId(answer.request, answer.optionId);
        pieces.push(answer.optionId);
        responses.push({ requestId, optionId: answer.optionId });
      } else if (answer.text !== undefined) {
        pieces.push(answer.text);
        responses.push({ requestId, text: answer.text });
      } else {
        throw new Error(t("hitl.answerNeedsOptionOrText"));
      }
    }
  }
  return { text: pieces.join("\n"), responses };
}

function resolveStringAnswer(session: RunSession, raw: string): InputResponse {
  const pending = session.pendingInputRequests;
  if (pending.length === 0) throw new Error(t("hitl.respondAllEmpty"));
  if (pending.length > 1) throw new Error(t("hitl.stringAmbiguous", { count: pending.length }));
  const request = pending[0] as InputRequest;
  const requestId = requireRequestId(request);
  const optionIds = new Set((request.options ?? []).map((o) => o.id));
  return optionIds.has(raw) ? { requestId, optionId: raw } : { requestId, text: raw };
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
