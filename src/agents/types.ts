// agent 域类型:Agent / Adapter 契约、会话与 tracing 导出配置。
// 「连到哪个被测对象、协议怎么说」的全部契约在这里(见 docs-site/zh/explanation/adapter.mdx)。
// 能力不再是问卷式声明:t 上解锁什么完全由构造证据决定(见 docs-site 「能力从哪来」一节)。

import type { DiagnosticInput, ProgressUpdate } from "../shared/types.ts";
import type { StreamEvent, TraceSpan, Usage } from "../o11y/types.ts";
import type { Sandbox } from "../sandbox/types.ts";

/**
 * 本地 stdio 形态的 MCP server:沙箱内起子进程,按 stdio 说 MCP 协议。
 * 与 {@link McpHttpServer} 按形状判别(有 `command` 的是 stdio,有 `url` 的是 HTTP)。
 */
export interface McpStdioServer {
  /** 服务器唯一名(config key)。 */
  name: string;
  /** 启动命令(如 "npx"、"node"、"uvx")。 */
  command: string;
  /** 传给命令的参数。 */
  args?: string[];
  /** 注入服务器进程的环境变量(可能含 secret,不进 manifest)。 */
  env?: Record<string, string>;
}

/**
 * 远程 Streamable HTTP 形态的 MCP server:沙箱直接连一个 HTTP 端点。
 * `url` 必须沙箱内可达——宿主机上的服务先经隧道(cloudflared / tailscale 等)暴露。
 */
export interface McpHttpServer {
  /** 服务器唯一名(config key)。 */
  name: string;
  /** Streamable HTTP 端点(如 https://mem.example.com/mcp/)。 */
  url: string;
  /** 逐字写进每个请求的 HTTP 头(常用于 Authorization;可能含 secret,不进 manifest)。 */
  headers?: Record<string, string>;
}

/**
 * MCP server 描述符 —— 支持 MCP 的 adapter(Claude Code / Codex)共用的工具服务单元,
 * 不是 native plugin 的一种。stdio 与 Streamable HTTP 两种形态按形状判别,不设 kind 标签
 * (两种形态各有唯一必填判别字段);同时给出 `command` 与 `url` 属配置错误,setup 报错点名。
 * 在 agent factory config 里声明,setup 阶段写进各自的配置文件。
 * 见 docs/feature/adapters/architecture/coding-agent-extensions.md「类型边界」。
 */
export type McpServer = McpStdioServer | McpHttpServer;

/**
 * Skill 的来源描述 —— Claude Code / Codex / Bub 共用的**数据类型**:只统一「从哪里取得
 * 哪份 Skill」,安装位置、发现机制、要不要额外写 project instruction 由各 Adapter 决定。
 * 见 docs/feature/adapters/architecture/coding-agent-extensions.md「类型边界」。
 */
export type SkillSpec =
  | {
      kind: "local";
      /** 相对项目根(跑 niceeval 的目录)的 Skill 文件或目录:`SKILL.md`、含 `SKILL.md` 的目录,或单个 `.md`。 */
      path: string;
      /** 展示名;省略时由文件或目录名推导(`<dir>/SKILL.md` → `<dir>`,`foo.md` → `foo`)。 */
      name?: string;
    }
  | {
      kind: "repo";
      /** GitHub `owner/repo` 或 Git URL。 */
      source: string;
      /** 多 Skill Repo 中要启用的 Skill;repo 只有一个 Skill 时可省略,多个时省略即 setup 失败。 */
      skills?: string[];
      /** Tag、Commit 或 Branch;省略表示 repo 默认 ref。 */
      ref?: string;
    };

/** Manifest 里的一条 Skill 安装记录:本地(带内容哈希)或 repo(带来源与 ref)。 */
export type AgentSetupSkill =
  | { kind: "local"; name: string; path: string; sha256: string }
  | { kind: "repo"; source: string; ref?: string; skills: string[] };

