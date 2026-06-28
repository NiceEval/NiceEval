// fastevals 的核心类型契约。所有模块对着这里编程;agents/ 与 sandbox/ 之外不出现
// agent 名 / sandbox 名的行为分支(见 docs/architecture.md)。

// ───────────────────────── 基础 ─────────────────────────

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type Severity = "gate" | "soft";

/** 一次运行的 token 用量(沙箱型从 transcript 抠,remote 由 send 返回)。 */
export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  requests?: number;
  /** 网关实测成本(若 agent 带回)——优先于价格表估算。 */
  costUSD?: number;
}

// ───────────────────────── 标准事件流 ─────────────────────────

/** 跨 agent 归一化后的规范工具名。 */
export type ToolName =
  | "file_read"
  | "file_write"
  | "file_edit"
  | "shell"
  | "web_fetch"
  | "web_search"
  | "glob"
  | "grep"
  | "list_dir"
  | "agent_task"
  | "unknown";

export interface InputRequest {
  readonly prompt?: string;
  readonly options?: readonly { id: string; label?: string }[];
}

/**
 * 标准事件流的词汇(对标 docs/agents-and-adapters.md)。adapter 唯一的硬活就是把
 * 各 agent 五花八门的原始 transcript 映射成 StreamEvent[];映射完,整套断言免费。
 */
export type StreamEvent =
  | { type: "message"; role: "assistant" | "user"; text: string }
  | { type: "action.called"; callId: string; name: string; input: JsonValue; tool?: ToolName }
  | {
      type: "action.result";
      callId: string;
      output?: JsonValue;
      status: "completed" | "failed" | "rejected";
    }
  | { type: "subagent.called"; callId: string; name: string; remoteUrl?: string }
  | { type: "subagent.completed"; callId: string; output?: JsonValue; status: "completed" | "failed" }
  | { type: "input.requested"; request: InputRequest }
  | { type: "thinking"; text: string }
  | { type: "compaction"; reason?: string }
  | { type: "error"; message: string };

/** core 从事件流折叠出的结构化事实(deriveRunFacts)。 */
export interface ToolCall {
  callId: string;
  name: ToolName;
  originalName?: string;
  input: JsonValue;
  output?: JsonValue;
  status: "completed" | "failed" | "rejected";
}

export interface SubagentCall {
  callId: string;
  name: string;
  remoteUrl?: string;
  output?: JsonValue;
  status: "completed" | "failed";
}

export interface DerivedFacts {
  readonly toolCalls: readonly ToolCall[];
  readonly subagentCalls: readonly SubagentCall[];
  readonly inputRequests: readonly InputRequest[];
  readonly parked: boolean;
  readonly messageCount: number;
  readonly compactions: number;
}

/** 给人 / 给 EVAL.ts 看的 o11y 摘要(注入沙箱 __fastevals__/results.json)。 */
export interface O11ySummary {
  totalTurns: number;
  toolCalls: Record<string, number>;
  totalToolCalls: number;
  filesRead: string[];
  filesModified: string[];
  shellCommands: { command: string; exitCode?: number; success?: boolean }[];
  webFetches: { url: string; status?: number; success?: boolean }[];
  errors: string[];
  thinkingBlocks: number;
  compactions: number;
  durationMs: number;
  usage: Usage;
  estimatedCostUSD?: number;
}

// ───────────────────────── Agent 契约 ─────────────────────────

export interface TurnInput {
  readonly text: string;
}

/** adapter 的 send 返回值(事件流为核心)。 */
export interface Turn {
  readonly events: StreamEvent[];
  readonly data?: unknown;
  readonly status: "completed" | "failed" | "waiting";
  readonly usage?: Usage;
}

export interface AgentCapabilities {
  conversation?: boolean;
  toolObservability?: boolean;
  workspace?: boolean;
  compactionObservability?: boolean;
}

/** 多轮 resume / newSession 用。id 可写(adapter 回传供下轮续接)。 */
export interface AgentSession {
  id?: string;
  readonly isNew: boolean;
}

export interface AgentContext {
  readonly signal: AbortSignal;
  readonly model?: string;
  readonly flags: Readonly<Record<string, unknown>>;
  /** 仅沙箱型 agent 有(运行器按 --sandbox 备好)。 */
  readonly sandbox: Sandbox;
  readonly session: AgentSession;
  /** hooks.run.setup 经 run.share 放进来的只读共享物。 */
  readonly shared: Readonly<Record<string, unknown>>;
  log(msg: string): void;
}

