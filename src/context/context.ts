// 构造 eval 作者拿到的高层上下文 t。把会话驱动(SessionManager)、断言收集
// (AssertionCollector)、作用域断言、judge 命名空间接到一起,并实现 newSession 的
// 「同沙箱、新会话」语义。t.file 返回一个延迟引用,到 finalize 时才真正读沙箱文件。

import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { SessionManager, RunSession, lastAssistantText } from "./session.ts";
import { AssertionCollector } from "../scoring/collector.ts";
import * as Scoped from "../scoring/scoped.ts";
import { buildJudge } from "../scoring/judge.ts";
import { EvalSkipped, EvalRequirementFailed, TurnFailed } from "./control-flow.ts";
import { deriveRunFacts } from "../o11y/derive.ts";
import type {
  Agent,
  DiffData,
  DiffView,
  InputFile,
  JudgeConfig,
  Sandbox,
  ScoringContext,
  ScriptResult,
  StreamEvent,
  Telemetry,
  TestContext,
  Turn,
  TurnHandle,
} from "../types.ts";

/** t.file(path) 返回它,延迟到 finalize 再读沙箱文件;t.check 识别并解析它。 */
export class FileRef {
  constructor(public readonly path: string) {}
}

/** 运行器在 test 跑完后填进来的「迟到结果」(diff / 脚本),供 t.diff 与 finalize 用。 */
export interface LateResult {
  diff: DiffData;
  scripts: Record<string, ScriptResult>;
}

export interface ContextState {
  readonly collector: AssertionCollector;
  readonly manager: SessionManager;
  readonly requestedScripts: Set<string>;
  needsVitest: boolean;
  skipReason?: string;
  readonly late: LateResult;
}

export interface ContextDeps {
  agent: Agent;
  sandbox: Sandbox;
  model?: string;
  flags: Record<string, unknown>;
  shared: Record<string, unknown>;
  signal: AbortSignal;
  log(msg: string): void;
  judge: JudgeConfig | undefined;
  /** tracing agent 的 OTLP 端点(运行器起接收器后注入);经 send ctx 透给 adapter。 */
  telemetry?: Telemetry;
}

export function createEvalContext(deps: ContextDeps): { context: TestContext; state: ContextState } {
  const manager = new SessionManager({
    agent: deps.agent,
    sandbox: deps.sandbox,
    model: deps.model,
    flags: deps.flags,
    shared: deps.shared,
    signal: deps.signal,
    log: deps.log,
    telemetry: deps.telemetry,
  });
  const collector = new AssertionCollector();
  const state: ContextState = {
    collector,
    manager,
    requestedScripts: new Set(),
    needsVitest: false,
    late: { diff: { generatedFiles: {}, deletedFiles: [] }, scripts: {} },
  };

  const compactionsObservable = deps.agent.capabilities.compactionObservability === true;

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

  function makeContext(session: RunSession): TestContext {
    const judge = buildJudge({
      collector,
      judge: deps.judge,
      getReply: () => session.lastMessage,
      signal: deps.signal,
    });

    const ctx: TestContext = {
      send: async (text) => makeTurnHandle(await manager.send(session, text), collector),
      sendFile: async (path, text) =>
        makeTurnHandle(await manager.send(session, text ?? "", [await readInputFile(path)]), collector),
      get reply() {
        return session.lastMessage;
      },
      newSession: () => makeContext(manager.newSession()),

      signal: deps.signal,
      model: deps.model,
      flags: deps.flags,
      shared: deps.shared,
      log: deps.log,
      skip: (reason) => {
        if (reason.trim().length === 0) throw new Error("skip() 需要一个非空理由。");
        state.skipReason = reason;
        throw new EvalSkipped(reason);
      },

      check: (value, assertion) =>
        collector.record({
          name: assertion.name,
          severity: assertion.severity,
          threshold: assertion.threshold,
          evaluate: async (sc) => assertion.score(await resolveValue(value, sc)),
        }),
      group: (title, fn) => collector.withGroup(title, fn),
      require: async (value, assertion) => {
        const v = value instanceof FileRef ? await deps.sandbox.readFile(value.path).catch(() => "") : value;
        const score = await assertion.score(v);
        const passed = score >= (assertion.threshold ?? 1);
        collector.record({
          name: assertion.name,
          severity: "gate",
          threshold: assertion.threshold,
          evaluate: () => score,
        });
        if (!passed) throw new EvalRequirementFailed(assertion.name);
        return value;
      },

      succeeded: () => collector.record(Scoped.succeeded()),
      parked: () => collector.record(Scoped.parked()),
      messageIncludes: (token) => collector.record(Scoped.messageIncludes(token)),
      calledTool: (name, match) => collector.record(Scoped.calledTool(name, match)),
      notCalledTool: (name, match) => collector.record(Scoped.notCalledTool(name, match)),
      toolOrder: (names) => collector.record(Scoped.toolOrder(names)),
      usedNoTools: () => collector.record(Scoped.usedNoTools()),
      maxToolCalls: (max) => collector.record(Scoped.maxToolCalls(max)),
      loadedSkill: (skill) => collector.record(Scoped.loadedSkill(skill)),
      noFailedActions: () => collector.record(Scoped.noFailedActions()),
      event: (type, opts) => collector.record(Scoped.eventOfType(type, opts)),
      notEvent: (type) => collector.record(Scoped.notEventOfType(type)),

      sandbox: deps.sandbox,
      diff: diffView,
      transcript: {
        compactions: () =>
          compactionsObservable ? deriveRunFacts(manager.allEvents).compactions : undefined,
        events: () => manager.allEvents.slice(),
      },
      file: (path) => new FileRef(path) as unknown as string,
      fileChanged: (path) => collector.record(Scoped.fileChanged(path)),
      fileDeleted: (path) => collector.record(Scoped.fileDeleted(path)),
      notInDiff: (re) => collector.record(Scoped.notInDiff(re)),
      testsPassed: () => {
        state.needsVitest = true;
        return collector.record(Scoped.testsPassed());
      },
      scriptPassed: (script) => {
        state.requestedScripts.add(script);
        return collector.record(Scoped.scriptPassed(script));
      },
      noFailedShellCommands: () => collector.record(Scoped.noFailedShellCommands()),

      get usage() {
        return manager.usage;
      },
      maxTokens: (max) => collector.record(Scoped.maxTokens(max)),
      maxCost: (usd) => collector.record(Scoped.maxCost(usd)),

      judge,
    };
    return ctx;
  }

  return { context: makeContext(manager.primary), state };
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

function makeTurnHandle(turn: Turn, collector: AssertionCollector): TurnHandle {
  const message = lastAssistantText(turn.events) ?? "";
  const handle: TurnHandle = {
    events: turn.events,
    status: turn.status,
    message,
    data: turn.data,
    usage: turn.usage,
    expectOk() {
      if (turn.status === "failed") {
        // 把 adapter 在事件流里留下的诊断(provider 超时 / stream 断 / 退出码…)带进 TurnFailed,
        // 否则 EvalResult.error 只剩泛泛的「本轮 send 返回 failed」,看不出到底是谁、为什么挂。
        const lastError = [...turn.events]
          .reverse()
          .find((e): e is Extract<StreamEvent, { type: "error" }> => e.type === "error");
        throw new TurnFailed(
          lastError ? `本轮 send 返回 failed(turn status = failed):${lastError.message}` : undefined,
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
  };
  return handle;
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
