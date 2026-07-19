// context 域类型:eval 作者拿到的 `t`(TestContext)及其子句柄(turn / session / sandbox 视图)。
// `t` 的形状按 Agent 能力组装(见 docs/architecture.md「能力决定形状」)。

import type { InputRequest, StreamEvent, ToolCall, Usage } from "../o11y/types.ts";
import type { DiagnosticInput, ProgressUpdate } from "../shared/types.ts";
import type { AssertionHandle, ValueAssertion } from "../scoring/types.ts";
import type {
  CommandOptions,
  CommandResult,
  ReadSourceFilesOptions,
  SandboxFile,
  SourceFiles,
} from "../sandbox/types.ts";

/** `t.send()` / `session.send()` 的入参:字符串,或带附件的结构化消息。 */
export type SendInput = string | { text: string; files?: readonly import("../agents/types.ts").InputFile[] };

/** t.send() 返回的句柄:从事件流派生便利字段 + expectOk。 */
export interface TurnHandle {
  /** 本轮的原始事件流(工具调用、消息增量等);下面的派生字段都算自它。 */
  readonly events: StreamEvent[];
  /** 本轮内被调用的工具列表,从 events 派生。 */
  readonly toolCalls: readonly ToolCall[];
  /** 本轮结束状态:"completed" 正常结束、"failed" 出错、"waiting" 卡在 HITL 输入请求上。 */
  readonly status: "completed" | "failed" | "waiting";
  /** 本轮助手最终文本回复(events 里的消息增量拼接结果)。 */
  readonly message: string;
  /** adapter 附带的结构化输出(如有),供 outputEquals / outputMatches 比对。 */
  readonly data?: unknown;
  /** 本轮 token 用量与估算成本(仅上报了 usage 的 agent 才有)。 */
  readonly usage?: Usage;
  /** 上一轮若 failed 则抛(中止后续)。 */
  expectOk(): TurnHandle;
  /** 断言 data 与给定值深度相等。 */
  outputEquals(value: unknown): AssertionHandle;
  /** 断言 data 满足给定 schema(如 zod schema)。 */
  outputMatches(schema: unknown): AssertionHandle;
  /** 断言本轮助手回复包含 token(仅限本轮事件流,不跨轮)。 */
  messageIncludes(token: string | RegExp): AssertionHandle;
  /** 断言本轮 status 为 "completed"。 */
  succeeded(): AssertionHandle;
  /** 断言本轮卡在 HITL 输入请求上(status 为 "waiting")。 */
  parked(): AssertionHandle;
  /** 断言本轮调用过指定名字的工具;`match` 可进一步约束入参 / 次数 / 状态。 */
  calledTool(name: string, match?: ToolMatch): AssertionHandle;
  /** 断言本轮未调用指定工具(或未按 match 条件调用)。 */
  notCalledTool(name: string, match?: ToolMatch): AssertionHandle;
  /** 断言本轮工具调用按给定顺序出现(允许中间夹杂其它调用)。 */
  toolOrder(names: string[]): AssertionHandle;
  /** 断言本轮未调用任何工具。 */
  usedNoTools(): AssertionHandle;
  /** 断言本轮工具调用总数不超过 max。 */
  maxToolCalls(max: number): AssertionHandle;
  /** 断言本轮加载过指定 skill。 */
  loadedSkill(skill: string): AssertionHandle;
  /** 断言本轮没有失败的工具调用 / 命令。 */
  noFailedActions(): AssertionHandle;
  /** 断言本轮出现过指定类型的事件;`opts.count` 可约束出现次数。 */
  event(type: StreamEvent["type"], opts?: { count?: number }): AssertionHandle;
  /** 断言本轮未出现指定类型的事件。 */
  notEvent(type: StreamEvent["type"]): AssertionHandle;
  /** 断言本轮调用过指定名字的子 agent;`match` 可约束次数 / 状态 / remoteUrl。 */
  calledSubagent(name: string, match?: SubagentMatch): AssertionHandle;
  /** 断言本轮事件按给定类型顺序出现(允许中间夹杂其它事件)。 */
  eventOrder(types: StreamEvent["type"][]): AssertionHandle;
  /** 用自定义谓词对本轮整段事件流断言;label 必填、进断言标题(谓词不透明,解释责任在 label)。 */
  eventsSatisfy(label: string, predicate: (events: readonly StreamEvent[]) => boolean): AssertionHandle;
  /** 断言本轮 token 用量不超过 max。 */
  maxTokens(max: number): AssertionHandle;
  /** 断言本轮花费(USD)不超过 usd。 */
  maxCost(usd: number): AssertionHandle;
  /** 本轮可用的 judge 命名空间(t.judge.autoevals.*)。 */
  readonly judge: JudgeNamespace;
}

