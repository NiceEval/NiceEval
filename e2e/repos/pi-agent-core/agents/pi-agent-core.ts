// pi-agent-core 的 adapter:无侵入对接一个**已经在跑**的应用(../src/server.ts,pi 的原生
// `AgentEvent` 原样透传成 SSE,外加三种自定义传输帧:session / approval_request /
// server_error,见 server.ts 头注释)。像前端用户一样打 HTTP 接口,不做进程内直调
// (docs-site/zh/tutorials/connect-your-agent.mdx「为什么不直调」)。
//
// `AgentEvent` → 标准事件的映射是官方转换器 `fromPiAgentEvents`(`"niceeval/adapter"` 导出)
// 的事;逐帧驱动 + HITL 挂起用的是官方驱动件 `driveFrameStream`,停轮现场与会话续接的状态槽
// 都在 `ctx.session` 上——不需要模块级状态、也不需要在 `defineAgent` 上声明什么。这里只剩传输
// 粘合:端点在哪、三种传输帧怎么处理、审批打哪个端点。
//
// 无 OTel(pi-agent-core 没有官方集成,调研见
// docs/feature/adapters/reference/agent-loop-apis.md「pi」一节)——不声明 tracing 块。
//
// HITL:只有 send_alert 工具经服务端 beforeToolCall 挂审批(见 server.ts 的 GATED_TOOL)。
// approval_request 帧到达时,流并不关闭——服务端把执行卡在一个 Promise 上等
// POST /api/chat/approve。所以 `driveFrameStream` 在这一帧返回 `{ pause }`,
// `ctx.session.hold()` 记住"读了一半的 SSE 流"(连同转换器状态);下一次 send(即 t.respond)
// 先打 approve 端点、再继续读同一条流到结束——不重新发 /api/chat。`ctx.session.take()`
// 取到即清除,一次消费。
import {
  defineAgent,
  sseJsonFrames,
  fromPiAgentEvents,
  driveFrameStream,
  completeCoverage,
} from "niceeval/adapter";
import type { AgentContext, PiAgentStream, SseFrameCursor } from "niceeval/adapter";
import type { JsonValue, Turn, TurnInput } from "niceeval";
import type { AgentEvent } from "@earendil-works/pi-agent-core";

// 被测应用由 scripts/e2e.ts 启动(见该文件);eval 不代管进程、不另开端口,只按 env 连接。
const BASE_URL = process.env.PI_AGENT_CORE_URL ?? "http://127.0.0.1:33101";

type TransportFrame =
  | { type: "session"; sessionId: string }
  | { type: "approval_request"; toolCallId: string; toolName: string; args: unknown }
  | { type: "server_error"; message: string };

type PiFrame = AgentEvent | TransportFrame;

async function appFetch(path: string, body: unknown, signal: AbortSignal): Promise<Response> {
  try {
    return await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (signal.aborted) throw err;
    throw new Error(
      `连不上 ${BASE_URL}${path}。被测应用在跑吗?scripts/e2e.ts 应已起它(或设 PI_AGENT_CORE_URL 指向已部署实例)。`,
    );
  }
}

interface Pending {
  readonly cursor: SseFrameCursor<PiFrame>;
  readonly stream: PiAgentStream;
  readonly toolCallId: string;
}

function readStream(cursor: SseFrameCursor<PiFrame>, ctx: AgentContext, stream: PiAgentStream): Promise<Turn> {
  return driveFrameStream(cursor, stream, ctx, (frame) => {
    if (frame.type === "session") {
      // 会话续接走「服务端记历史」范式:回传的 sessionId 用 ctx.session.capture 写回,
      // 只在还没记过时落地(first-writer-wins)。
      ctx.session.capture(frame.sessionId);
      return;
    }
    if (frame.type === "approval_request") {
      ctx.session.hold<Pending>({ cursor, stream, toolCallId: frame.toolCallId });
      return {
        pause: {
          id: frame.toolCallId,
          action: frame.toolName,
          input: frame.args as JsonValue,
          options: [{ id: "approve" }, { id: "deny" }],
        },
      };
    }
    if (frame.type === "server_error") return { fail: frame.message };
  });
}

async function send(input: TurnInput, ctx: AgentContext): Promise<Turn> {
  const pending = ctx.session.take<Pending>();
  if (pending) {
    // 按 requestId(挂起的 toolCallId)从 input.responses 里对位取裁决,不从 text 猜;
    // 这里每次只挂一条审批,取第一条即可——多请求并停时按 requestId 对位。
    const approved = input.responses?.[0]?.optionId === "approve";
    if (!approved) pending.stream.markRejected(pending.toolCallId);
    const approveRes = await appFetch(
      "/api/chat/approve",
      { toolCallId: pending.toolCallId, approved },
      ctx.signal,
    );
    if (!approveRes.ok) {
      throw new Error(`POST /api/chat/approve 失败: ${approveRes.status} ${await approveRes.text()}`);
    }
    return readStream(pending.cursor, ctx, pending.stream);
  }

  const res = await appFetch("/api/chat", { message: input.text, sessionId: ctx.session.id }, ctx.signal);
  if (!res.ok || !res.body) {
    throw new Error(`POST /api/chat 失败: ${res.status} ${await res.text().catch(() => "")}`);
  }
  return readStream(sseJsonFrames<PiFrame>(res.body), ctx, fromPiAgentEvents());
}

export default defineAgent({
  name: "pi-agent-core",
  // fromPiAgentEvents 是官方转换器,喂的是完整的 AgentEvent 流(见 server.ts:pi 的事件原样
  // 透传成 SSE,没有裁剪或采样)——全通道声明 complete。
  coverage: completeCoverage,
  send,
});
