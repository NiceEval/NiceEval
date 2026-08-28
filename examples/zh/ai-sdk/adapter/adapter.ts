import { Effect } from "effect";
import { defineAgent } from "niceeval/adapter";
import type { Agent } from "niceeval/adapter";
import type { StreamEvent, ToolName, Usage } from "niceeval";
import type { AgentEvent, AgentResponse } from "../src/protocol.ts";

/**
 * adapter 的连接参数。`baseUrl`(被测 web agent 跑在哪)由【外面】传进来 —— config 注册
 * 默认实例、experiment 按需各传各的;adapter 自己不写死、也不读 env。这样同一个 adapter 能
 * 被不同 config / experiment 指到不同实例(本地、staging、容器…)复用,不必改 adapter。
 */
export interface WebAgentOptions {
  /** 被测 web agent 的 base URL(如 `http://127.0.0.1:5188`)。必填,由调用方传入。 */
  baseUrl: string;
}

/**
 * 把一个 AI SDK 工具循环的 HTTP web agent(examples/zh/ai-sdk/ai-sdk-agent)接进 niceeval 的
 * adapter 工厂。它的本质就是「对着一个 HTTP 端点的 send 里发 fetch、把响应映射成标准事件流」,
 * 跟具体业务(这里是个普通 AI 助手)无关。
 *
 * 响应直接按【同一 workspace 里共享的】`AgentResponse` 契约读 —— 自己的服务、自己的类型,
 * 不必把它当 `unknown` 再防御式重新校验一遍。adapter 唯一的硬活是把 `AgentEvent[]` 映射成
 * niceeval 的标准 `StreamEvent[]`。
 *
 * niceeval 为本次运行起一个本机 OTLP 接收器,把 endpoint 经 `ctx.telemetry`
 * 交给我们;我们随每轮请求把它带给 web agent,于是 app 自己的可观测(langfuse)之外,
 * 还能把这一轮的 turn / model / tool span 也导到 niceeval —— 双可观测,niceeval `view` 里
 * 直接出瀑布图。
 */
export function webAgent(opts: WebAgentOptions): Agent {
  if (!opts.baseUrl) throw new Error("webAgent 需要 baseUrl —— 被测 web agent 跑在哪由调用方传入。");
  const baseUrl = opts.baseUrl.replace(/\/$/, "");

  return defineAgent({
    name: "web-agent",
    // 自建 HTTP 协议只证明服务已回传的帧；usage 可选，且 HTTP/传输错误不能证明服务端
    // 已给出可评分终态，因此显式降级相关通道，不能伪报为 complete。
    evidenceCoverage: {
      events: { status: "partial", reason: "自建 HTTP 响应只覆盖服务端实际回传的事件帧" },
      actions: { status: "partial", reason: "工具生命周期仅来自服务端回传的事件帧" },
      messages: { status: "partial", reason: "助手消息仅来自服务端回传的事件帧" },
      usage: { status: "partial", reason: "服务端协议允许省略 usage" },
      status: { status: "partial", reason: "HTTP 或传输错误未必是服务端给出的可信终态" },
      data: { status: "partial", reason: "失败响应不携带应用 data" },
    },

    send: (input, ctx) => Effect.tryPromise({
      try: async () => {
      try {
        const response = await fetch(`${baseUrl}/api/turn`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sessionId: ctx.session.id,
            message: input.text,
            model: ctx.model,
            // t.sendFile 带来的图片等附件(base64),原样转发给 app。
            files: input.files,
            // 把 niceeval 的 OTLP 接收端点交给 app,让它把本轮 span 也发到这儿(第二路可观测)。
            otelEndpoint: ctx.telemetry?.endpoint,
          }),
          signal: ctx.signal,
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => "");
          return failedTurn(`web agent returned HTTP ${response.status}${errorText ? `: ${errorText}` : ""}`);
        }

        // 同一 workspace 的共享契约,直接按 AgentResponse 读。
        const body = (await response.json()) as AgentResponse;
        ctx.session.capture(body.sessionId);

        return {
          events: body.events.map(toStreamEvent),
          data: body.data,
          status: "completed" as const,
          usage: body.usage ? toUsage(body.usage) : undefined,
        };
      } catch (error) {
        return failedTurn(error instanceof Error ? error.message : String(error));
      }

      },
      catch: (cause) => cause,
    }),
  });
}

/** wire 上 `tool` 是普通 string;收窄回 niceeval 的 canonical `ToolName`,认不出的落 "unknown"。 */
const TOOL_NAMES: ReadonlySet<string> = new Set([
  "file_read", "file_write", "file_edit", "shell", "web_fetch", "web_search",
  "glob", "grep", "list_dir", "agent_task", "unknown",
]);

/** AgentEvent → niceeval StreamEvent:服务端(turnFromAiSdk)已归一好 canonical 工具名,这里只收窄类型。 */
function toStreamEvent(event: AgentEvent): StreamEvent {
  if (event.type === "operation.started") {
    const tool = event.operation.tool;
    const canonicalTool: ToolName = tool && TOOL_NAMES.has(tool) ? (tool as ToolName) : "unknown";
    return { ...event, operation: { ...event.operation, tool: canonicalTool } };
  }
  return event;
}

function toUsage(usage: NonNullable<AgentResponse["usage"]>): Usage {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    requests: usage.requests,
  };
}

function failedTurn(message: string) {
  return {
    status: "failed" as const,
    events: [{ type: "error" as const, message }],
  };
}