/**
 * agent 自己的沙箱生命周期(每个沙箱一次,与「每轮 send」分开):
 * `setup` 装 CLI、写配置(model/base/auth 等本轮内不变的东西),`send` 只管把一轮 prompt
 * 跑起来(第一次 fresh / 后续 resume)+ 解析 transcript,`teardown` 清理。
 * 运行器在备好沙箱(上传 / 基线 / eval.setup)后、第一次 send 前调一次 `setup`;
 * `setup` 可返回 cleanup 闭包,与 `teardown` 都在 finally 跑。
 */
export type AgentSetup = (sandbox: Sandbox, ctx: AgentContext) => Promise<void | Cleanup> | void | Cleanup;
export type AgentTeardown = (sandbox: Sandbox, ctx: AgentContext) => Promise<void> | void;

/** 注册表里的 agent(defineAgent / defineSandboxAgent 产出)。 */
export interface Agent {
  readonly name: string;
  readonly kind: "sandbox" | "remote";
  readonly capabilities: AgentCapabilities;
  setup?: AgentSetup;
  send(input: TurnInput, ctx: AgentContext): Promise<Turn>;
  teardown?: AgentTeardown;
}

export interface SandboxAgentDef {
  name: string;
  capabilities?: AgentCapabilities;
  /** 每个沙箱一次:装 CLI、写 config.toml / 鉴权配置。 */
  setup?: AgentSetup;
  /** 每轮一次:跑 prompt(fresh / resume)+ 解析成 events。 */
  send(input: TurnInput, ctx: AgentContext): Promise<Turn>;
  teardown?: AgentTeardown;
}

export interface RemoteAgentDef {
  name: string;
  capabilities?: AgentCapabilities;
  setup?: AgentSetup;
  send(input: TurnInput, ctx: AgentContext): Promise<Turn>;
  teardown?: AgentTeardown;
}

// ───────────────────────── Sandbox ─────────────────────────

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface SandboxFile {
  path: string;
  content: string | Buffer;
}

export type SandboxBackend = "docker" | "vercel" | "auto" | string;

export interface CommandOptions {
  env?: Record<string, string>;
  cwd?: string;
  /**
   * 把本命令的输出也送进沙箱的「原生日志流」(于是 `docker logs` / Docker UI 的 Logs
   * 标签页能实时看到它)。给 agent 命令(codex exec / bub run / claude)开它,就能在容器
   * 日志里看到 agent 的【原始输出】。后端各自实现(docker:tee 到 PID1 tail 的文件;
   * 不支持的后端忽略)—— 日志怎么浮现是 backend 的事,adapter 只声明意图。
   */
  stream?: boolean;
}

export interface Sandbox {
  runCommand(cmd: string, args?: string[], opts?: CommandOptions): Promise<CommandResult>;
  runShell(script: string, opts?: CommandOptions): Promise<CommandResult>;
  readFile(path: string): Promise<string>;
  fileExists(path: string): Promise<boolean>;
  writeFiles(files: Record<string, string>): Promise<void>;
  uploadFiles(files: SandboxFile[]): Promise<void>;
  getWorkingDirectory(): string;
  setWorkingDirectory(path: string): void;
  stop(): Promise<void>;
  readonly sandboxId: string;
  /**
   * 可选:把一行写进容器的「主日志」(PID1 在 tail 它)——于是 `docker logs` /
   * Docker UI 的 Logs 标签页能实时看到 agent 逐轮活动。docker 后端实现,其它可省略。
   */
  appendLog?(line: string): Promise<void>;
}

// ───────────────────────── 评分 / 断言 ─────────────────────────

/** 值级断言(expect 匹配器)。纯函数 score + 可链式改严重级 / 阈值。 */
export interface ValueAssertion {
  readonly name: string;
  readonly severity: Severity;
  readonly threshold?: number;
  score(value: unknown): number | Promise<number>;
  gate(): ValueAssertion;
  soft(threshold?: number): ValueAssertion;
  atLeast(threshold: number): ValueAssertion;
}