/**
 * 一次 Agent setup 实际装了什么 —— 沙箱型 Coding Agent Adapter 在 setup 收尾写出的安装清单。
 * 沙箱内落在 `__niceeval__/agent-setup.json`,运行器把它作为 attempt artifact 存成
 * `agent-setup.json`(见 docs/feature/results/architecture.md)。不参与评分,只回答「这次实际
 * 装了什么」;**环境变量值与 secret 不写进来**(所以 mcpServers 只记 name/command/args)。
 */
export interface AgentSetupManifest {
  /** 装进去的 Skill(按配置顺序;同名来自多个来源时逐条保留,不静默合并)。 */
  skills: AgentSetupSkill[];
  /** Agent 原生 Plugin(Claude Code / Codex 各自的 Marketplace 协议)。 */
  nativePlugins?: Array<{
    agent: "claude-code" | "codex";
    marketplace: { name: string; source: string; ref?: string };
    name: string;
    /** 安装后 CLI 报告的版本;取不到时省略。 */
    resolvedVersion?: string;
  }>;
  /** 挂上的 MCP server(只记非 secret 字段:stdio 不含 env,HTTP 不含 headers)。 */
  mcpServers?: Array<{ name: string; command: string; args?: string[] } | { name: string; url: string }>;
  /**
   * 官方原生配置文件(Claude Code `settings.json` / Codex `config.toml`):只记 Agent 名、
   * 项目相对来源路径与原始字节的 SHA-256,不落正文 —— 任意官方配置都可能携带敏感字符串,
   * 不能靠字段白名单证明适合原样落盘。
   */
  nativeConfigFile?: { agent: "claude-code" | "codex"; path: string; sha256: string };
  /** Bub 的 Python Plugin(规范化后的 package 串)。 */
  pythonPlugins?: Array<{ package: string }>;
}

// ───────────────────────── 证据覆盖声明 ─────────────────────────

/** 证据通道的覆盖状态。省略(不声明)= unknown,不是 complete——消费侧与 unavailable 同样保守。 */
export type CoverageStatus = "complete" | "partial" | "unavailable";

/** 单个证据通道的覆盖声明:状态 + 可选的人可读原因(如 "stream reconnected mid-turn")。 */
export interface CoverageDeclaration {
  status: CoverageStatus;
  reason?: string;
}

/**
 * 覆盖声明(EvidenceCoverage):完整性不是口头承诺,是随数据走的声明
 * (见 docs/feature/adapters/architecture/evidence.md)。两层:
 * - Agent 级默认(`defineAgent` / `defineSandboxAgent` 的 `coverage`)声明该 Adapter 的常态覆盖;
 *   官方 SDK 适配器显式声明全通道 complete(用 `completeCoverage` 常量)。
 * - Turn 级降级(`Turn.coverage`)只用于相对 Agent 默认值降级(这一轮流断了 / 拿不到 usage),
 *   不能把 Agent 未声明的通道升格成 complete。
 * 整个 Agent 不声明时全部通道视为 unknown。
 */
export interface EvidenceCoverage {
  /** 完整事件流(event / notEvent / order 的依据)。 */
  events?: CoverageDeclaration;
  /** action 生命周期(工具正负断言、顺序、失败的依据)。 */
  actions?: CoverageDeclaration;
  /** assistant / user message(reply、messageIncludes 的依据)。 */
  messages?: CoverageDeclaration;
  /** usage(token / cost 上限断言的依据)。 */
  usage?: CoverageDeclaration;
  /** Turn status 的真实性(succeeded / parked 的依据)——恒 completed 的映射必须声明非 complete。 */
  status?: CoverageDeclaration;
  /** Turn.data(outputEquals / outputMatches 的依据)。 */
  data?: CoverageDeclaration;
}

/** 随一轮消息附带的文件(图片等多模态输入)。 */
export interface InputFile {
  /** 文件名(可选,供 adapter / 模型参考)。 */
  readonly filename?: string;
  /** MIME 类型,如 `image/png`、`image/jpeg`。 */
  readonly mimeType: string;
  /** base64 编码的文件内容(JSON 友好,remote adapter 可直接放进请求体)。 */
  readonly dataBase64: string;
}

