// 构造 eval 作者拿到的高层上下文 t。这里把会话驱动(SessionManager)、
// 断言收集(AssertionCollector)、作用域断言、judge 命名空间接到一起。

import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { SessionManager, RunSession, lastAssistantText } from "./session.ts";
import { AssertionCollector, computePassed, unavailable } from "../scoring/collector.ts";
import type { ResolvedCoverage } from "../scoring/coverage.ts";
import { deepEqual, validateSchema } from "../scoring/match.ts";
import type { Spec } from "../scoring/collector.ts";
import * as Scoped from "../scoring/scoped.ts";
import { buildJudge } from "../scoring/judge.ts";
import { EvalSkipped, EvalRequirementFailed, TurnFailed } from "./control-flow.ts";
import { turnErrorText } from "./turn-errors.ts";
import { attachFailureClass, type FailureClass } from "../shared/failure-class.ts";
import type { ConcurrencySlot } from "./send-retry.ts";
import { deriveRunFacts } from "../o11y/derive.ts";
import { diffIsEmpty, diffMatches, emptyDiffData } from "../scoring/diff.ts";
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
  reasoningEffort?: string;
  flags: Record<string, unknown>;
  /** 路径推导出的实验 id(经 send ctx 透给 adapter,见 AgentContext.experimentId)。 */
  experimentId?: string;
  signal: AbortSignal;
  log(msg: string): void;
  judge: JudgeConfig | undefined;
  /** tracing agent 的 OTLP 端点(运行器起接收器后注入);经 send ctx 透给 adapter。 */
  telemetry?: Telemetry;
  /** 非沙箱 tracing agent 的共享 OTLP 通道(逐轮 span 归属,只进瀑布图)。 */
  otel?: import("../o11y/otlp/turn-otel.ts").AgentOtelChannel;
  /** Eval definition directory; used to resolve host-side relative fixture paths. */
  evalBaseDir?: string;
  /** runner 绑定的作用域反馈(t.progress / t.diagnostic 与 adapter ctx 共用实现);
   *  省略时(测试直调)progress 退回 log、diagnostic 静默丢弃。 */
  feedback?: import("../types.ts").ScopedFeedback;
  /** attempt 作用域 ctx.fact() 的落点(runner 传入 attempt 级累加器写入函数);经 send ctx 透给
   *  adapter(AgentContext.fact)。省略时(测试直调)仍校验 key/value,只是无处落盘。 */
  fact?: (key: string, value: string | number | boolean) => void;
  /** adapter send 在飞时的通知(errored 归因到嵌套的 `agent.run` 阶段用);透传给 SessionManager。 */
  onSendActive?: (active: boolean) => void;
  /** 变更分类账的 send 窗口钩子(仅沙箱型);透传给 SessionManager(见 SessionDeps.ledgerHooks)。 */
  ledgerHooks?: import("./session.ts").SessionDeps["ledgerHooks"];
  /** 每轮 send 的墙钟包络回报(runner 挂 turn 时间树节点);透传给 SessionManager。 */
  onTurn?: import("./session.ts").SessionDeps["onTurn"];
  /** turn 级重试退避期间释放/收回的全局并发槽位;透传给 SessionManager。 */
  concurrencySlot?: ConcurrencySlot;
  /** 实验声明的失败分类器(`ExperimentDef.classifyFailure`);透传给 SessionManager。 */
  experimentClassifier?: import("./session.ts").SessionDeps["experimentClassifier"];
  /** 仅供确定性单测注入:透传给 SessionManager 的 turn 重试随机数/睡眠(生产路径省略)。 */
  retryRandom?: import("./session.ts").SessionDeps["retryRandom"];
  retrySleep?: import("./session.ts").SessionDeps["retrySleep"];
  /** 题型(默认通过制);计分制下句柄上的 `.gate()` 是前置中止,见 AssertionCollector 的 scoring。 */
  scoring?: "pass" | "points";
  /** 取当前已提交窗口的 agent diff(计分制前置断言就地求值要用;非沙箱型省略)。 */
  liveDiff?: () => Promise<DiffData>;
}