/** 收集到 collector 里的一条断言记录(评估前)。 */
export interface AssertionSpec {
  name: string;
  severity: Severity;
  threshold?: number;
  /** 延迟评估:final 时拿到完整运行结果再算分。 */
  evaluate(ctx: ScoringContext): Promise<number> | number;
}

/** 断言评估完的结果(进判决 / 报告)。 */
export interface AssertionResult {
  name: string;
  severity: Severity;
  threshold?: number;
  score: number;
  passed: boolean;
  detail?: string;
}

/** eval 作者拿到的可链式句柄(t.judge.agent(...).atLeast(0.7))。 */
export interface AssertionHandle {
  atLeast(threshold: number): AssertionHandle;
  gate(): AssertionHandle;
  soft(threshold?: number): AssertionHandle;
}

/** scoped / judge 断言在 final 评估时拿到的运行结果。 */
export interface ScoringContext {
  readonly events: readonly StreamEvent[];
  readonly facts: DerivedFacts;
  readonly diff: DiffData;
  readonly scripts: Record<string, ScriptResult>;
  readonly usage: Usage;
  readonly status: "completed" | "failed" | "waiting";
  /** 读沙箱里某文件的最终内容(judge / file 断言用)。 */
  readFile(path: string): Promise<string | undefined>;
}

export interface ScriptResult {
  success: boolean;
  output: string;
}

export interface DiffData {
  generatedFiles: Record<string, string>;
  deletedFiles: string[];
}

export type Verdict = "passed" | "failed" | "scored" | "skipped";

// ───────────────────────── Judge ─────────────────────────

export interface JudgeConfig {
  model: string;
  /** OpenAI 兼容 base url + key 来源;省略则从 env 探测(见 scoring/judge.ts)。 */
  baseUrl?: string;
  apiKeyEnv?: string;
}

// ───────────────────────── 价格 / 报告 ─────────────────────────

export interface PriceEntry {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok?: number;
  cacheWritePerMTok?: number;
}

export interface EvalResult {
  id: string;
  experimentId?: string;
  agent: string;
  model?: string;
  verdict: Verdict;
  attempt: number;
  durationMs: number;
  assertions: AssertionResult[];
  usage?: Usage;
  estimatedCostUSD?: number;
  error?: string;
  skipReason?: string;
  events?: StreamEvent[];
  o11y?: O11ySummary;
  diff?: DiffData;
  rawTranscript?: string;
}

export interface RunSummary {
  agent: string;
  model?: string;
  startedAt: string;
  completedAt: string;
  passed: number;
  failed: number;
  scored: number;
  skipped: number;
  errored: number;
  durationMs: number;
  usage?: Usage;
  estimatedCostUSD?: number;
  results: EvalResult[];
  outputDir?: string;
}

export interface Reporter {
  onRunStart?(evals: { id: string }[], agent: Agent): void | Promise<void>;
  onEvalComplete?(result: EvalResult): void | Promise<void>;
  onRunComplete?(summary: RunSummary): void | Promise<void>;
}

// ───────────────────────── 生命周期 ─────────────────────────

export type Cleanup = () => Promise<void> | void;

export interface RunContext {
  readonly experimentId?: string;
  readonly evals: readonly string[];
  readonly agents: readonly string[];
  readonly flags: Readonly<Record<string, unknown>>;
  readonly signal: AbortSignal;
  log(msg: string): void;
  share(key: string, value: unknown): void;
}

export interface LifecycleHooks {
  run?: {
    setup?: (run: RunContext) => Promise<void | Cleanup> | void | Cleanup;
    teardown?: (run: RunContext) => Promise<void> | void;
  };
  sandbox?: {
    setup?: (sandbox: Sandbox, ctx: AgentContext) => Promise<void | Cleanup> | void | Cleanup;
    teardown?: (sandbox: Sandbox, ctx: AgentContext) => Promise<void> | void;
  };
}

// ───────────────────────── eval / experiment / config 定义 ─────────────────────────

export interface EvalDef {
  /** 路径推导,定义里禁止手写。 */
  id?: string;
  description?: string;
  agent?: string;
  tags?: string[];
  judge?: JudgeConfig;
  reporters?: Reporter[];
  timeoutMs?: number;
  metadata?: Record<string, unknown>;
  /** starter repo 目录(相对项目根),拷进沙箱当工作区。 */
  workspace?: string;
  /** eval 级预置:拿到沙箱(已上传 workspace + git 基线 + 装好依赖前)。 */
  setup?: (sandbox: Sandbox) => Promise<void | Cleanup> | void | Cleanup;
  test(t: TestContext): Promise<void> | void;
}

