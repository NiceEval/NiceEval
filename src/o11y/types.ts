// o11y 域类型:标准事件流(StreamEvent)、折叠事实(DerivedFacts)、
// OTLP trace(TraceSpan / SpanKind)与用量 / 摘要。

import type { JsonValue, SourceLoc } from "../shared/types.ts";

/**
 * 一次运行的 token 用量(沙箱型从 transcript/OTel span 的 `gen_ai.usage.*` 属性抠,remote 由
 * send 的 `Turn.usage` 直接返回)。每个字段只在协议真实提供该值时存在——原始协议没有 usage 时
 * 省略,不编造数值;不存在「默认 0」或「默认 1」的字段。三个输入侧桶恒互斥:相加才是送进模型的
 * 完整上下文量;把协议原生口径归一到互斥是 adapter 的落值义务——OpenAI 系报「含缓存的输入总量 +
 * 缓存命中子集」,落 inputTokens 前先扣掉子集(docs/feature/record/architecture.md#usage,
 * 各协议明细见 docs/feature/adapters/sdk/<name>/cost.md)。
 */
export interface Usage {
  /** 未命中缓存、按全价计费的输入 token;与两个 cache 桶互斥。 */
  inputTokens?: number;
  /** 输出(completion)token 数。 */
  outputTokens?: number;
  /** 从提示缓存命中的输入 token;独立计价桶,不包含在 inputTokens 里(省略表示该 agent 不上报此项)。 */
  cacheReadTokens?: number;
  /** 写入提示缓存的输入 token;独立计价桶,不包含在 inputTokens 里(省略表示该 agent 不上报此项)。 */
  cacheCreationTokens?: number;
  /** 推理(thinking)token 数,outputTokens 的已含明细,单列展示用;只在协议真实提供时存在。 */
  reasoningTokens?: number;
  /** 真实发生的模型请求数。协议不提供请求计数就省略,绝不写 1 凑数。 */
  requests?: number;
  /**
   * 网关/adapter 实测的真实美元成本(只能由 `Turn.usage.costUSD` 显式带回,从不从
   * token 用量或 OTel span 反推得到)。与顶层 `estimatedCostUSD`(价目表估算)是两个事实:
   * 存在时优先于按价格表(`defineConfig({ pricing })`)估算的成本——见 `estimateCost` 的
   * `usage.costUSD ?? estimateCost(...)` 兜底顺序。
   */
  costUSD?: number;
}

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

/** HITL 停轮请求的结构化描述,供 `t.requireInputRequest(filter)` / `t.respondAll` 按条件匹配。 */
export interface InputRequest {
  /** 请求的唯一标识;多个请求并停时,`InputResponse.requestId` 靠它对位。 */
  readonly id?: string;
  /** 模型提出的原始问题/文本(用于 `stringMatches` 过滤)。 */
  readonly prompt?: string;
  /** adapter 自定义的人类可读展示文案,与 `prompt` 二选一或并存,用于 UI/日志展示及过滤匹配。 */
  readonly display?: string;
  /** 请求关联的动作类型(如某个待批准的工具调用名),供过滤用。 */
  readonly action?: string;
  /** 请求携带的结构化输入(如待批准命令的参数)。 */
  readonly input?: JsonValue;
  /** 若请求提供了预设选项(如批准/拒绝),逐项列出;`id` 对应 `InputResponse.optionId`。 */
  readonly options?: readonly { id: string; label?: string }[];
}

/**
 * 落盘截断的结构化标记(见 docs/feature/record/architecture.md「大值截断」):
 * `path` 是被截断的位置(事件里是字段名,如 "output";span 里是 attribute key,如 "output.value"),
 * `originalBytes` 是截断前的 UTF-8 字节数。view 显示「输出过大,已截断」靠它,不正则匹配 marker。
 */
export interface Truncation {
  path: string;
  originalBytes: number;
}

/**
 * 标准事件流的词汇(对标 docs/feature/adapters/architecture/events.md)。adapter 唯一的硬活就是把
 * 各 agent 五花八门的原始 transcript 映射成 StreamEvent[];映射完,整套断言免费。
 * `truncated` 只由 results writer 在落盘时刻写入(运行时全量,落盘截断);adapter 不产出它。
 */