/** autoevals 子命名空间:结构化的参考材料对照评估(closedQA / factuality / summarizes)。 */
export interface AutoevalsNamespace {
  closedQA(question: string, opts?: { on?: string; model?: string }): AssertionHandle;
  factuality(expected: string, opts?: { on?: string; model?: string }): AssertionHandle;
  summarizes(source: string, opts?: { on?: string; model?: string }): AssertionHandle;
}

export interface JudgeNamespace {
  /** 结构化对照评估的子命名空间(t.judge.autoevals.closedQA / .factuality / .summarizes)。 */
  autoevals: AutoevalsNamespace;
}

/** 最终 diff 的只读视图(t.sandbox.diff);内容在 test() 跑完、finalize 前才落定。 */
export interface DiffView {
  /** 取某个生成 / 修改文件的最终内容;文件不在 diff 里则 undefined。 */
  get(path: string): string | undefined;
  /** 整个 diff 是否为空(既没有生成/修改的文件,也没有删除的文件)。 */
  isEmpty(): boolean;
  /** 正则是否命中 diff 里任意文件的路径或内容。 */
  matches(re: RegExp): boolean;
}

/** 工具匹配小语言。 */
export interface ToolMatch {
  /**
   * 只匹配入参包含这些键值的调用:**深度部分匹配**——嵌套对象逐键下钻,数组按值比较;
   * 值可以是 RegExp(对字符串字段测试,不命中时再对整个 input 的序列化串兜底测一次)
   * 或谓词函数。不要求深度相等,多余的入参键不影响命中。
   */
  input?: Record<string, unknown>;
  /** 精确匹配调用次数,省略则只要求「至少一次」。 */
  count?: number;
  /** 只匹配处于该状态的调用(如 HITL 场景下的 rejected)。 */
  status?: "completed" | "failed" | "rejected";
}

/** calledSubagent 的匹配小语言,语义同 ToolMatch。 */
export interface SubagentMatch {
  /** 精确匹配调用次数,省略则只要求「至少一次」。 */
  count?: number;
  status?: "completed" | "failed";
  /** 只匹配指向该远程地址的子 agent 调用。 */
  remoteUrl?: string | RegExp;
}

/** requireInputRequest 的过滤条件;多个字段之间是 AND 关系。 */
export interface InputRequestFilter {
  id?: string | RegExp;
  prompt?: string | RegExp;
  display?: string | RegExp;
  action?: string | RegExp;
  input?: Record<string, unknown>;
  /** 请求的可选项 id 集合必须与此完全一致(顺序无关)。 */
  optionIds?: readonly string[];
}

/**
 * `t.respond(...)` 的对象形式:显式指名回答的是哪条请求(多个请求并停时用它消歧,
 * 字符串形式做不到)。`optionId` 与 `text` 二选一——`optionId` 必须存在于
 * `request.options` 里,写错直接抛;`text` 是自由文本,不做校验。
 */
export interface RespondAnswer {
  readonly request: InputRequest;
  readonly optionId?: string;
  readonly text?: string;
}

