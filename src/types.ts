// niceeval 的核心类型契约。所有模块对着这里编程;agents/ 与 sandbox/ 之外不出现
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

/**
 * eval 源码里一次调用的位置(`t.send` / 各断言),运行期从栈回溯抠出来(见 src/source-loc.ts)。
 * view 据此把运行结果叠回真实源码行(github-diff 式代码视图)。`file` 为相对项目根的路径。
 */
export interface SourceLoc {
  file: string;
  line: number;
  column?: number;
}

/** 随结果回传的一份 eval 源码(相对项目根的路径 + 文本),供 view 渲染代码视图。 */
export interface SourceArtifact {
  path: string;
  content: string;
}

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
  readonly id?: string;
  readonly prompt?: string;
  readonly display?: string;
  readonly action?: string;
  readonly input?: JsonValue;
  readonly options?: readonly { id: string; label?: string }[];
}

/**
 * 标准事件流的词汇(对标 docs/agents-and-adapters.md)。adapter 唯一的硬活就是把
 * 各 agent 五花八门的原始 transcript 映射成 StreamEvent[];映射完,整套断言免费。
 */
export type StreamEvent =
  | { type: "message"; role: "assistant" | "user"; text: string; loc?: SourceLoc }
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

/**
 * span 的【语义角色】,从 OTel GenAI 语义约定的 gen_ai.operation.name 归一而来
 * (见 o11y/otlp/canonical.ts)。view 据此着色 / 分组 / 跨 agent 对比,**只认这个,
 * 不读原生 span 名**。未识别的 span 落 "other",view 折叠。
 */
export type SpanKind = "turn" | "model" | "tool" | "agent" | "other";

/**
 * 一条分布式追踪的 span(从 agent 经 OpenTelemetry 导出的 OTLP traces 归一而来)。
 * 与 StreamEvent 不同:它带【时间】(起止 epoch 毫秒)与【父子】(parentSpanId),
 * 所以 view 能画成瀑布图。事件流回答「做了什么」,trace 回答「各花了多久、谁套谁」。
 *
 * 两层归一:线格式层(OTLP/JSON|protobuf → 本结构,见 otlp/parse.ts,通用);
 * 语义层(原生 span 名/属性 → canonical GenAI semconv,见 otlp/mappers/<agent>.ts,每 agent 一个薄 mapper)。
 */
export interface TraceSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  /** span 起点 / 终点(epoch 毫秒)。 */
  startMs: number;
  endMs: number;
  status?: "ok" | "error" | "unset";
  /**
   * 归一后的语义角色(每-agent mapper 据 canonical GenAI semconv 定;view/select 只认它)。
   * 未经 mapper 或未识别时为 undefined / "other"。
   */
  kind?: SpanKind;
  /** OTLP span 属性(gen_ai.* / tool 名 / token 等),按 key 摊平。raw 属性始终保留供下钻。 */
  attributes?: Record<string, JsonValue>;
}

/** 给人 / 给 EVAL.ts 看的 o11y 摘要(注入沙箱 __niceeval__/results.json)。 */
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

// ───────────────────────── Plugins / Skills ─────────────────────────

/**
 * MCP server 描述符 —— Claude Code 与 Codex 共用的扩展插件单元。
 * 在 agent factory config 里声明,setup 阶段写进各自的配置文件。
 */
export interface McpServer {
  /** 服务器唯一名(config key)。 */
  name: string;
  /** 启动命令(如 "npx"、"node"、"uvx")。 */
  command: string;
  /** 传给命令的参数。 */
  args?: string[];
  /** 注入服务器进程的环境变量。 */
  env?: Record<string, string>;
}

// ───────────────────────── Agent 契约 ─────────────────────────

/** 随一轮消息附带的文件(图片等多模态输入)。 */
export interface InputFile {
  /** 文件名(可选,供 adapter / 模型参考)。 */
  readonly filename?: string;
  /** MIME 类型,如 `image/png`、`image/jpeg`。 */
  readonly mimeType: string;
  /** base64 编码的文件内容(JSON 友好,remote adapter 可直接放进请求体)。 */
  readonly dataBase64: string;
}

