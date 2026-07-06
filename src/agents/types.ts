// agent 域类型:Agent / Adapter 契约、会话与 tracing 导出配置。
// 「连到哪个被测对象、协议怎么说」的全部契约在这里(见 docs-site/zh/concepts/adapter.mdx)。
// 能力不再是问卷式声明:t 上解锁什么完全由构造证据决定(见 docs-site 「能力从哪来」一节)。

import type { Cleanup } from "../shared/types.ts";
import type { StreamEvent, TraceSpan, Usage } from "../o11y/types.ts";
import type { Sandbox } from "../sandbox/types.ts";

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
 * `text` 去猜哪句回答对应哪个请求、算不算批准。见 docs-site/zh/concepts/adapter.mdx
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
 * 框架从不往里写数据。见 docs-site/zh/concepts/adapter.mdx「AgentContext」一节。
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
  readonly signal: AbortSignal;
  readonly model?: string;
  readonly flags: Readonly<Record<string, unknown>>;
  /** 仅沙箱型 agent 有(运行器按 --sandbox 备好)。 */
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
  setup?: AgentSetup;
  /** OTLP 导出配置(仅当此字段存在时运行器才为该 agent 开 OTLP 接收);与 setup 分开,见 AgentTracing。 */
  tracing?: AgentTracing;
  /** 原生 span → canonical 的薄 mapper;省略走通用 heuristic。只影响瀑布图。 */
  spanMapper?: SpanMapper;
  send(input: TurnInput, ctx: AgentContext): Promise<Turn>;
  teardown?: AgentTeardown;
}

export interface SandboxAgentDef {
  name: string;
  /** 每个沙箱一次:装 CLI、写 config.toml / 鉴权配置。 */
  setup?: AgentSetup;
  /** OTLP 导出配置:沙箱里怎么让 CLI 把 trace 发到 endpoint(env / 配置文件),从 setup 拆出。 */
  tracing?: AgentTracing;
  spanMapper?: SpanMapper;
  /** 每轮一次:跑 prompt(fresh / resume)+ 解析成 events。 */
  send(input: TurnInput, ctx: AgentContext): Promise<Turn>;
  teardown?: AgentTeardown;
}

export interface RemoteAgentDef {
  name: string;
  setup?: AgentSetup;
  tracing?: AgentTracing;
  spanMapper?: SpanMapper;
  send(input: TurnInput, ctx: AgentContext): Promise<Turn>;
  teardown?: AgentTeardown;
}