/** 评估用例作者可见的受限 Sandbox 视图:能执行命令 / 文件 IO / 读最终 diff,但不能 stop。 */
export interface SandboxHandle {
  /** Sandbox 内的工作目录绝对路径。 */
  readonly workdir: string;
  /** 在 Sandbox 里执行一条命令(argv 形式,不经 shell)。装系统依赖等需要 root 时传 `{ root: true }`。 */
  runCommand(cmd: string, args?: string[], opts?: CommandOptions): Promise<CommandResult>;
  /** 在 Sandbox 里执行一段 shell 脚本(经 shell 解释,支持管道 / 重定向)。 */
  runShell(script: string, opts?: CommandOptions): Promise<CommandResult>;
  /** 读 Sandbox 内某文件此刻的文本内容(实时读,不是 diff 快照)。 */
  readFile(path: string): Promise<string>;
  /** Sandbox 内某路径此刻是否存在。 */
  fileExists(path: string): Promise<boolean>;
  /** 按选项批量读回 Sandbox 里的源文件,供比对 / judge 用材料。 */
  readSourceFiles(opts?: ReadSourceFilesOptions): Promise<SourceFiles>;
  /** 把一组内容写进 Sandbox(路径相对 targetDir,默认 workdir)。 */
  writeFiles(files: Record<string, string>, targetDir?: string): Promise<void>;
  /** 把一批内存中的文件上传进 Sandbox。 */
  uploadFiles(files: SandboxFile[], targetDir?: string): Promise<void>;
  /** 把本地目录整体上传进 Sandbox;`opts.ignore` 排除指定路径。 */
  uploadDirectory(localDir: string, targetDir?: string, opts?: { ignore?: string[] }): Promise<void>;
  /** 从 Sandbox 下载某文件内容。 */
  downloadFile(path: string): Promise<Buffer>;
  /** 把一段内容上传成 Sandbox 里的单个文件。 */
  uploadFile(path: string, content: Buffer): Promise<void>;
  /** Sandbox provider 分配的实例 id,用于排查 / 关联日志。 */
  readonly sandboxId: string;
  /** 相对 git 基线的最终 diff 视图(test() 跑完、finalize 前才落定)。 */
  readonly diff: DiffView;
  /** 取 Sandbox 内某文件的最终内容,占位延迟到 finalize 才真正读取;只能配合 t.check 使用。 */
  file(path: string): string;
  /** 断言 diff 里某路径发生了变化(新增或修改)。 */
  fileChanged(path: string): AssertionHandle;
  /** 断言 diff 里某路径被删除。 */
  fileDeleted(path: string): AssertionHandle;
  /** 断言 diff 的路径与内容都不匹配给定正则(常用来否定式检查不该出现的改动)。 */
  notInDiff(re: RegExp): AssertionHandle;
  /** 断言 Sandbox 里执行过的命令都没有失败退出。 */
  noFailedShellCommands(): AssertionHandle;
}

/**
 * `t.newSession()` 返回的独立会话句柄:另开一路对话,发送与断言都与默认会话及其它
 * `newSession()` 会话相互隔离(各自的 events / usage 互不叠加)。下面的断言方法都按
 * 「这个会话到目前为止的累计事件流」评估(跨该会话所有轮次),不是仅最后一轮——
 * 只看最后一轮要用 `send()` 返回的 TurnHandle。
 */
export interface SessionHandle {
  /** 在这个会话里发一条消息(字符串或结构化消息),返回该轮的 TurnHandle。 */
  send(input: SendInput): Promise<TurnHandle>;
  /** 在这个会话里发一条带文件的消息,语义同 TestContext.sendFile。 */
  sendFile(path: string, text?: string): Promise<TurnHandle>;
  /** 取这个会话里等待中的 HITL 输入请求;拿不到就抛,语义同 TestContext.requireInputRequest。 */
  requireInputRequest(filter?: InputRequestFilter): InputRequest;
  /** 回答这个会话里等待中的输入请求,返回续接的 TurnHandle。 */
  respond(...responses: (string | RespondAnswer)[]): Promise<TurnHandle>;
  /** 用同一个 optionId 批量回答这个会话里全部等待中的输入请求。 */
  respondAll(optionId: string): Promise<TurnHandle>;
  /** 这个会话最近一轮的助手回复文本。 */
  readonly reply: string;
  /** adapter 侧的会话 id(有会话概念的 agent 才有)。 */
  readonly sessionId: string | undefined;
  /** 这个会话累计的事件流(跨该会话内所有轮次,不含其它会话)。 */
  readonly events: readonly StreamEvent[];
  /** 断言这个会话累计状态为 "completed"(跨全部轮次)。 */
  succeeded(): AssertionHandle;
  /** 断言这个会话当前卡在 HITL 输入请求上。 */
  parked(): AssertionHandle;
  /** 断言这个会话累计的助手回复包含 token(跨全部轮次)。 */
  messageIncludes(token: string | RegExp): AssertionHandle;
  /** 断言这个会话累计调用过指定名字的工具;match 可约束入参 / 次数 / 状态。 */
  calledTool(name: string, match?: ToolMatch): AssertionHandle;
  /** 断言这个会话累计未调用指定工具(或未按 match 条件调用)。 */
  notCalledTool(name: string, match?: ToolMatch): AssertionHandle;
  /** 断言这个会话累计工具调用按给定顺序出现。 */
  toolOrder(names: string[]): AssertionHandle;
  /** 断言这个会话至今未调用任何工具。 */
  usedNoTools(): AssertionHandle;
  /** 断言这个会话累计工具调用总数不超过 max。 */
  maxToolCalls(max: number): AssertionHandle;
  /** 断言这个会话累计加载过指定 skill。 */
  loadedSkill(skill: string): AssertionHandle;
  /** 断言这个会话累计没有失败的工具调用 / 命令。 */
  noFailedActions(): AssertionHandle;
  /** 断言这个会话累计出现过指定类型的事件;opts.count 可约束次数。 */
  event(type: StreamEvent["type"], opts?: { count?: number }): AssertionHandle;
  /** 断言这个会话累计未出现指定类型的事件。 */
  notEvent(type: StreamEvent["type"]): AssertionHandle;
  /** 断言这个会话累计调用过指定名字的子 agent;match 可约束次数 / 状态 / remoteUrl。 */
  calledSubagent(name: string, match?: SubagentMatch): AssertionHandle;
  /** 断言这个会话累计事件按给定类型顺序出现。 */
  eventOrder(types: StreamEvent["type"][]): AssertionHandle;
  /** 用自定义谓词对这个会话累计的整段事件流断言;label 必填、进断言标题。 */
  eventsSatisfy(label: string, predicate: (events: readonly StreamEvent[]) => boolean): AssertionHandle;
  /** 断言这个会话累计 token 用量不超过 max。 */
  maxTokens(max: number): AssertionHandle;
  /** 断言这个会话累计花费(USD)不超过 usd。 */
  maxCost(usd: number): AssertionHandle;
  /** 这个会话累计的 token 用量与估算成本。 */
  readonly usage: Usage;
  /** 这个会话可用的 judge 命名空间。 */
  readonly judge: JudgeNamespace;
}