export interface TurnInput {
  readonly text: string;
  /** 本轮附带的文件(图片等)。adapter 自行决定怎么投递;不支持多模态的 adapter 忽略它。 */
  readonly files?: readonly InputFile[];
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
  sandbox?: boolean;
  compactionObservability?: boolean;
  /**
   * agent 能经 OpenTelemetry 导出 OTLP traces。声明它,运行器就在每个沙箱起一个
   * 本机 OTLP 接收器,把端点经 ctx.telemetry 交给 agent;跑完把收到的 span 归一到
   * canonical GenAI semconv、挂到 EvalResult.trace,view 画成瀑布图。
   * **怎么把端点交给 CLI**(env / config 文件)由 agent 的 `tracing` 块声明(见 AgentTracing),
   * 与「装 CLI / 写主配置」的 setup 分开。
   */
  tracing?: boolean;
}

/**
 * 本次运行的 OTLP traces 接收信息(仅当 agent 声明 capabilities.tracing 时有)。
 * 经 ctx.telemetry 交给 agent。
 */
export interface Telemetry {
  /** 接收端点(完整路径,形如 http://host.docker.internal:PORT/v1/traces)。 */
  readonly endpoint: string;
  /**
   * env-based 导出的 env(= AgentTracing.env(endpoint) 的结果),ready-to-spread。
   * adapter 的 send 直接 `{ ...ctx.telemetry?.env }` 注入,不必手搓 OTEL_* 拼装。
   */
  readonly env?: Readonly<Record<string, string>>;
}

/**
 * agent 的 OTLP 导出配置 —— 「沙箱里怎么让这个 CLI 把 trace 发到 endpoint」。
 * 刻意从 setup 里拆出来:setup 管装 CLI / 写主配置,这里只管 otel 导出。两种投递方式
 * (互不排斥,按 CLI 而定):
 *   · env-based(标准 OTEL_* 环境变量,如 bub/Python OTel SDK)—— 用 `env`;
 *   · file-based(CLI 自有配置文件,如 codex 的 config.toml [otel] 块)—— 用 `configure`。
 */
export interface AgentTracing {
  /**
   * 线协议(codex 发 OTLP/JSON、bub 发 OTLP/protobuf)。接收器按 content-type 自动解码,
   * 此字段仅作声明/日志用,也为将来按协议分流留口。
   */
  protocol?: "http/json" | "http/protobuf";
  /**
   * env-based 导出:给 endpoint → 返回要注入每轮 send 的 env(纯函数)。运行器把结果
   * 放进 ctx.telemetry.env,send 直接 spread。
   */
  env?(endpoint: string): Record<string, string>;
  /**
   * file-based 导出:给 sandbox + ctx(ctx.telemetry.endpoint 必有),自己写 / 追加配置文件。
   * 运行器在 agent.setup 之后、首次 send 之前调一次(仅当 tracing 开 + 有 endpoint)。
   * 注:codex 的 [otel.trace_exporter.otlp-http] 是子表,configure 在 setup 写完主配置后
   * 追加到 config.toml 末尾,天然满足「子表在所有上层表之后」。
   */
  configure?(sandbox: Sandbox, ctx: AgentContext): Promise<void> | void;
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
  /**
   * 仅当 agent 声明 capabilities.tracing 时有:本次运行的 OTLP traces 接收信息
   *(endpoint + env-based 导出 env)。怎么把它交给 CLI 由 agent 的 `tracing` 块声明:
   * env-based 的把 ctx.telemetry.env spread 进 send;file-based 的在 tracing.configure 里写配置。
   */
  readonly telemetry?: Telemetry;
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
  readonly capabilities: AgentCapabilities;
  setup?: AgentSetup;
  /** OTLP 导出配置(仅 capabilities.tracing 时有意义);与 setup 分开,见 AgentTracing。 */
  tracing?: AgentTracing;
  send(input: TurnInput, ctx: AgentContext): Promise<Turn>;
  teardown?: AgentTeardown;
}

export interface SandboxAgentDef {
  name: string;
  capabilities?: AgentCapabilities;
  /** 每个沙箱一次:装 CLI、写 config.toml / 鉴权配置。 */
  setup?: AgentSetup;
  /** OTLP 导出配置:沙箱里怎么让 CLI 把 trace 发到 endpoint(env / 配置文件),从 setup 拆出。 */
  tracing?: AgentTracing;
  /** 每轮一次:跑 prompt(fresh / resume)+ 解析成 events。 */
  send(input: TurnInput, ctx: AgentContext): Promise<Turn>;
  teardown?: AgentTeardown;
}