/**
 * HITL 回答轮里,人的裁决以结构化形式随 `input.responses` 到达——adapter 不需要解析
 * `text` 去猜哪句回答对应哪个请求、算不算批准。见 docs-site/zh/explanation/adapter.mdx
 * 「不同回答的入参」一节的四种典型形态。
 */
export interface InputResponse {
  /** 对应哪条 input.requested 请求;多个请求并停时靠它对位。 */
  readonly requestId: string;
  /** 与 text 二选一:回答命中了请求 options 里的某个 id(approve / deny…)。 */
  readonly optionId?: string;
  /** 与 optionId 二选一:自由文本回答(请求没有选项,或回答不是任何选项)。 */
  readonly text?: string;
}

export interface TurnInput {
  readonly text: string;
  /** 本轮附带的文件(图片等)。adapter 自行决定怎么投递;不支持多模态的 adapter 忽略它。 */
  readonly files?: readonly InputFile[];
  /** 仅回答轮(t.respond / t.respondAll):逐请求的结构化回答,按 requestId 对位。 */
  readonly responses?: readonly InputResponse[];
}

/** adapter 的 send 返回值(事件流为核心)。 */
export interface Turn {
  readonly events: StreamEvent[];
  readonly data?: unknown;
  readonly status: "completed" | "failed" | "waiting";
  readonly usage?: Usage;
  /**
   * 本轮相对 Agent 默认覆盖的降级声明(这一轮流断了、拿不到 usage 等);
   * 只能降级,不能把 Agent 未声明的通道升格成 complete(见 EvidenceCoverage)。
   */
  readonly coverage?: EvidenceCoverage;
}

/**
 * 本次运行的 OTLP traces 接收信息(仅当配置了 OTel 接入时有——agent 的 `tracing` 块 /
 * config 的 telemetry 存在)。经 ctx.telemetry 交给 agent。span 只进瀑布图,不喂断言。
 * 远程 HTTP 接入的 send 只需要 spread `headers`(每轮一个新 traceparent);接收端点是
 * 启动期配置(`defineConfig({ telemetry: { port } } )`)固定的,不从这里传。
 */