/** 内部:发现后带上 id 的 eval。 */
export interface DiscoveredEval extends EvalDef {
  id: string;
  /** 定义文件所在目录(解析相对 workspace 用)。 */
  baseDir: string;
}

export interface ExperimentDef {
  id?: string;
  description?: string;
  agent: string | string[];
  model?: string | string[];
  flags?: Record<string, unknown>;
  runs?: number;
  earlyExit?: boolean;
  evals?: "*" | string[] | ((id: string) => boolean);
  timeoutMs?: number;
  sandbox?: SandboxBackend;
  budget?: number;
  hooks?: LifecycleHooks;
}

export interface DiscoveredExperiment extends ExperimentDef {
  id: string;
  group: string;
}

export interface Config {
  agents?: Agent[];
  defaultAgent?: string;
  sandbox?: SandboxBackend;
  workspace?: string;
  judge?: JudgeConfig;
  pricing?: Record<string, PriceEntry>;
  reporters?: Reporter[];
  maxConcurrency?: number;
  timeoutMs?: number;
  copyFiles?: "none" | "changed" | "all";
  hooks?: LifecycleHooks;
}

// ───────────────────────── TestContext(t)与子句柄 ─────────────────────────

/** t.send() 返回的句柄:从事件流派生便利字段 + expectOk。 */
export interface TurnHandle {
  readonly events: StreamEvent[];
  readonly status: "completed" | "failed" | "waiting";
  readonly message: string;
  readonly data?: unknown;
  readonly usage?: Usage;
  /** 上一轮若 failed 则抛(中止后续)。 */
  expectOk(): TurnHandle;
  outputEquals(value: unknown): AssertionHandle;
  outputMatches(schema: unknown): AssertionHandle;
}

export interface JudgeNamespace {
  /** agent-as-judge:让评判模型读沙箱回答开放式问题,打 0–1 分。 */
  agent(question: string, opts?: { on?: string; model?: string }): AssertionHandle;
  score(rubric: string, opts?: { on?: string; model?: string }): AssertionHandle;
  closedQA(question: string, opts?: { on?: string; model?: string }): AssertionHandle;
  factuality(expected: string, opts?: { on?: string; model?: string }): AssertionHandle;
  summarizes(source: string, opts?: { on?: string; model?: string }): AssertionHandle;
}

export interface TranscriptNamespace {
  /** 本会话自动压缩次数;capability 未声明 / 不可观测 → undefined。 */
  compactions(): number | undefined;
  events(): StreamEvent[];
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

/**
 * eval 作者拿到的高层上下文。运行器按 agent 能力组装;tsx 不做类型检查,所以这里
 * 用一个宽接口承载全部动作(运行时按 capability 守卫)。
 */
export interface TestContext {
  // 会话
  send(text: string): Promise<TurnHandle>;
  readonly reply: string;
  newSession(): TestContext;

  // 运行上下文
  readonly signal: AbortSignal;
  readonly model?: string;
  readonly flags: Readonly<Record<string, unknown>>;
  readonly shared: Readonly<Record<string, unknown>>;
  log(msg: string): void;
  skip(reason: string): never;

  // 值级断言
  check(value: unknown, assertion: ValueAssertion): AssertionHandle;
  require(value: unknown, assertion: ValueAssertion): Promise<unknown>;

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

  // 工作区 / 沙箱
  readonly sandbox: Sandbox;
  readonly diff: DiffView;
  readonly transcript: TranscriptNamespace;
  file(path: string): string;
  fileChanged(path: string): AssertionHandle;
  fileDeleted(path: string): AssertionHandle;
  notInDiff(re: RegExp): AssertionHandle;
  testsPassed(): AssertionHandle;
  scriptPassed(script: string): AssertionHandle;
  noFailedShellCommands(): AssertionHandle;

  // 效率 / 成本
  readonly usage: Usage;
  maxTokens(max: number): AssertionHandle;
  maxCost(usd: number): AssertionHandle;

  // judge
  readonly judge: JudgeNamespace;
}