export interface RemoteAgentDef {
  name: string;
  capabilities?: AgentCapabilities;
  setup?: AgentSetup;
  tracing?: AgentTracing;
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

/** 一个源码文件:相对工作区根的路径 + 文本内容。readSourceFiles 的返回元素。 */
export interface SourceFile {
  path: string;
  content: string;
}

/**
 * readSourceFiles 的返回值:仍是一个 SourceFile 数组(.filter/.some/.map 照用),
 * 额外挂上整体匹配 / 按文件匹配的便利方法,省掉 eval 目录里手写的 source-helpers。
 */
export interface SourceFiles extends ReadonlyArray<SourceFile> {
  /** 全部文件内容拼接(每段前带 `// path` 注释),用于整体 regex。 */
  text(): string;
  /** 同 text() 但先剥注释,只看真实代码。 */
  code(): string;
  /** 第一个内容命中 pattern 的文件。 */
  fileMatching(pattern: RegExp): SourceFile | undefined;
  /** 第一个内容命中全部 patterns 的文件(同文件共现,per-file 而非拼接源码)。 */
  fileMatchingAll(patterns: RegExp[]): SourceFile | undefined;
  /** 是否存在路径命中 pattern 的文件。 */
  hasPath(pattern: RegExp): boolean;
}

/** readSourceFiles 的可选项;不传则用一套合理默认。 */
export interface ReadSourceFilesOptions {
  /** 文件扩展名(不带点)。默认 ts/tsx/js/jsx。 */
  extensions?: string[];
  /** 按目录名(任意深度)剪枝。默认 .git/.next/node_modules/dist/build/coverage。 */
  ignoreDirs?: string[];
  /** 按文件 basename 忽略。默认 EVAL.ts/PROMPT.md。 */
  ignoreFiles?: string[];
}

export type SandboxBackend = "docker" | "vercel" | "e2b" | "auto" | string;

/** 镜像/模板里的 Node 运行时版本。 */
export type SandboxRuntime = "node20" | "node24";

/**
 * Sandbox 的「数据结构」定义 —— 与 agent 一样可带参数(见 docs/sandbox.md)。
 * 用工厂函数构造(`dockerSandbox()` / `vercelSandbox()` / `e2bSandbox()`),
 * 放进 config / experiment 的 `sandbox` 字段;字符串后端名(`"docker"` 等)仍兼容。
 * 各后端的参数互不相同 —— 这是个按 `backend` 区分的可辨识联合(discriminated union)。
 */
export interface DockerSandboxSpec {
  readonly backend: "docker";
  /** 覆盖默认镜像;默认按 runtime 选 `node:*-slim`。预制模板:传烘焙好 agent CLI 的镜像名。 */
  readonly image?: string;
  readonly runtime?: SandboxRuntime;
}
export interface VercelSandboxSpec {
  readonly backend: "vercel";
  /** 从已有快照起 microVM。预制模板:烘焙好 agent CLI 的 snapshotId。 */
  readonly snapshotId?: string;
  readonly runtime?: SandboxRuntime;
}
export interface E2BSandboxSpec {
  readonly backend: "e2b";
  /** e2b 模板名/ID。预制模板:烘焙好 agent CLI 的模板(如 `"niceeval-agents"`)。省略用 e2b 默认 `"base"`。 */
  readonly template?: string;
  /** 仅作记录;e2b 的 node 版本由模板决定,不在创建时选。 */
  readonly runtime?: SandboxRuntime;
}
/**
 * 用户自定义后端:`create` 直接产出一个 `Sandbox` 实例,不经 resolve.ts 的内置 backend switch。
 * 用 `defineSandbox()` 构造(见 src/define.ts)。`backend` 只用于展示 / 日志,不参与分发。
 */
export interface CustomSandboxSpec {
  readonly backend: string;
  readonly runtime?: SandboxRuntime;
  readonly recommendedConcurrency?: number;
  readonly create: (opts: { timeout?: number; runtime?: SandboxRuntime }) => Promise<Sandbox>;
}

export type SandboxSpec = DockerSandboxSpec | VercelSandboxSpec | E2BSandboxSpec | CustomSandboxSpec;

/** config / experiment 的 `sandbox` 字段:后端名(字符串)或带参数的 spec 数据结构。 */
export type SandboxOption = SandboxBackend | SandboxSpec;

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
  /**
   * 以 root 跑本命令。默认 `false` —— 命令以沙箱的标准**非 root** 用户跑(agent 的自然环境)。
   * 给 setup 阶段装系统依赖用(`apt-get install …`、`pip install --break-system-packages …`)。
   *
   * 语义跨后端一致:"本命令以 root 跑,否则以标准非 root 用户跑"。各后端映射到自己的原生机制
   * (docker:`exec --user root`;E2B:`{ user: "root" }`;Vercel:`{ sudo: true }`;Daytona:`{ user }`)。
   * 本就全程 root 的后端(如 Modal)视作 no-op;完全无法提权的后端可不支持(抛错)—— 但**默认值与
   * 语义保持一致**,不因后端而变。
   */
  root?: boolean;
}

