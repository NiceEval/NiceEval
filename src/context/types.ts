// context 域类型:eval 作者拿到的 `t`(TestContext)及其子句柄(turn / session / sandbox 视图)。
// `t` 的形状按 Agent 能力组装(见 docs/architecture.md「能力决定形状」)。

import type { InputRequest, StreamEvent, ToolCall, Usage } from "../o11y/types.ts";
import type { AssertionHandle, ValueAssertion } from "../scoring/types.ts";
import type {
  CommandOptions,
  CommandResult,
  ReadSourceFilesOptions,
  SandboxFile,
  SourceFiles,
} from "../sandbox/types.ts";

/** t.send() 返回的句柄:从事件流派生便利字段 + expectOk。 */
export interface TurnHandle {
  readonly events: StreamEvent[];
  readonly toolCalls: readonly ToolCall[];
  readonly status: "completed" | "failed" | "waiting";
  readonly message: string;
  readonly data?: unknown;
  readonly usage?: Usage;
  /** 上一轮若 failed 则抛(中止后续)。 */
  expectOk(): TurnHandle;
  outputEquals(value: unknown): AssertionHandle;
  outputMatches(schema: unknown): AssertionHandle;
  /** 断言本轮助手回复包含 token(仅限本轮事件流,不跨轮)。 */
  messageIncludes(token: string | RegExp): AssertionHandle;
  succeeded(): AssertionHandle;
  parked(): AssertionHandle;
  calledTool(name: string, match?: ToolMatch): AssertionHandle;
  notCalledTool(name: string, match?: ToolMatch): AssertionHandle;
  toolOrder(names: string[]): AssertionHandle;
  usedNoTools(): AssertionHandle;
  maxToolCalls(max: number): AssertionHandle;
  loadedSkill(skill: string): AssertionHandle;
  noFailedActions(): AssertionHandle;
  event(type: StreamEvent["type"], opts?: { count?: number }): AssertionHandle;
  notEvent(type: StreamEvent["type"]): AssertionHandle;
  calledSubagent(name: string, match?: SubagentMatch): AssertionHandle;
  eventOrder(types: StreamEvent["type"][]): AssertionHandle;
  eventsSatisfy(predicate: (events: readonly StreamEvent[]) => boolean, label?: string): AssertionHandle;
  maxTokens(max: number): AssertionHandle;
  maxCost(usd: number): AssertionHandle;
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

export interface DiffView {
  get(path: string): string | undefined;
  isEmpty(): boolean;
  matches(re: RegExp): boolean;
}

/** 工具匹配小语言。 */
export interface ToolMatch {
  input?: Record<string, unknown>;
  count?: number;
  status?: "completed" | "failed" | "rejected";
}

export interface SubagentMatch {
  count?: number;
  status?: "completed" | "failed";
  remoteUrl?: string | RegExp;
}

export interface InputRequestFilter {
  id?: string | RegExp;
  prompt?: string | RegExp;
  display?: string | RegExp;
  action?: string | RegExp;
  input?: Record<string, unknown>;
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

/** eval 作者可见的受限沙箱视图:能执行命令 / 文件 IO / 读最终 diff,但不能 stop。 */
export interface SandboxHandle {
  readonly workdir: string;
  runCommand(cmd: string, args?: string[], opts?: CommandOptions): Promise<CommandResult>;
  runShell(script: string, opts?: CommandOptions): Promise<CommandResult>;
  readFile(path: string): Promise<string>;
  fileExists(path: string): Promise<boolean>;
  readSourceFiles(opts?: ReadSourceFilesOptions): Promise<SourceFiles>;
  writeFiles(files: Record<string, string>, targetDir?: string): Promise<void>;
  uploadFiles(files: SandboxFile[], targetDir?: string): Promise<void>;
  uploadDirectory(localDir: string, targetDir?: string, opts?: { ignore?: string[] }): Promise<void>;
  downloadFile(path: string): Promise<Buffer>;
  uploadFile(path: string, content: Buffer): Promise<void>;
  readonly sandboxId: string;
  readonly diff: DiffView;
  file(path: string): string;
  fileChanged(path: string): AssertionHandle;
  fileDeleted(path: string): AssertionHandle;
  notInDiff(re: RegExp): AssertionHandle;
  noFailedShellCommands(): AssertionHandle;
}

export interface SessionHandle {
  send(text: string): Promise<TurnHandle>;
  sendFile(path: string, text?: string): Promise<TurnHandle>;
  requireInputRequest(filter?: InputRequestFilter): InputRequest;
  respond(...responses: (string | RespondAnswer)[]): Promise<TurnHandle>;
  respondAll(optionId: string): Promise<TurnHandle>;
  readonly reply: string;
  readonly sessionId: string | undefined;
  readonly events: readonly StreamEvent[];
  succeeded(): AssertionHandle;
  parked(): AssertionHandle;
  messageIncludes(token: string | RegExp): AssertionHandle;
  calledTool(name: string, match?: ToolMatch): AssertionHandle;
  notCalledTool(name: string, match?: ToolMatch): AssertionHandle;
  toolOrder(names: string[]): AssertionHandle;
  usedNoTools(): AssertionHandle;
  maxToolCalls(max: number): AssertionHandle;
  loadedSkill(skill: string): AssertionHandle;
  noFailedActions(): AssertionHandle;
  event(type: StreamEvent["type"], opts?: { count?: number }): AssertionHandle;
  notEvent(type: StreamEvent["type"]): AssertionHandle;
  calledSubagent(name: string, match?: SubagentMatch): AssertionHandle;
  eventOrder(types: StreamEvent["type"][]): AssertionHandle;
  eventsSatisfy(predicate: (events: readonly StreamEvent[]) => boolean, label?: string): AssertionHandle;
  maxTokens(max: number): AssertionHandle;
  maxCost(usd: number): AssertionHandle;
  readonly usage: Usage;
  readonly judge: JudgeNamespace;
}

/**
 * eval 作者拿到的高层上下文。运行器按 agent 能力组装;tsx 不做类型检查,所以这里
 * 用一个宽接口承载全部动作(运行时按 capability 守卫)。
 */
export interface TestContext {
  // 会话
  send(text: string): Promise<TurnHandle>;
  /** 发一条带文件(图片等多模态输入)的消息。`path` 相对项目根;读出后 base64 随 TurnInput.files 交给 adapter。 */
  sendFile(path: string, text?: string): Promise<TurnHandle>;
  requireInputRequest(filter?: InputRequestFilter): InputRequest;
  respond(...responses: (string | RespondAnswer)[]): Promise<TurnHandle>;
  respondAll(optionId: string): Promise<TurnHandle>;
  readonly reply: string;
  readonly sessionId: string | undefined;
  readonly events: readonly StreamEvent[];
  newSession(): SessionHandle;

