// agent 域类型:Agent / Adapter 契约、能力位、会话与 tracing 导出配置。
// 「连到哪个被测对象、协议怎么说」的全部契约在这里(见 docs/adapters/contract.md)。

import type { Cleanup } from "../shared/types.ts";
import type { StreamEvent, TraceSpan, Usage } from "../o11y/types.ts";
import type { Sandbox } from "../sandbox/types.ts";
import type { OtelEventsSource } from "./otel-events.ts";

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
   * 声明了 `events: otelEvents()` 的 agent 自动按 "run" 处理(无侵入接入的长驻服务场景)。
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

/**
 * 本 agent 的原生 OTLP span → canonical GenAI semconv 的薄 mapper。
 * 由 adapter 声明(和 tracing.env 一样属于「连到谁」的特殊性),core 只调接口——
 * 省略时 core 走通用 heuristic 兜底,不按 agent 名字分支。
 */
export type SpanMapper = (spans: TraceSpan[]) => TraceSpan[];

/** 注册表里的 agent(defineAgent / defineSandboxAgent 产出)。 */
export interface Agent {
  readonly name: string;
  readonly capabilities: AgentCapabilities;
  setup?: AgentSetup;
  /** OTLP 导出配置(仅 capabilities.tracing 时有意义);与 setup 分开,见 AgentTracing。 */
  tracing?: AgentTracing;
  /** 原生 span → canonical 的薄 mapper;省略走通用 heuristic。 */
  spanMapper?: SpanMapper;
  /** 事件来源声明:`otelEvents()` = 事件流从本轮收到的 span 派生,send 免写映射。 */
  events?: OtelEventsSource;
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
  spanMapper?: SpanMapper;
  /** 每轮一次:跑 prompt(fresh / resume)+ 解析成 events。 */
  send(input: TurnInput, ctx: AgentContext): Promise<Turn>;
  teardown?: AgentTeardown;
}

export interface RemoteAgentDef {
  name: string;
  capabilities?: AgentCapabilities;
  setup?: AgentSetup;
  tracing?: AgentTracing;
  spanMapper?: SpanMapper;
  /** 事件来源声明:`otelEvents()` = 事件流从本轮收到的 span 派生,send 免写映射。 */
  events?: OtelEventsSource;
  send(input: TurnInput, ctx: AgentContext): Promise<Turn>;
  teardown?: AgentTeardown;
}