/**
 * eval 作者拿到的高层上下文。运行器按 agent 能力组装;tsx 不做类型检查,所以这里
 * 用一个宽接口承载全部动作(运行时按 capability 守卫)。
 */
export interface TestContext {
  // 会话
  /** 向默认会话发一条消息(字符串或结构化消息),返回该轮的 TurnHandle。事件同时累加进默认会话的累计事件流,供下面的作用域断言使用。 */
  send(input: SendInput): Promise<TurnHandle>;
  /** 发一条带文件(图片等多模态输入)的消息。`path` 相对项目根;读出后 base64 随 TurnInput.files 交给 adapter。 */
  sendFile(path: string, text?: string): Promise<TurnHandle>;
  /** 取默认会话里等待中的 HITL 输入请求;不传 filter 要求恰好一条,拿不到就抛。 */
  requireInputRequest(filter?: InputRequestFilter): InputRequest;
  /**
   * 回答默认会话里等待中的输入请求,返回续接的 TurnHandle。字符串形式按顺序对应各请求;
   * 多个请求并停、需要指名回答哪一条时用 RespondAnswer 对象形式(见其类型注释)。
   */
  respond(...responses: (string | RespondAnswer)[]): Promise<TurnHandle>;
  /** 用同一个 optionId 批量回答默认会话里全部等待中的输入请求。 */
  respondAll(optionId: string): Promise<TurnHandle>;
  /** 默认会话最近一轮的助手回复文本。 */
  readonly reply: string;
  /** adapter 侧的默认会话 id(有会话概念的 agent 才有)。 */
  readonly sessionId: string | undefined;
  /** 默认会话累计的事件流(跨该会话所有轮次)。 */
  readonly events: readonly StreamEvent[];
  /**
   * 另开一路独立会话,返回它的 SessionHandle——不是 void。多会话隔离的关键入口:
   * 新会话的发送与断言都与默认会话及其它 newSession() 会话相互隔离,常用于「多用户
   * 并行对话」「一条主线 + 一条旁支」这类场景。
   */
  newSession(): SessionHandle;

  // 运行上下文
  /** 本次 attempt 的中止信号;超时 / 首过即停 / 用户 Ctrl-C 时触发,传给 adapter 的长耗时调用做取消。 */
  readonly signal: AbortSignal;
  /** 本次 attempt 使用的模型名(由 experiment/CLI flag 决定);省略即 agent 原生默认,不代表「无模型」。 */
  readonly model?: string;
  /** 本次 attempt 的推理努力程度(如 "low"/"medium"/"high",取值由 adapter/模型决定)。 */
  readonly reasoningEffort?: string;
  /** 本次 attempt 生效的实验 flags(experiment.flags 的只读视图;实验条件,非命令行开关)。 */
  readonly flags: Readonly<Record<string, unknown>>;
  /**
   * 作用域反馈:报告评估用例自己执行的长步骤(上传 Fixture、跑构建……)。短命状态,scope 固定
   * 为 `eval.run`;只报告不断言(见 docs/feature/eval/library/context.md「向运行反馈长步骤」)。
   */
  progress(update: ProgressUpdate): void;
  /**
   * 作用域反馈:报告运行结束后仍需保留的问题(永久事件,落 attempt diagnostics)。
   * 即使 level 为 "error" 也不自动改变 verdict——测试结论仍由断言决定。
   */
  diagnostic(input: DiagnosticInput): void;
  /** `progress({ message: msg })` 的别名(调试日志),不出现在最终结果里。 */
  log(msg: string): void;
  /** 立即中止本评估用例并标记为 skipped(verdict / EvalResult.skipReason),reason 不能为空。 */
  skip(reason: string): never;