/**
 * 沙箱能力守卫:非沙箱型 agent(kind !== "sandbox")调文件系统类断言就报清晰错误。
 * 这是唯一仍需要构造证据之外强制检查的能力——`t.sandbox.file`/`t.sandbox.fileChanged()` 等直接读沙箱
 * 文件系统,没有沙箱就没有东西可读,不报错会静默返回空结果。其余能力(多轮对话、
 * 工具断言……)都不再问卷式声明,由「做没做到」的构造证据决定,见
 * docs-site/zh/explanation/adapter.mdx「能力从哪来」一节。
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
    onTurn: deps.onTurn,
    ledgerHooks: deps.ledgerHooks,
    concurrencySlot: deps.concurrencySlot,
    experimentClassifier: deps.experimentClassifier,
    retryRandom: deps.retryRandom,
    retrySleep: deps.retrySleep,
  });
  const late: LateResult = { diff: emptyDiffData(), scripts: {} };

  // 计分制前置断言就地求值时看的实时运行结果。diff 只在 send 之后才会变(agent 只在窗口内动
  // 工作区),所以按 send 计数缓存一次导出,同一批前置不重复跑 git 导出。
  let liveDiffCache: { at: number; diff: Promise<DiffData> } | undefined;
  const liveContext = async (): Promise<ScoringContext> => {
    const events = manager.allEvents;
    let diff = late.diff;
    if (deps.liveDiff) {
      const at = manager.allEvents.length;
      if (liveDiffCache === undefined || liveDiffCache.at !== at) {
        liveDiffCache = { at, diff: deps.liveDiff() };
      }
      diff = await liveDiffCache.diff;
    }
    return {
      events,
      facts: deriveRunFacts(events),
      diff,
      scripts: late.scripts,
      usage: manager.usage,
      status: manager.lastStatus,
      coverage: manager.coverage,
      readFile: async (path) => {
        try {
          return await deps.sandbox.readFile(path);
        } catch {
          return undefined;
        }
      },
    };
  };

  const collector = new AssertionCollector({
    ...(deps.scoring !== undefined ? { scoring: deps.scoring } : {}),
    liveContext,
  });
  const state: ContextState = { collector, manager, late };

  /** 每个 t.* 异步入口先结算待决前置:未过就抛中止信号,后面的代码不再执行。 */
  async function settlePrerequisites(): Promise<void> {
    const aborted = await collector.settlePrerequisites();
    if (aborted !== undefined) throw new EvalRequirementFailed(aborted);
  }

  /** 驱动会话的唯一入口(t.send / sendFile / respond / respondAll 都走它),前置守在这里。 */
  async function send(...args: Parameters<SessionManager["send"]>): Promise<Turn> {
    await settlePrerequisites();
    return manager.send(...args);
  }

  function guardAsync<A extends unknown[], R>(fn: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
    return async (...args: A) => {
      await settlePrerequisites();
      return fn(...args);
    };
  }

  async function resolveValue(value: unknown, sc: ScoringContext): Promise<unknown> {
    if (value instanceof FileRef) return (await sc.readFile(value.path)) ?? "";
    return value;
  }

  /** CommandResult 形状的值(duck-type,不 import sandbox 域):received 按「退出码 + 输出尾部」投影。 */
  function asCommandResult(value: unknown): { stdout: string; stderr: string; exitCode: number; command?: string } | undefined {
    if (!value || typeof value !== "object") return undefined;
    const v = value as { stdout?: unknown; stderr?: unknown; exitCode?: unknown };
    return typeof v.stdout === "string" && typeof v.stderr === "string" && typeof v.exitCode === "number"
      ? (value as { stdout: string; stderr: string; exitCode: number; command?: string })
      : undefined;
  }

  /** 断言失败时给 view 看的「实际被检查了什么」,而不是重复 matcher 自己的名字。
   *  按值的形状落成人可读事实(而不是留一坨 JSON 给渲染层解析):CommandResult 的第一行是
   *  `exit N · "…输出尾部摘要"`(stdout+stderr 合并折单行,信号常收在末尾——pytest / vitest
   *  的 failed 计数都在最后几行;榜单与 --eval 标注这类单行面只保留这一行),随后附原样保留
   *  换行的更长尾部——runner 不另存 eval 侧命令的输出,这条记录就是它唯一的家,attempt 首页
   *  与 result.json 靠它给出「更进一步」;文件引用带 `// path` 头;其余走通用 JSON 预览。 */
  function previewCheckedValue(value: unknown): string {
    const cmd = asCommandResult(value);
    if (cmd) {
      const combined = `${cmd.stdout}\n${cmd.stderr}`.trim();
      const folded = combined.replace(/\s+/g, " ").trim();
      const summary = folded.length > 160 ? `…${folded.slice(-159)}` : folded;
      const headline = summary.length > 0 ? `exit ${cmd.exitCode} · "${summary}"` : `exit ${cmd.exitCode}`;
      if (combined.length <= 160) return headline;
      let tail = combined.slice(-3600);
      if (combined.length > 3600) {
        const firstBreak = tail.indexOf("\n");
        if (firstBreak >= 0) tail = tail.slice(firstBreak + 1); // 不从半行开始
      }
      return `${headline}\noutput tail:\n${tail}`;
    }
    if (value && typeof value === "object" && typeof (value as { path?: unknown }).path === "string") {
      const content = (value as { content?: unknown }).content;
      if (typeof content === "string") return brief(`// ${(value as { path: string }).path}\n${content}`, 4000);
    }
    return brief(value, 4000);
  }

  /** evidence 不区分 pass/fail(与 judge 同口径):被检查值自带命令摘要(CommandResult.command)时就是「命令行本身」。 */
  function checkedValueEvidence(value: unknown): string | undefined {
    const command = asCommandResult(value)?.command;
    return typeof command === "string" && command.length > 0 ? command : undefined;
  }

  // agent 归因 diff 的只读视图:get = 最后触及窗口的终态;matches 扫触及路径与各窗口内容。
  const diffView: DiffView = {
    get: (path) => state.late.diff.get(path),
    isEmpty: () => diffIsEmpty(state.late.diff),
    matches: (re) => diffMatches(state.late.diff, re),
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
    // 沙箱动作都先结算待决前置:前置没过时后面这些活儿一件都不该干(白跑沙箱时间)。
    runCommand: guardAsync((cmd, args, opts) => deps.sandbox.runCommand(cmd, args, opts)),
    runShell: guardAsync((script, opts) => deps.sandbox.runShell(script, opts)),
    readFile: guardAsync((path) => deps.sandbox.readFile(path)),
    fileExists: guardAsync((path) => deps.sandbox.fileExists(path)),
    writeFiles: guardAsync((files, targetDir) => deps.sandbox.writeFiles(files, targetDir)),
    uploadFiles: guardAsync((files, targetDir) => deps.sandbox.uploadFiles(files, targetDir)),
    uploadDirectory: guardAsync((localDir, targetDir, opts) =>
      deps.sandbox.uploadDirectory(resolveLocalPath(deps.evalBaseDir, localDir), targetDir, opts),
    ),
    downloadFile: guardAsync((path) => deps.sandbox.downloadFile(path)),
    uploadFile: guardAsync((path, content) => deps.sandbox.uploadFile(path, content)),
    downloadDirectory: guardAsync((localDir, targetDir, opts) =>
      deps.sandbox.downloadDirectory(resolveLocalPath(deps.evalBaseDir, localDir), targetDir, opts),
    ),
    ...sandboxAssertions,
  };

  function recordScoped(
    spec: Spec,
    getEvents: () => readonly StreamEvent[],
    getStatus: () => "completed" | "failed" | "waiting",
    getUsage: () => Usage,
    getCoverage: () => ResolvedCoverage,
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
          coverage: getCoverage(),
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
    // session 作用域 = 记录断言时快照(见 docs/feature/scoring/architecture/scopes.md):
    // 之后该 session 再发生的轮次不改变这条断言的评估材料;只看最后一轮用 send() 的 TurnHandle。
    const scoped = (spec: Spec) => {
      const events = session.events.slice();
      const status = session.lastStatus;
      const usage = { ...session.usage };
      const coverage = session.coverage;
      return recordScoped(spec, () => events, () => status, () => usage, () => coverage);
    };

    const handle: SessionHandle = {
      send: async (input) => {
        const text = typeof input === "string" ? input : input.text;
        const files = typeof input === "string" ? undefined : input.files;
        const turn = await send(session, text, files);
        return makeTurnHandle(turn, collector, deps, text, manager.resolveTurnCoverage(turn), manager.resolveTurnFailureClass(turn));
      },
      sendFile: async (path, text) => {
        const turn = await send(session, text ?? "", [await readInputFile(path)]);
        return makeTurnHandle(turn, collector, deps, text ?? "", manager.resolveTurnCoverage(turn), manager.resolveTurnFailureClass(turn));
      },
      requireInputRequest: (filter) => requireInputRequest(session, filter),
      respond: async (...answers) => {
        if (answers.length === 0) throw new Error(t("hitl.respondEmpty"));
        const built = buildRespondInput(session, answers);
        session.pendingInputRequests.length = 0;
        const turn = await send(session, built.text, undefined, built.responses);
        return makeTurnHandle(turn, collector, deps, built.text, manager.resolveTurnCoverage(turn), manager.resolveTurnFailureClass(turn));
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
        const turn = await send(session, input, undefined, responses);
        return makeTurnHandle(turn, collector, deps, input, manager.resolveTurnCoverage(turn), manager.resolveTurnFailureClass(turn));
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
      eventsSatisfy: (label, predicate) => scoped(Scoped.eventsSatisfy(label, predicate)),
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

  // t 作用域 = 整个 attempt:全部 session(含 t.newSession() 开的)的全部轮次,finalize 时对
  // 聚合结果求值(见 docs/feature/scoring/architecture/scopes.md)。newSession 的事件进入这里,
  // 但不进入主 session 的即时 t.reply / t.events 读取视图;t.judge 默认材料仍是主 session 对话。
  const aggregateScoped = (spec: Spec) =>
    recordScoped(spec, () => manager.allEvents, () => manager.lastStatus, () => manager.usage, () => manager.coverage);

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
    reasoningEffort: deps.reasoningEffort,
    flags: deps.flags,
    // 作用域反馈:scope 固定为 eval.run(runner 按当前阶段归因,eval 不能冒充其它阶段)。
    progress: (u: import("../types.ts").ProgressUpdate) =>
      deps.feedback
        ? deps.feedback.progress(u)
        : deps.log(u.current !== undefined && u.total !== undefined ? `${u.message} (${u.current}/${u.total})` : u.message),
    diagnostic: (d: import("../types.ts").DiagnosticInput) => deps.feedback?.diagnostic(d),
    log: deps.log,
    skip: (reason: string) => {
      if (reason.trim().length === 0) throw new Error(t("context.skipEmpty"));
      state.skipReason = reason;
      throw new EvalSkipped(reason);
    },

    check: (value: unknown, assertion: ValueAssertion) => {
      // evaluate 读 spec 自己的 severity/threshold(而不是捕获记录时的快照):
      // 句柄的 .gate()/.atLeast() 会事后改写 spec,received 判定必须和 finalize 同一口径。
      const spec: Spec = {
        name: assertion.name,
        severity: assertion.severity,
        threshold: assertion.threshold,
        ...(assertion.isOptional ? { optional: true as const } : {}),
        evaluate: async (sc) => {
          const resolved = await resolveValue(value, sc);
          const score = await assertion.score(resolved);
          const evidence = checkedValueEvidence(resolved);
          if (computePassed(spec.severity, spec.threshold, score)) {
            return evidence !== undefined ? { score, evidence } : score;
          }
          return {
            score,
            expected: assertion.expected,
            received: previewCheckedValue(resolved),
            ...(evidence !== undefined ? { evidence } : {}),
          };
        },
      };
      return collector.record(spec);
    },
    group: async <T,>(title: string, fn: () => Promise<T> | T) => {
      await settlePrerequisites();
      return collector.withGroup(title, fn);
    },
    // 计分制直接给分(仅 ScoreTestContext 类型上暴露;运行时对全部 eval 一视同仁地记录,
    // 不需要按题型守护,见 docs/feature/experiments/score-points.md)。
    score: (label: string, points: number) => collector.score(label, points),
    require: async (value: unknown, assertion: ValueAssertion) => {
      await settlePrerequisites();
      const v = value instanceof FileRef ? await deps.sandbox.readFile(value.path).catch(() => "") : value;
      const score = await assertion.score(v);
      // require 恒为硬门槛(不过即中止 eval),判定口径与 finalize 同一份 computePassed。
      const passed = computePassed("gate", assertion.threshold, score);
      const evidence = checkedValueEvidence(v);
      collector.record({
        name: assertion.name,
        severity: "gate",
        threshold: assertion.threshold,
        prerequisite: true,
        evaluate: () =>
          passed
            ? evidence !== undefined
              ? { score, evidence }
              : score
            : {
                score,
                expected: assertion.expected,
                received: previewCheckedValue(v),
                ...(evidence !== undefined ? { evidence } : {}),
              },
      });
      if (!passed) throw new EvalRequirementFailed(assertion.name);
      return value;
    },

    sandbox: sandboxHandle,

    // 作用域断言(t 级:聚合全部 session)。这些描述符盖过 primary 的同名方法——
    // t.send/t.reply/t.events 仍是主 session 的即时视图,断言聚合与读取视图是两回事。
    succeeded: () => aggregateScoped(Scoped.succeeded()),
    parked: () => aggregateScoped(Scoped.parked()),
    messageIncludes: (token: string | RegExp) => aggregateScoped(Scoped.messageIncludes(token)),
    calledTool: (name: string, match?: import("../types.ts").ToolMatch) => aggregateScoped(Scoped.calledTool(name, match)),
    notCalledTool: (name: string, match?: import("../types.ts").ToolMatch) => aggregateScoped(Scoped.notCalledTool(name, match)),
    toolOrder: (names: string[]) => aggregateScoped(Scoped.toolOrder(names)),
    usedNoTools: () => aggregateScoped(Scoped.usedNoTools()),
    maxToolCalls: (max: number) => aggregateScoped(Scoped.maxToolCalls(max)),
    loadedSkill: (skill: string) => aggregateScoped(Scoped.loadedSkill(skill)),
    noFailedActions: () => aggregateScoped(Scoped.noFailedActions()),
    event: (type: StreamEvent["type"], opts?: { count?: number }) => aggregateScoped(Scoped.eventOfType(type, opts)),
    notEvent: (type: StreamEvent["type"]) => aggregateScoped(Scoped.notEventOfType(type)),
    calledSubagent: (name: string, match?: import("../types.ts").SubagentMatch) =>
      aggregateScoped(Scoped.calledSubagent(name, match)),
    eventOrder: (types: StreamEvent["type"][]) => aggregateScoped(Scoped.eventOrder(types)),
    eventsSatisfy: (label: string, predicate: (events: readonly StreamEvent[]) => boolean) =>
      aggregateScoped(Scoped.eventsSatisfy(label, predicate)),
    maxTokens: (max: number) => aggregateScoped(Scoped.maxTokens(max)),
    maxCost: (usd: number) => aggregateScoped(Scoped.maxCost(usd)),
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

function makeTurnHandle(
  turn: Turn,
  collector: AssertionCollector,
  deps: ContextDeps,
  input: string,
  coverage: ResolvedCoverage,
  failureClass?: FailureClass,
): TurnHandle {
  const message = lastAssistantText(turn.events) ?? "";
  const facts = deriveRunFacts(turn.events);
  // ScoringContext.usage 是必填对象,但字段本身可选(见 src/o11y/types.ts 的 Usage)——
  // 协议没报 usage 时给空对象,不拿 0 冒充「实测就是 0」。
  const usage = turn.usage ?? {};

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
          coverage,
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
        // 与保守兜底分类器、turn 级重试摘要读的同一段文本(见 turn-errors.ts 的 turnErrorText)——
        // 不出现「报错说 A、分类看 B」。
        const message = turnErrorText(turn);
        const error = new TurnFailed(message !== undefined ? t("context.turnFailed", { message }) : undefined);
        // 终局失败的分类随错误浮出:attempt 封口据此落止损闸(见
        // docs/feature/error-classification/architecture.md「止损执行体」)。没有分类
        // (未经重试执行体的手工构造 Turn)时不标记,落缺省 attempt 档。
        throw failureClass ? attachFailureClass(error, failureClass) : error;
      }
      return handle;
    },
    outputEquals: (value) =>
      collector.record({
        name: "outputEquals",
        severity: "gate",
        evaluate: () => {
          if (deepEqual(turn.data, value)) return 1;
          // 正断言:data 通道非 complete 且这一轮根本没给 data,「没采到」不能算成「没输出」。
          if (turn.data === undefined && coverage.data.status !== "complete") {
            const c = coverage.data;
            return unavailable(`coverage:data=${c.status}${c.reason ? ` (${c.reason})` : ""}`);
          }
          return { score: 0, expected: brief(value, 800), received: brief(turn.data, 800) };
        },
      }),
    outputMatches: (schema) =>
      collector.record({
        name: "outputMatches",
        severity: "gate",
        evaluate: async () => {
          if (await validateSchema(turn.data, schema)) return 1;
          if (turn.data === undefined && coverage.data.status !== "complete") {
            const c = coverage.data;
            return unavailable(`coverage:data=${c.status}${c.reason ? ` (${c.reason})` : ""}`);
          }
          return { score: 0, received: brief(turn.data, 800) };
        },
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
    eventsSatisfy: (label, predicate) => scoped(Scoped.eventsSatisfy(label, predicate)),
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
    // 「恰好提供这组选项」:集合完全一致(顺序无关),不是子集包含——写少一个选项不算命中。
    const optionIds = new Set((request.options ?? []).map((o) => o.id));
    if (optionIds.size !== filter.optionIds.length) return false;
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