export type StreamEvent = { truncated?: Truncation[] } & (
  /** 一条文本消息(assistant 回复或 user 输入);`loc` 是可选的源码位置,用于把消息叠回 eval 源码。 */
  | { type: "message"; role: "assistant" | "user"; text: string; loc?: SourceLoc }
  /** 发起一次工具/动作调用;`tool` 是归一化后的规范工具名,原始名保留在 DerivedFacts.ToolCall.originalName。 */
  | { type: "action.called"; callId: string; name: string; input: JsonValue; tool?: ToolName }
  /** 一次工具/动作调用的结果,按 `callId` 与对应的 `action.called` 对位。 */
  | {
      type: "action.result";
      callId: string;
      output?: JsonValue;
      status: "completed" | "failed" | "rejected";
    }
  /**
   * 一次 Skill 加载:一等事件,由 adapter 从原生协议里识别出「这是加载 Skill」并直接产出,
   * 不靠 renderer 按工具名/文本猜。`callId` 仅当原生协议把 Skill 加载表达成可关联的工具调用时才有。
   */
  | { type: "skill.loaded"; skill: string; callId?: string }
  /** 发起一次子 agent 调用(如 Task 工具、远程 sub-agent);`remoteUrl` 仅远程子 agent 有。 */
  | { type: "subagent.called"; callId: string; name: string; remoteUrl?: string }
  /** 一次子 agent 调用的结果,按 `callId` 与对应的 `subagent.called` 对位。 */
  | { type: "subagent.completed"; callId: string; output?: JsonValue; status: "completed" | "failed" }
  /** 模型停下来向人请求输入(HITL);具体请求内容见 InputRequest。 */
  | { type: "input.requested"; request: InputRequest }
  /** 模型的思考/推理文本(非最终回复)。 */
  | { type: "thinking"; text: string }
  /**
   * 被测系统内部注入的、不披着 `message` 外衣的上下文文本(如 Claude Code 的 SessionStart /
   * UserPromptSubmit hook 在下一轮开始前前置进模型上下文的文本)。只承载带实际文本内容的注入;
   * `source` 是可选的原始来源标记(如 hook 名),adapter 按各自协议原样透传,不强行归一到封闭枚举。
   */
  | { type: "context.injected"; text: string; source?: string }
  /** 上下文被压缩/摘要(如超长会话截断历史);`reason` 是可选的压缩原因说明。 */
  | { type: "compaction"; reason?: string }
  /** 运行中出现的错误。 */
  | { type: "error"; message: string }
);

/**
 * core 从事件流折叠出的结构化事实(deriveRunFacts)。折叠按 callId 把 called 与 result 对成一条
 * 调用:配上 result 的取 result 的状态;只有 called、尚未等到 result 的调用状态是 `pending`——
 * HITL 停在审批上的调用就以这个状态被断言,不是容错分支(见 docs/feature/adapters/architecture/events.md)。
 */
export interface ToolCall {
  callId: string;
  name: ToolName;
  originalName?: string;
  input: JsonValue;
  output?: JsonValue;
  status: "pending" | "completed" | "failed" | "rejected";
}

export interface SubagentCall {
  callId: string;
  name: string;
  remoteUrl?: string;
  output?: JsonValue;
  /** 子 agent 委派没有 rejected 状态(subagent.completed 只报 completed / failed)。 */
  status: "pending" | "completed" | "failed";
}

export interface DerivedFacts {
  readonly toolCalls: readonly ToolCall[];
  readonly subagentCalls: readonly SubagentCall[];
  readonly inputRequests: readonly InputRequest[];
  readonly parked: boolean;
  readonly messageCount: number;
  readonly compactions: number;
  /** 事件流里 `context.injected` 事件的次数;只回答存在性问题,不替代逐条读取原文。 */
  readonly contextInjections: number;
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
  attributes?: globalThis.Record<string, JsonValue>;
  /** 落盘截断标记(只由 results writer 在序列化时写入,运行时全量;见 Truncation)。 */
  truncated?: Truncation[];
}

/**
 * 给人与宿主侧行为断言(`t.o11y`)看的 o11y 摘要。从 `events.json` 派生的
 * 行为计数缓存,不是权威——同一 niceeval 版本写读,删除后可从 `events.json` 重算。token 用量、
 * 成本与耗时不在这里:权威唯一在 `result.json` 的 `Usage` / `estimatedCostUSD` 与 `durationMs`
 * / `phases`(见 docs/feature/record/architecture.md「o11y.json」)。
 */
export interface O11ySummary {
  totalTurns: number;
  /** 只有跑之前调用过的 canonical 工具名才有 key,不是全量出现;省略的 ToolName 视为 0。 */
  toolCalls: Partial<globalThis.Record<ToolName, number>>;
  totalToolCalls: number;
  filesRead: string[];
  filesModified: string[];
  shellCommands: { command: string; exitCode?: number; success?: boolean }[];
  webFetches: { url: string; status?: number; success?: boolean }[];
  errors: string[];
  thinkingBlocks: number;
  compactions: number;
}