export interface Sandbox {
  readonly workdir: string;
  runCommand(cmd: string, args?: string[], opts?: CommandOptions): Promise<CommandResult>;
  runShell(script: string, opts?: CommandOptions): Promise<CommandResult>;
  readFile(path: string): Promise<string>;
  fileExists(path: string): Promise<boolean>;
  /**
   * 一次 shell 往返读全部源码文件(按扩展名收、按目录/文件名忽略)。
   * 取代每个 eval 目录里手写的 find + 逐文件 readFile。
   */
  readSourceFiles(opts?: ReadSourceFilesOptions): Promise<SourceFiles>;
  writeFiles(files: Record<string, string>, targetDir?: string): Promise<void>;
  uploadFiles(files: SandboxFile[], targetDir?: string): Promise<void>;
  uploadDirectory(localDir: string, targetDir?: string, opts?: { ignore?: string[] }): Promise<void>;
  stop(): Promise<void>;
  readonly sandboxId: string;
  /**
   * 本地 OTLP 接收器的目标 host。
   * - `string`:沙箱内可通过该 hostname 回连宿主 OTLP 端口(如 docker 的 `host.docker.internal`)。
   * - `null`:沙箱运行在远程云端(如 e2b/vercel),无法访问宿主本地端口 → 跳过 tracing。
   *   可通过环境变量 `NICEEVAL_OTLP_HOST` 强制覆盖(如配置 tunnel 时)。
   */
  readonly otlpHost: string | null;

  /**
   * 可选:把一行写进容器的「主日志」(PID1 在 tail 它)——于是 `docker logs` /
   * Docker UI 的 Logs 标签页能实时看到 agent 逐轮活动。docker 后端实现,其它可省略。
   */
  appendLog?(line: string): Promise<void>;

  /**
   * 从沙箱内任意路径读取文件,返回二进制 Buffer。
   * 对应各 backend:Docker getArchive / Vercel readFileToBuffer / e2b files.read(bytes) / …
   */
  downloadFile(path: string): Promise<Buffer>;

  /**
   * 向沙箱内任意路径写入文件(二进制)。
   * 对应各 backend:Docker putArchive / Vercel fs.writeFile(Buffer) / e2b files.write / …
   */
  uploadFile(path: string, content: Buffer): Promise<void>;
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
}

// ───────────────────────── 评分 / 断言 ─────────────────────────

/** 值级断言(expect 匹配器)。纯函数 score + 可链式改严重级 / 阈值。 */
export interface ValueAssertion {
  readonly name: string;
  readonly severity: Severity;
  readonly threshold?: number;
  score(value: unknown): number | Promise<number>;
  gate(threshold?: number): ValueAssertion;
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
  /** 这条分数是看着什么材料算出来的(judge 收到的输入)。view 展开排查「为什么是这个分」,默认不展示。 */
  evidence?: string;
  /** 所属分组(t.group 标题)。纯报告用,不影响 passed/score。 */
  group?: string;
  /** 断言在 eval 源码里的调用点(栈回溯抠出);view 把判决叠回这一行。 */
  loc?: SourceLoc;
}