  // 运行上下文
  readonly signal: AbortSignal;
  readonly model?: string;
  readonly flags: Readonly<Record<string, unknown>>;
  log(msg: string): void;
  skip(reason: string): never;

  // 值级断言
  check(value: unknown, assertion: ValueAssertion): AssertionHandle;
  require(value: unknown, assertion: ValueAssertion): Promise<unknown>;
  /**
   * 把一组断言归到一个有标题的分组下(对照 vitest 的 test('title', ...))。纯组织/报告用,
   * 不改打分:组里每条断言仍独立计分。可嵌套(标题用 › 连接)。
   */
  group<T>(title: string, fn: () => Promise<T> | T): Promise<T>;

  // 作用域断言(工具 / 会话)
  succeeded(): AssertionHandle;
  parked(): AssertionHandle;
  messageIncludes(token: string | RegExp): AssertionHandle;
  calledTool(name: string, match?: ToolMatch): AssertionHandle;
  notCalledTool(name: string, match?: ToolMatch): AssertionHandle;
  toolOrder(names: string[]): AssertionHandle;
  usedNoTools(): AssertionHandle;
  maxToolCalls(max: number): AssertionHandle;
  loadedSkill(skill: string): AssertionHandle;
  noFailedActions(): AssertionHandle;
  event(type: StreamEvent["type"], opts?: { count?: number }): AssertionHandle;
  notEvent(type: StreamEvent["type"]): AssertionHandle;
  calledSubagent(name: string, match?: SubagentMatch): AssertionHandle;
  eventOrder(types: StreamEvent["type"][]): AssertionHandle;
  eventsSatisfy(predicate: (events: readonly StreamEvent[]) => boolean, label?: string): AssertionHandle;

  // 工作区 / 沙箱
  readonly sandbox: SandboxHandle;

  // 效率 / 成本
  readonly usage: Usage;
  maxTokens(max: number): AssertionHandle;
  maxCost(usd: number): AssertionHandle;

  // judge
  readonly judge: JudgeNamespace;
}
