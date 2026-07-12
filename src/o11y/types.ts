// o11y 域类型:标准事件流(StreamEvent)、折叠事实(DerivedFacts)、
// OTLP trace(TraceSpan / SpanKind)与用量 / 摘要。

import type { JsonValue, SourceLoc } from "../shared/types.ts";

/** 一次运行的 token 用量(沙箱型从 transcript/OTel span 的 `gen_ai.usage.*` 属性抠,remote 由 send 的 `Turn.usage` 直接返回)。 */
export interface Usage {
  /** 输入(prompt)token 数,不含缓存命中部分。 */
  inputTokens: number;
  /** 输出(completion)token 数。 */
  outputTokens: number;
  /** 命中 prompt 缓存、按缓存价读取的 token 数(省略表示该 agent 不上报此项)。 */
  cacheReadTokens?: number;
  /** 写入 prompt 缓存的 token 数(省略表示该 agent 不上报此项)。 */
  cacheWriteTokens?: number;
  /** 本次运行触发的模型请求次数(多轮/重试可能大于 1)。 */
  requests?: number;
  /**
   * 网关/adapter 实测的真实美元成本(只能由 `Turn.usage.costUSD` 显式带回,从不从
   * token 用量或 OTel span 反推得到)。存在时优先于按价格表(`defineConfig({ pricing })`)
   * 估算的成本——见 `estimateCost` 的 `usage.costUSD ?? estimateCost(...)` 兜底顺序。
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
 * 标准事件流的词汇(对标 docs/feature/adapters/contract.md)。adapter 唯一的硬活就是把
 * 各 agent 五花八门的原始 transcript 映射成 StreamEvent[];映射完,整套断言免费。
 */
export type StreamEvent =
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
  /** 上下文被压缩/摘要(如超长会话截断历史);`reason` 是可选的压缩原因说明。 */
  | { type: "compaction"; reason?: string }
  /** 运行中出现的错误。 */
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
  /** 只有跑之前调用过的 canonical 工具名才有 key,不是全量出现;省略的 ToolName 视为 0。 */
  toolCalls: Partial<Record<ToolName, number>>;
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