/** eval 作者拿到的可链式句柄(t.judge.autoevals.closedQA(...).atLeast(0.7))。 */
export interface AssertionHandle {
  atLeast(threshold: number): AssertionHandle;
  gate(threshold?: number): AssertionHandle;
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

export type ResultOutcome = "passed" | "failed" | "errored" | "skipped";

// ───────────────────────── Judge ─────────────────────────

export interface JudgeConfig {
  model: string;
  /** OpenAI 兼容 base url + key 来源;省略则从 env 探测(见 scoring/judge.ts)。 */
  baseUrl?: string;
  apiKeyEnv?: string;
}

// ───────────────────────── 价格 / 报告 ─────────────────────────

export interface ExperimentRunInfo {
  id?: string;
  flags?: Record<string, unknown>;
  runs?: number;
  earlyExit?: boolean;
  sandbox?: string;
  timeoutMs?: number;
  budget?: number;
}

export interface EvalResult {
  id: string;
  description?: string;
  experimentId?: string;
  experiment?: ExperimentRunInfo;
  agent: string;
  model?: string;
  outcome: ResultOutcome;
  fingerprint?: string;
  attempt: number;
  /** 本 attempt 开始的墙钟时刻(ISO);view 按 eval 粒度展示「何时跑的」。 */
  startedAt?: string;
  durationMs: number;
  assertions: AssertionResult[];
  usage?: Usage;
  estimatedCostUSD?: number;
  error?: string;
  skipReason?: string;
  events?: StreamEvent[];
  /** test 引用到的 eval 源码(按 loc 收集),供 view 渲染 github-diff 式代码视图。 */
  sources?: SourceArtifact[];
  o11y?: O11ySummary;
  /** agent 经 OpenTelemetry 导出的运行追踪(有 tracing 能力且收到 span 时)。 */
  trace?: TraceSpan[];
  diff?: DiffData;
  rawTranscript?: string;
  // ── 拆分工件的引用(Artifacts 报告器写 summary.json 时填;view 按需懒加载)──
  /** 本 attempt 工件目录(相对 run 根),下有 events/trace/o11y/diff.json。 */
  artifactsDir?: string;
  /** view 拼好的工件目录(相对 view 输入根,供前端 fetch);loadSummaries 注入。 */
  artifactBase?: string;
  /** 工件目录的绝对路径;loadSummaries 注入,供复制/展示用。 */
  artifactAbsBase?: string;
  hasTrace?: boolean;
  hasEvents?: boolean;
  hasSources?: boolean;
}

/**
 * 可本地化文案:纯字符串,或按 locale 代码(如 "en"、"zh-CN")映射多语言。
 * view 按当前界面语言挑一条,挑不到回退到 en / 第一条。
 */
export type LocalizedText = string | Record<string, string>;

export interface RunSummary {
  /** 项目名(来自 config.name),透传给 `niceeval view` 顶部 hero 显示。 */
  name?: LocalizedText;
  agent: string;
  model?: string;
  startedAt: string;
  completedAt: string;
  passed: number;
  /** 断言不通过的数量;不包含 errored。 */
  failed: number;
  skipped: number;
  /** 环境、超时、adapter、agent runtime 等执行错误数量;与 failed 互斥。 */
  errored: number;
  durationMs: number;
  usage?: Usage;
  estimatedCostUSD?: number;
  results: EvalResult[];
  outputDir?: string;
}

/** onRunStart 的运行规模:去重后 eval 数 × 配置(agent×model×flags)数 → 总运行(attempt)数。 */
export interface RunShape {
  /** 去重后实际要跑的 eval 数(= evals.length)。 */
  evals: number;
  /** (agent, model, flags) 配置组合数;compare 多 agent 时 > 1。 */
  configs: number;
  /** 总 attempt 数(evals × configs × runs);逐行输出与汇总计数都按它。 */
  totalRuns: number;
}

export interface Reporter {
  onEvent?(event: ReporterEvent): void | Promise<void>;
  onRunStart?(evals: { id: string }[], agent: Agent, shape?: RunShape): void | Promise<void>;
  onEvalComplete?(result: EvalResult): void | Promise<void>;
  onRunComplete?(summary: RunSummary): void | Promise<void>;
}

export type ReporterEvent =
  | { type: "run:start"; evals: { id: string }[]; agent: Agent; shape: RunShape }
  | { type: "eval:start"; eval: { id: string }; agent: Agent; attempt: number; experimentId?: string }
  | { type: "eval:complete"; result: EvalResult }
  | { type: "run:earlyExit"; evalId: string; experimentId?: string }
  | { type: "run:budgetExceeded"; budget: number; spent: number }
  | { type: "run:saved"; summary: RunSummary }
  | { type: "run:summary"; summary: RunSummary };

// ───────────────────────── 生命周期 ─────────────────────────

export type Cleanup = () => Promise<void> | void;

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
  /**
   * eval 级预置:拿到沙箱(已上传 workspace + git 基线 + 装好依赖前)。
   * 默认命令以非 root 跑(agent 的自然环境);装系统依赖时给 `runCommand` 传 `{ root: true }`
   * (如 `runCommand("apt-get", ["install", …], { root: true })`),跨后端语义一致。
   */
  setup?: (sandbox: Sandbox) => Promise<void | Cleanup> | void | Cleanup;
  test(t: TestContext): Promise<void> | void;
}