  // 值断言
  /**
   * 对任意值跑一个 ValueAssertion,返回可链 `.gate()` / `.atLeast()` 的 AssertionHandle。
   * 打分延迟到评估用例结束后统一 finalize,调用本身同步、不抛错——不通过只是记一条失败断言,
   * 不会中止后续代码。要「不满足就立即中止评估用例」用 require。
   */
  check(value: unknown, assertion: ValueAssertion): AssertionHandle;
  /**
   * 对任意值跑一个 ValueAssertion,立即(await 时)求值;不满足就抛错中止整个评估用例剩余步骤
   * (仍会把这条断言计入报告,不影响已记录的其它断言)。跟 check 的区别:check 只记录、
   * 从不抛错,打分留到最后统一算;require 当场判定、失败即中止,适合「前置条件不满足,
   * 后面写了也没意义」的场景。
   */
  require(value: unknown, assertion: ValueAssertion): Promise<unknown>;
  /**
   * 把一组断言归到一个有标题的分组下(对照 vitest 的 test('title', ...))。纯组织/报告用,
   * 不改打分:组里每条断言仍独立计分。可嵌套(标题用 › 连接)。
   */
  group<T>(title: string, fn: () => Promise<T> | T): Promise<T>;

  // 作用域断言(工具 / 会话)
  /** 断言默认会话累计状态为 "completed"(跨该会话所有轮次,不止最后一轮)。 */
  succeeded(): AssertionHandle;
  /** 断言默认会话当前卡在 HITL 输入请求上。 */
  parked(): AssertionHandle;
  /** 断言默认会话累计的助手回复包含 token(跨该会话所有轮次,不止最后一轮)。 */
  messageIncludes(token: string | RegExp): AssertionHandle;
  /** 断言默认会话累计调用过指定名字的工具;match 可约束入参 / 次数 / 状态。 */
  calledTool(name: string, match?: ToolMatch): AssertionHandle;
  /** 断言默认会话累计未调用指定工具(或未按 match 条件调用)。 */
  notCalledTool(name: string, match?: ToolMatch): AssertionHandle;
  /** 断言默认会话累计工具调用按给定顺序出现(允许中间夹杂其它调用)。 */
  toolOrder(names: string[]): AssertionHandle;
  /** 断言默认会话至今未调用任何工具。 */
  usedNoTools(): AssertionHandle;
  /** 断言默认会话累计工具调用总数不超过 max。 */
  maxToolCalls(max: number): AssertionHandle;
  /** 断言默认会话累计加载过指定 skill。 */
  loadedSkill(skill: string): AssertionHandle;
  /** 断言默认会话累计没有失败的工具调用 / 命令。 */
  noFailedActions(): AssertionHandle;
  /** 断言默认会话累计出现过指定类型的事件;opts.count 可约束出现次数。 */
  event(type: StreamEvent["type"], opts?: { count?: number }): AssertionHandle;
  /** 断言默认会话累计未出现指定类型的事件。 */
  notEvent(type: StreamEvent["type"]): AssertionHandle;
  /** 断言默认会话累计调用过指定名字的子 agent;match 可约束次数 / 状态 / remoteUrl。 */
  calledSubagent(name: string, match?: SubagentMatch): AssertionHandle;
  /** 断言默认会话累计事件按给定类型顺序出现(允许中间夹杂其它事件)。 */
  eventOrder(types: StreamEvent["type"][]): AssertionHandle;
  /** 用自定义谓词对默认会话累计的整段事件流断言;label 必填、进断言标题。 */
  eventsSatisfy(label: string, predicate: (events: readonly StreamEvent[]) => boolean): AssertionHandle;

  // 工作区 / 沙箱
  /** 受限 Sandbox 视图:能执行命令 / 读写文件 / 看最终 diff,不能 stop Sandbox 本身(见 SandboxHandle)。 */
  readonly sandbox: SandboxHandle;

  // 效率 / 成本
  /** 默认会话累计的 token 用量与估算成本。 */
  readonly usage: Usage;
  /** 断言默认会话累计 token 用量不超过 max。 */
  maxTokens(max: number): AssertionHandle;
  /** 断言默认会话累计花费(USD)不超过 usd。 */
  maxCost(usd: number): AssertionHandle;

  // judge
  /** 可用的 judge 命名空间(t.judge.autoevals.*)。 */
  readonly judge: JudgeNamespace;
}
