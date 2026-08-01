// 构造 eval 作者拿到的高层上下文 t。这里把会话驱动(SessionManager)、
// 断言收集(AssertionCollector)、作用域断言、judge 命名空间接到一起。

import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { SessionManager, RunSession, lastAssistantText } from "./session.ts";
import { AssertionCollector, computePassed, unavailable } from "../scoring/collector.ts";
import type { ResolvedEvidenceCoverage } from "../scoring/coverage.ts";
import { deepEqual, validateSchema } from "../scoring/match.ts";
import type { Spec } from "../scoring/collector.ts";
import * as Scoped from "../scoring/scoped.ts";
import { buildJudge } from "../scoring/judge.ts";
import { EvalSkipped, EvalRequirementFailed } from "./control-flow.ts";
import type { ConcurrencySlot } from "./send-retry.ts";
import { buildO11ySummary, deriveRunFacts } from "../o11y/derive.ts";
import { describeElided, diffIsEmpty, diffMatches, elidedContentAt, elidedContentPaths, emptyDiffData } from "../scoring/diff.ts";
import { t } from "../i18n/index.ts";
import { resolveEvalLocalPath } from "../sandbox/paths.ts";
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
  EvalSandbox,
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
  scripts: globalThis.Record<string, ScriptResult>;
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
  /** 当前 Attempt 的 Eval 身份；经 SessionManager 逐轮透给 AgentContext。 */
  evalId?: string;
  /** 当前 Attempt 引用；经 SessionManager 逐轮透给 AgentContext。 */
  attempt?: import("../types.ts").AgentContext["attempt"];
  model?: string;
  reasoningEffort?: string;
  flags: globalThis.Record<string, unknown>;
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
  /** 题型(默认通过制);只改变计分 API 与未链句柄的角色，不改变 gate / stopOnFailure 语义。 */
  scoring?: "pass" | "points";
  /** 取当前已提交窗口的 agent diff(stopOnFailure 断言就地求值要用;非沙箱型省略)。 */
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

/**
 * CommandResult 摘录(`received` 首行引号内那段)的字符预算。取这个数是为了让摘录整段活着走完
 * 终端摘要行:human 面的 `received: exit <code> · "…<摘录>"` 有 100 字符预算且从**头**收口
 * (scoring/display.ts),摘录比预算长时被砍掉的正是尾部——也就是 runner 的失败计数。宁可窗口
 * 小一点,也不能让唯一的新事实死在收口里;更长的原始尾部随后由 `output tail:` 段承载。
 */
const COMMAND_SUMMARY_MAX_CHARS = 76;

