import { defineAgent } from "fasteval";
import type { Agent, StreamEvent, Usage } from "fasteval";
import type { AgentEvent, AgentResponse } from "../ai-sdk-agent/src/protocol.ts";

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
 * 把一个 AI SDK 工具循环的 HTTP web agent(examples/zh/ai-sdk/ai-sdk-agent)接进 fasteval 的
 * adapter 工厂。它的本质就是「对着一个 HTTP 端点的 send 里发 fetch、把响应映射成标准事件流」,
 * 跟具体业务(这里是个普通 AI 助手)无关。
 *
 * 响应直接按【同一 workspace 里共享的】`AgentResponse` 契约读 —— 自己的服务、自己的类型,
 * 不必把它当 `unknown` 再防御式重新校验一遍。adapter 唯一的硬活是把 `AgentEvent[]` 映射成
 * fasteval 的标准 `StreamEvent[]`。
 *
 * 声明 `tracing`:fasteval 为本次运行起一个本机 OTLP 接收器,把 endpoint 经 `ctx.telemetry`
 * 交给我们;我们随每轮请求把它带给 web agent,于是 app 自己的可观测(langfuse)之外,
 * 还能把这一轮的 turn / model / tool span 也导到 fasteval —— 双可观测,fasteval `view` 里
 * 直接出瀑布图。
 */
export function webAgent(opts: WebAgentOptions): Agent {
  if (!opts.baseUrl) throw new Error("webAgent 需要 baseUrl —— 被测 web agent 跑在哪由调用方传入。");
  const baseUrl = opts.baseUrl.replace(/\/$/, "");

  return defineAgent({
    name: "web-agent",
    capabilities: {
      conversation: true,
      toolObservability: true,
      tracing: true,
    },

    async send(input, ctx) {
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
            // 把 fasteval 的 OTLP 接收端点交给 app,让它把本轮 span 也发到这儿(第二路可观测)。
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
        ctx.session.id = body.sessionId;

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
  });
}

/** AgentEvent → fasteval StreamEvent:只有 action.called 需要补 canonical 工具名;其余结构一致。 */
function toStreamEvent(event: AgentEvent): StreamEvent {
  if (event.type === "action.called") return { ...event, tool: "unknown" };
  return event;
}

function toUsage(usage: NonNullable<AgentResponse["usage"]>): Usage {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    requests: usage.requests,
  };
}

function failedTurn(message: string) {
  return {
    status: "failed" as const,
    events: [{ type: "error" as const, message }],
  };
}