export interface Telemetry {
  /** 接收端点(完整路径,形如 http://host.docker.internal:PORT/v1/traces)。 */
  readonly endpoint: string;
  /**
   * env-based 导出的 env(= AgentTracing.env(endpoint) 的结果),ready-to-spread。
   * adapter 的 send 直接 `{ ...ctx.telemetry?.env }` 注入,不必手搓 OTEL_* 拼装。
   */
  readonly env?: Readonly<Record<string, string>>;
  /**
   * 本轮的 W3C trace context(traceparent),每轮一个新值。send 把它 spread 进 HTTP 请求头
   * (或注入子进程 env)——应用埋点支持 context 传播时,本轮 span 挂到我们给的 trace 下,
   * 并发跑 eval 的 span 归属才精确;不带则回退时间窗口归属(该 agent 自动降为串行)。
   */
  readonly headers?: Readonly<Record<string, string>>;
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
   * 接收器粒度(仅非沙箱 agent;沙箱型每沙箱一个,与此无关):
   *   · "attempt"(默认)—— 每个 attempt 一个接收器。适合每轮能切换导出端点的被测对象
   *     (进程内 adapter,如内置 aiSdkAgent 的可切换 exporter),attempt 间天然隔离、可全并发。
   *   · "run" —— 整个 run 共享一个接收器(每 agent 一个)。**长驻服务必选**:应用的 OTEL_*
   *     env 进程启动时读一次,per-attempt 端口会在第一个 attempt 结束时失效。span 逐轮归属
   *     (traceparent / 时间窗口 + 串行守卫),见 ctx.telemetry.headers。
   * config 配了 `telemetry`(固定端口,无侵入接入的长驻服务场景)的非沙箱 agent 自动按 "run" 处理。
   */
  scope?: "attempt" | "run";
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

/**
 * 一条会话线。核心承诺只有一句:**同一条会话线的每次 send 拿到同一个 `ctx.session`,
 * 新会话线(eval 第一轮 / t.newSession() 之后)拿到一个全新的。**
 * 会话续接(`id`/`capture`、`history`)和 HITL 停轮现场(`hold`/`take`)的存取器都在它上面,
 * "第一轮"是新会话线的自然形态,没有要判断的分支;`state` 是这些存取器之外的逃生舱,
 * 框架从不往里写数据。见 docs-site/zh/explanation/adapter.mdx「AgentContext」一节。
 */
export interface AgentSession {
  /** 会话续接:服务端记历史。本线记过的会话 id;新会话线是 undefined。 */
  readonly id?: string;
  /** 记回传的会话 id;只在还没记过时落地(first-writer-wins),空值忽略。 */
  capture(id: string | undefined): void;
  /** 会话续接:客户端带全量历史。返回本会话线的历史槽句柄;新线 get() 是空数组。 */
  history<TMsg>(): { get(): TMsg[]; commit(messages: TMsg[]): void };
  /** HITL 停轮现场:存。 */
  hold<T>(state: T): void;
  /** HITL 停轮现场:取,取到即清除(一次消费)。 */
  take<T>(): T | undefined;
  /** 逃生舱:自由状态槽,起始 `{}`,框架从不写入。 */
  readonly state: Record<string, unknown>;
}

export interface AgentContext {
  /**
   * 软取消信号:合并了 attempt 超时、run 级中断(用户 Ctrl+C)与评估用例自身的中断请求
   * (见 src/runner/attempt.ts)。adapter 可以选择性检查它(或直接传给 `fetch`)以提前
   * 优雅退出,但这不是唯一的硬边界——即便 adapter 完全忽略它,运行器也会用
   * `Effect.timeoutTo` 兜底强制收尾(停 Sandbox 容器)。
   */
  readonly signal: AbortSignal;
  /** 本次 attempt 用的模型名,透传自 experiment 的 `model` 字段。sandbox 型 agent 通常在 setup 里用它写配置,remote 型通常在 send 里用它选模型。 */
  readonly model?: string;
  /** 模型推理努力程度;归属同 model——实验决定,省略时不覆盖 agent 原生默认。 */
  readonly reasoningEffort?: string;
  /**
   * experiment 的 `flags` 字段原样透传,内容和结构完全由 experiment 作者自定义
   * (如 `{ webResearch: true }`、`{ systemPrompt: "..." }`)。adapter 按自己的约定
   * 读取其中的字段;框架本身不解释、不校验它的内容。命名特意避开 CLI 解析出的
   * `flag`(跑法层面的 --timeout/--budget 等),两者是不相关的概念。
   */
  readonly flags: Readonly<Record<string, unknown>>;
  /**
   * 路径推导出的实验 id(与结果归属 `runWho` / `AgentRun.experimentId` 同源);不经
   * experiment 跑(如脱离 CLI、直接构造 `AgentRun` 的场景)时为 undefined。典型用途:
   * `SandboxSpec.setup` Hook 按实验隔离跨 attempt 的状态(缓存目录名、快照 tag 等按
   * `ctx.experimentId` 分区),或 adapter 按实验切换鉴权 / 路由。与 `flags`(实验条件的
   * 具体取值)是两个维度——这里只是「跑的是哪个实验」的稳定标识,不携带条件内容。
   */
  readonly experimentId?: string;
  /**
   * 所有 agent 都有:Sandbox 型是运行器按项目/experiment 配置备好的真实 Sandbox 句柄,remote 型是
   * `createRemoteSandbox()` 产出的 stub(仅含 `workdir`/`sandboxId`/`otlpHost`/`stop` 等
   * 元信息,其余方法调用即抛错)。
   */
  readonly sandbox: Sandbox;
  readonly session: AgentSession;
  /**
   * 仅当配置了 OTel 接入时有(agent 的 `tracing` 块 / config 的 telemetry 存在):
   * 本次运行的 OTLP traces 接收信息(endpoint + env-based 导出 env)。
   * 怎么把它交给 CLI 由 agent 的 `tracing` 块声明:env-based 的把 ctx.telemetry.env
   * spread 进 send;file-based 的在 tracing.configure 里写配置。远程 HTTP 接入的 send
   * 只需要把 headers spread 进请求头(每轮一个新 traceparent);端点是启动期配置
   * (defineConfig({ telemetry: { port } }))固定的,不从这里传。
   */
  readonly telemetry?: Telemetry;
  /**
   * 作用域反馈:报告此刻正在做什么(turn / tool / 安装进度)。短命状态——Human profile
   * 更新 active 行,`agent`/`ci` 不逐条打印,也不进最终结果;不要每个 token/delta 都调用。
   * runner 按当前回调所处的生命周期阶段(agent.setup / agent.run / agent.teardown)归因,
   * 调用方不能冒充其它阶段(见 docs/feature/experiments/library.md)。
   */
  progress(update: ProgressUpdate): void;
  /**
   * 作用域反馈:报告运行结束后仍应保留的问题(协议降级、数据不完整、cleanup 问题)。
   * 永久事件,落进 attempt 的 diagnostics 并进各 profile 的永久输出;`dedupeKey` 去重。
   * 即使 level 为 "error" 也不改变 Turn.status / verdict——无法继续时抛异常。
   */
  diagnostic(input: DiagnosticInput): void;
  /**
   * `progress({ message: msg })` 的别名,不是第二条通道(见 docs/feature/experiments/cli.md
   * 「Attempt 阶段」)。超时失败时最近若干行会并入结果的 error 信息,方便定位卡在哪一步。
   */
  log(msg: string): void;
}

/**
 * agent 自己的沙箱生命周期(每个沙箱一次,与「每轮 send」分开):
 * `setup` 装 CLI、写配置(model/base/auth 等本轮内不变的东西),`send` 只管把一轮 prompt
 * 跑起来(第一次 fresh / 后续 resume)+ 解析 transcript,`teardown` 清理。
 * 运行器在备好沙箱(上传 / 基线 / eval.setup)后、第一次 send 前调一次 `setup`,不返回值;
 * `teardown` 当且仅当本 attempt 走到过 `setup` 时点才执行(`setup` 抛错不豁免——半初始化
 * 的现场同样要扫尾),在 finally 里跑。要把 `setup` 里创建的句柄传给 `teardown`,以
 * `sandbox` 实例为键存取(同一个 Agent 实例服务并发 attempt,不要用实例字段或模块变量)。
 */
export type AgentSetup = (sandbox: Sandbox, ctx: AgentContext) => Promise<void> | void;
export type AgentTeardown = (sandbox: Sandbox, ctx: AgentContext) => Promise<void> | void;

/**
 * 本 agent 的原生 OTLP span → canonical GenAI semconv 的薄 mapper。
 * 由 adapter 声明(和 tracing.env 一样属于「连到谁」的特殊性),core 只调接口——
 * 省略时 core 走通用 heuristic 兜底,不按 agent 名字分支。
 */
export type SpanMapper = (spans: TraceSpan[]) => TraceSpan[];

/** 注册表里的 agent(defineAgent / defineSandboxAgent 产出)。 */
export interface Agent {
  readonly name: string;
  /**
   * 内部判别字段(用户不声明):`defineSandboxAgent` 恒设 "sandbox",`defineAgent` 恒设
   * "remote"。t 上的能力不再是问卷式声明,而是构造证据——sandbox 型才解锁
   * `t.sandbox`/`t.sandbox.fileChanged()` 等文件系统断言,见 docs-site「能力从哪来」一节。
   */
  readonly kind: "sandbox" | "remote";
  /** 该 Adapter 的常态证据覆盖声明;省略 = 全通道 unknown(见 EvidenceCoverage)。 */
  coverage?: EvidenceCoverage;
  setup?: AgentSetup;
  /** OTLP 导出配置(仅当此字段存在时运行器才为该 agent 开 OTLP 接收);与 setup 分开,见 AgentTracing。 */
  tracing?: AgentTracing;
  /** 原生 span → canonical 的薄 mapper;省略走通用 heuristic。只影响瀑布图。 */
  spanMapper?: SpanMapper;
  send(input: TurnInput, ctx: AgentContext): Promise<Turn>;
  teardown?: AgentTeardown;
}

/** `defineSandboxAgent()` 的入参形状(见 src/define.ts)——`kind: "sandbox"` 由 define 固定填入,不由用户声明。 */
export interface SandboxAgentDef {
  /** agent 的显示名/标识,原样进入 `Agent.name`——不是注册表查找 key,只用于展示、结果归属与去重指纹。 */
  name: string;
  /** 该 Adapter 的常态证据覆盖声明(完整采集的用 `completeCoverage` 常量);省略 = 全通道 unknown。 */
  coverage?: EvidenceCoverage;
  /**
   * 每个 Sandbox 一次(不是每轮一次):装 CLI、写 config.toml / 鉴权配置(model/base/auth 等
   * 本轮内不变的东西)。运行器在 Sandbox 备好(上传/基线/eval.setup 之后)、第一次 send 前
   * 调用一次,不返回值。
   */
  setup?: AgentSetup;
  /** OTLP 导出配置:Sandbox 里怎么让 CLI 把 trace 发到 endpoint(env / 配置文件),从 setup 拆出。 */
  tracing?: AgentTracing;
  /** 原生 span → canonical 的薄 mapper;省略走通用 heuristic。只影响瀑布图。 */
  spanMapper?: SpanMapper;
  /** 每轮一次:跑 prompt(fresh / resume)+ 解析成 events。 */
  send(input: TurnInput, ctx: AgentContext): Promise<Turn>;
  /** Sandbox 销毁前的清理,当且仅当本 attempt 走到过 `setup` 时点才执行(`setup` 抛错不豁免),
   * 在 finally 里跑一次。 */
  teardown?: AgentTeardown;
}

/** `defineAgent()` 的入参形状(见 src/define.ts)——`kind: "remote"` 由 define 固定填入,不由用户声明。 */
export interface RemoteAgentDef {
  /** agent 的显示名/标识,原样进入 `Agent.name`——不是注册表查找 key,只用于展示、结果归属与去重指纹。 */
  name: string;
  /** 该 Adapter 的常态证据覆盖声明(完整采集的用 `completeCoverage` 常量);省略 = 全通道 unknown。 */
  coverage?: EvidenceCoverage;
  /**
   * 每个 attempt 一次(remote agent 没有真实 Sandbox,运行器会传入一个仅含 `workdir`/`sandboxId`/
   * `otlpHost`/`stop` 等元信息的 stub `Sandbox`,其余方法调用即抛错——不要在这里调用
   * 文件/命令类 Sandbox 方法)。常用于建立连接、鉴权等一次性准备,不返回值。
   */
  setup?: AgentSetup;
  /** OTLP 导出配置:远程被测对象怎么把 trace 发到 endpoint(env-based 注入 / file-based 配置)。 */
  tracing?: AgentTracing;
  /** 原生 span → canonical 的薄 mapper;省略走通用 heuristic。只影响瀑布图。 */
  spanMapper?: SpanMapper;
  /** 每轮一次:把一轮 prompt 发给远程被测对象(HTTP/SDK 等),解析响应成 events。 */
  send(input: TurnInput, ctx: AgentContext): Promise<Turn>;
  /** 运行结束前的清理,当且仅当本 attempt 走到过 `setup` 时点才执行(`setup` 抛错不豁免),
   * 在 finally 里跑一次。 */
  teardown?: AgentTeardown;
}