export function createEvalContext(deps: ContextDeps): { context: TestContext; state: ContextState } {
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
    onTurn: deps.onTurn,
    ledgerHooks: deps.ledgerHooks,
    concurrencySlot: deps.concurrencySlot,
    experimentClassifier: deps.experimentClassifier,
    retryRandom: deps.retryRandom,
    retrySleep: deps.retrySleep,
  });
  const late: LateResult = { diff: emptyDiffData(), scripts: {} };

  // stopOnFailure 断言就地求值时看的实时运行结果。diff 只在 send 之后才会变(agent 只在窗口内动
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

  const collector = new AssertionCollector({
    ...(deps.scoring !== undefined ? { scoring: deps.scoring } : {}),
    liveContext,
  });
  const state: ContextState = { collector, manager, late };

  /** 每个 t.* 异步入口先结算未 await 的 stopOnFailure：failed 就抛中止信号。 */
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

  /**
   * 两条流合并成一份「命令输出」,stderr 在前、stdout 在后:摘录取合并结果的末尾
   * (docs/feature/assertions/library/display.md「命令结果」),而末尾必须落在被测命令自己的
   * 结论上。包装器(uv / npm / pip 的装包与进度)按惯例流到 stderr 且发生在 runner 跑起来之前,
   * runner 的 `N failed, M passed` 收在 stdout 末尾;stdout 排在后面,合并的末尾才是结论,不是
   * 装包噪声(回归见 memory/commandsucceeded-received-excerpt-not-tail.md)。只有一条流有内容时
   * 顺序不产生差别(编译器 / 崩溃栈这类只写 stderr 的命令照样取到它的末尾)。
   */
  function mergeCommandOutput(stdout: string, stderr: string): string {
    return [stderr, stdout]
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .join("\n");
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
   *  `exit N · "…输出尾部摘要"`(stdout/stderr 合并折单行取末尾,信号常收在末尾——pytest /
   *  vitest 的 failed 计数都在最后几行;默认报告与 --eval 标注这类单行面只保留这一行),随后附
   *  原样保留换行的更长尾部——runner 不另存 eval 侧命令的输出,这条记录就是它唯一的家,attempt
   *  首页与 result.json 靠它给出「更进一步」;文件引用带 `// path` 头;其余走通用 JSON 预览。 */
  function previewCheckedValue(value: unknown): string {
    const cmd = asCommandResult(value);
    if (cmd) {
      const combined = mergeCommandOutput(cmd.stdout, cmd.stderr);
      const folded = combined.replace(/\s+/g, " ").trim();
      const summary =
        folded.length > COMMAND_SUMMARY_MAX_CHARS ? `…${folded.slice(-(COMMAND_SUMMARY_MAX_CHARS - 1))}` : folded;
      const headline = summary.length > 0 ? `exit ${cmd.exitCode} · "${summary}"` : `exit ${cmd.exitCode}`;
      if (folded.length <= COMMAND_SUMMARY_MAX_CHARS) return headline; // 首行已含全部输出
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

  /** 值断言的唯一记录路径；check 与 require 共享它，保证记录形状和判定证据逐字段同义。 */
  function recordValueAssertion(value: unknown, assertion: ValueAssertion) {
    // evaluate 读 spec 自己的 severity/threshold(而不是捕获记录时的快照)：句柄后链的
    // .gate()/.atLeast() 必须同时改变即时 stopOnFailure 与最终 finalize 的判定口径。
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
  }

  // agent 归因 diff 的只读视图:get = 最后触及窗口的终态;matches 扫触及路径与各窗口内容。
  // 内容被省略的条目(二进制、单文件超限文本)在读的那一刻如实报证据不可用:内容读取抛出
  // 可行动错误,而不是回落成 undefined / false 让内容断言静默判过或判败
  // (docs/feature/sandbox/architecture.md「导出往返是常数次」)。存在性与 status 断言
  // (fileChanged / fileDeleted / files 摘要)不受影响,照常成立。
  const diffView: DiffView = {
    get: (path) => {
      const elided = elidedContentAt(state.late.diff, path);
      if (elided) {
        throw new Error(
          `t.sandbox.diff.get(${JSON.stringify(path)}): agent diff content is unavailable — ${describeElided(elided)}. ` +
            `Content is elided from the diff export for binary files and for text over 1 MiB per file. ` +
            `Assert on the change itself (t.sandbox.fileChanged / fileDeleted), or read the final file with t.sandbox.readText.`,
        );
      }
      return state.late.diff.get(path);
    },
    isEmpty: () => diffIsEmpty(state.late.diff),
    matches: (re) => {
      if (diffMatches(state.late.diff, re)) return true;
      const elided = elidedContentPaths(state.late.diff);
      if (elided.length > 0) {
        throw new Error(
          `t.sandbox.diff.matches(${re}): no match found, but ${elided.length} changed path${elided.length === 1 ? "" : "s"} ` +
            `${elided.length === 1 ? "has" : "have"} no inline content (${elided.slice(0, 3).join(", ")}${elided.length > 3 ? ", …" : ""}), ` +
            `so "not present" cannot be established. Narrow the regex to paths, or read the final files with t.sandbox.readText.`,
        );
      }
      return false;
    },
  };

  const sandboxAssertions = {
    file: (path: string) => new FileRef(path) as unknown as string,
    fileChanged: (path: string) => collector.record(Scoped.fileChanged(path)),
    fileDeleted: (path: string) => collector.record(Scoped.fileDeleted(path)),
    notInDiff: (re: RegExp) => collector.record(Scoped.notInDiff(re)),
    noFailedShellCommands: () => collector.record(Scoped.noFailedShellCommands()),
  };

  const sandboxHandle: EvalSandbox = {
    get workdir() {
      return deps.sandbox.workdir;
    },
    get diff() {
      return diffView;
    },
    // 沙箱动作都先结算待决 stopOnFailure：上一条没过时后面这些活儿一件都不该干。
    runCommand: guardAsync((cmd, args, opts) => deps.sandbox.runCommand(cmd, args, opts)),
    runShell: guardAsync((script, opts) => deps.sandbox.runShell(script, opts)),
    runCommandOrThrow: guardAsync((cmd, args, opts) => deps.sandbox.runCommandOrThrow(cmd, args, opts)),
    runShellOrThrow: guardAsync((script, opts) => deps.sandbox.runShellOrThrow(script, opts)),
    readText: guardAsync((path) => deps.sandbox.readText(path)),
    writeText: guardAsync((path, content) => deps.sandbox.writeText(path, content)),
    readBytes: guardAsync((path) => deps.sandbox.readBytes(path)),
    writeBytes: guardAsync((path, content) => deps.sandbox.writeBytes(path, content)),
    pathExists: guardAsync((path) => deps.sandbox.pathExists(path)),
    uploadFile: guardAsync((source, targetPath) =>
      deps.sandbox.uploadFile(resolveEvalLocalPath(deps.evalBaseDir, source), targetPath),
    ),
    uploadDirectory: guardAsync((sourceDir, targetDir, opts) =>
      deps.sandbox.uploadDirectory(resolveEvalLocalPath(deps.evalBaseDir, sourceDir), targetDir, opts),
    ),
    downloadFile: guardAsync((sourcePath, target) =>
      deps.sandbox.downloadFile(sourcePath, resolveEvalLocalPath(deps.evalBaseDir, target)),
    ),
    downloadDirectory: guardAsync((sourceDir, targetDir, opts) =>
      deps.sandbox.downloadDirectory(sourceDir, resolveEvalLocalPath(deps.evalBaseDir, targetDir), opts),
    ),
    ...sandboxAssertions,
  };

  function recordScoped(
    spec: Spec,
    getEvents: () => readonly StreamEvent[],
    getStatus: () => "completed" | "failed" | "waiting",
    getUsage: () => Usage,
    getEvidenceCoverage: () => ResolvedEvidenceCoverage,
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
          evidenceCoverage: getEvidenceCoverage(),
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
    // session 作用域 = 记录断言时快照(见 docs/feature/assertions/architecture/scopes.md):
    // 之后该 session 再发生的轮次不改变这条断言的评估材料;只看最后一轮用 send() 的 TurnHandle。
    const scoped = (spec: Spec) => {
      const events = session.events.slice();
      const status = session.lastStatus;
      const usage = { ...session.usage };
      const evidenceCoverage = session.evidenceCoverage;
      return recordScoped(spec, () => events, () => status, () => usage, () => evidenceCoverage);
    };

    const handle: SessionHandle = {
      send: async (input) => {
        const text = typeof input === "string" ? input : input.text;
        const files = typeof input === "string" ? undefined : input.files;
        const turn = await send(session, text, files);
        return makeTurnHandle(turn, collector, deps, text, manager.resolveTurnEvidenceCoverage(turn));
      },
      sendFile: async (path, text) => {
        const turn = await send(session, text ?? "", [await readInputFile(path)]);
        return makeTurnHandle(turn, collector, deps, text ?? "", manager.resolveTurnEvidenceCoverage(turn));
      },
      requireInputRequest: (filter) => requireInputRequest(session, filter),
      respond: async (...answers) => {
        if (answers.length === 0) throw new Error(t("hitl.respondEmpty"));
        const built = buildRespondInput(session, answers);
        session.pendingInputRequests.length = 0;
        const turn = await send(session, built.text, undefined, built.responses);
        return makeTurnHandle(turn, collector, deps, built.text, manager.resolveTurnEvidenceCoverage(turn));
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
        return makeTurnHandle(turn, collector, deps, input, manager.resolveTurnEvidenceCoverage(turn));
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
  // 聚合结果求值(见 docs/feature/assertions/architecture/scopes.md)。newSession 的事件进入这里,
  // 但不进入主 session 的即时 t.reply / t.events 读取视图;t.judge 默认材料仍是主 session 对话。
  const aggregateScoped = (spec: Spec) =>
    recordScoped(
      spec,
      () => manager.allEvents,
      () => manager.lastStatus,
      () => manager.usage,
      () => manager.evidenceCoverage,
    );

  // 沙箱能力守卫:非沙箱型 agent(kind !== "sandbox")把文件系统类动作替换成「一调用就报清晰错误」。
  // 其余能力(多轮对话、工具断言……)不再问卷式声明——没接 ctx.session 续接存取器的 agent
  // 每轮各是新对话,没吐 action.* 事件的 agent 上正断言自然不命中,负断言按事件完整性证明
  // 提示可信度,都不需要在这里拦。
  const guards: globalThis.Record<string, unknown> = {};
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

    check: (value: unknown, assertion: ValueAssertion) => recordValueAssertion(value, assertion),
    group: async <T,>(title: string, fn: () => Promise<T> | T) => {
      await settlePrerequisites();
      return collector.withGroup(title, fn);
    },
    // 计分制直接给分(仅 ScoreTestContext 类型上暴露;运行时对全部 eval 一视同仁地记录,
    // 不需要按题型守护,见 docs/feature/experiments/score-points.md)。
    score: (label: string, points: number) => collector.score(label, points),
    require: async <T,>(value: T, assertion: ValueAssertion): Promise<T> => {
      await settlePrerequisites();
      // 与文档等式保持同一条实现路径：t.require(value, assertion) =
      // await t.check(value, assertion).gate().stopOnFailure()，成功后再透传原 value。
      await recordValueAssertion(value, assertion).gate().stopOnFailure();
      return value;
    },

    sandbox: sandboxHandle,

    // 宿主侧行为摘要:每次读取现算,拿到的是截至最近一次已返回 send() 的行为(见
    // docs/observability.md「宿主侧行为断言:t.o11y」)。落盘 o11y.json 与它共用
    // buildO11ySummary,同一事实不落第二份权威;沙箱内一个框架文件都不写。
    get o11y() {
      return buildO11ySummary(manager.allEvents);
    },

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
  evidenceCoverage: ResolvedEvidenceCoverage,
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
          evidenceCoverage,
        }),
    });

  const handle: TurnHandle = {
    events: turn.events,
    toolCalls: facts.toolCalls,
    status: turn.status,
    message,
    data: turn.data,
    usage: turn.usage,
    outputEquals: (value) =>
      collector.record({
        name: "outputEquals",
        severity: "gate",
        evaluate: () => {
          if (deepEqual(turn.data, value)) return 1;
          // 正断言:data 通道非 complete 且这一轮根本没给 data,「没采到」不能算成「没输出」。
          if (turn.data === undefined && evidenceCoverage.data.status !== "complete") {
            const c = evidenceCoverage.data;
            return unavailable(`evidence-coverage:data=${c.status}${c.reason ? ` (${c.reason})` : ""}`);
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
          if (turn.data === undefined && evidenceCoverage.data.status !== "complete") {
            const c = evidenceCoverage.data;
            return unavailable(`evidence-coverage:data=${c.status}${c.reason ? ` (${c.reason})` : ""}`);
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

function partialObjectMatches(actual: unknown, expected: globalThis.Record<string, unknown>): boolean {
  if (actual === null || typeof actual !== "object") return false;
  const obj = actual as globalThis.Record<string, unknown>;
  for (const [key, value] of Object.entries(expected)) {
    if (!deepEqual(obj[key], value)) return false;
  }
  return true;
}