/** 内部:发现后带上 id 的 eval。 */
export interface DiscoveredEval extends EvalDef {
  id: string;
  /** 定义文件所在目录(解析相对 workspace 用)。 */
  baseDir: string;
  /** 定义文件绝对路径,用于内容指纹缓存。 */
  sourcePath: string;
}

export interface ExperimentDef {
  id?: string;
  description?: string;
  agent: Agent;
  /** 单个模型(agent 留空时实验决定);省略=用 agent 原生默认。跨模型对比写多个实验文件,别用数组。 */
  model?: string;
  flags?: Record<string, unknown>;
  runs?: number;
  earlyExit?: boolean;
  evals?: "*" | string[] | ((id: string) => boolean);
  timeoutMs?: number;
  sandbox?: SandboxOption;
  budget?: number;
  maxConcurrency?: number;
}

export interface DiscoveredExperiment extends ExperimentDef {
  id: string;
  group: string;
}

export interface Config {
  /**
   * 项目名,显示在 `niceeval view` 顶部 hero(`<h1>`),省略则回退到通用标题。
   * 可传字符串,或按 locale 提供多语言(如 `{ en: "...", "zh-CN": "..." }`),随 view 语言切换。
   */
  name?: LocalizedText;
  sandbox?: SandboxOption;
  workspace?: string;
  judge?: JudgeConfig;
  reporters?: Reporter[];
  maxConcurrency?: number;
  timeoutMs?: number;
}

// ───────────────────────── TestContext(t)与子句柄 ─────────────────────────

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
  calledTool(name: string, match?: ToolMatch): AssertionHandle;
  notCalledTool(name: string, match?: ToolMatch): AssertionHandle;
  toolOrder(names: string[]): AssertionHandle;
  usedNoTools(): AssertionHandle;
  maxToolCalls(max: number): AssertionHandle;
  event(type: StreamEvent["type"], opts?: { count?: number }): AssertionHandle;
  notEvent(type: StreamEvent["type"]): AssertionHandle;
  calledSubagent(name: string, match?: SubagentMatch): AssertionHandle;
  eventOrder(types: StreamEvent["type"][]): AssertionHandle;
  eventsSatisfy(predicate: (events: readonly StreamEvent[]) => boolean, label?: string): AssertionHandle;
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

export interface SessionHandle {
  send(text: string): Promise<TurnHandle>;
  sendFile(path: string, text?: string): Promise<TurnHandle>;
  requireInputRequest(filter?: InputRequestFilter): InputRequest;
  respond(...responses: string[]): Promise<TurnHandle>;
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
  respond(...responses: string[]): Promise<TurnHandle>;
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
  file(path: string): string;
  fileChanged(path: string): AssertionHandle;
  fileDeleted(path: string): AssertionHandle;
  notInDiff(re: RegExp): AssertionHandle;
  noFailedShellCommands(): AssertionHandle;

  // 效率 / 成本
  readonly usage: Usage;
  maxTokens(max: number): AssertionHandle;
  maxCost(usd: number): AssertionHandle;

  // judge
  readonly judge: JudgeNamespace;
}
