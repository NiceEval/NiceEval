// claude-agent-sdk 的 adapter:无侵入对接一个**已经在跑**的应用(../src/backend/server.ts,
// 原生 `SDKMessage` 流原样透传成 SSE,外加自定义 { type: "server_error" } 传输帧)。scripts/e2e.ts
// 负责启动这个应用并等它 ready,这里只假设它已经在 APP_URL 上监听。
//
// `SDKMessage` → 标准事件的映射是官方转换器 `fromClaudeSdkMessages`(`"niceeval/adapter"`
// 导出)的事;逐帧驱动也是官方件(`driveFrameStream`)。HITL 停轮现场(读了一半的流)和会话 id
// 续接都不需要自己声明状态槽——挂在 `ctx.session` 上,取用即可:`ctx.session.hold` /
// `ctx.session.take` 存取停轮现场,`ctx.session.id` / `ctx.session.capture` 续接会话。这里只剩
// 传输粘合:端点在哪、审批打哪个端点、HITL 停轮怎么判。
//
// coverage: completeCoverage——官方 SDK adapter,事件流、usage、状态都来自
// fromClaudeSdkMessages() 的完整归一,声明全通道 complete(见
// docs/feature/adapters/architecture/evidence.md)。这与是否声明 tracing 面是两件事:本
// adapter 不接 OTel(见下),`tracing` 字段留空,执行树的时间注释因此显示 timing unavailable——
// 覆盖声明只影响 calledTool/notCalledTool/maxTokens 这类断言的证据完整性判定,不影响 trace。
import {
  defineAgent,
  sseJsonFrames,
  fromClaudeSdkMessages,
  driveFrameStream,
  completeCoverage,
} from "niceeval/adapter";
import type { AgentContext, ClaudeSdkStream, SseFrameCursor } from "niceeval/adapter";
import type { Turn, TurnInput } from "niceeval";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { GATED_TOOL_NAME } from "../src/backend/agent.ts";

// 被测应用由 scripts/e2e.ts 启动(固定端口,串行 attempt 下不存在端口争用)。
const BASE_URL = process.env.APP_URL ?? "http://127.0.0.1:32001";

type TransportFrame = { type: "server_error"; message: string };
type ClaudeFrame = SDKMessage | TransportFrame;

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
      `连不上 ${BASE_URL}${path}。被测应用在跑吗?scripts/e2e.ts 应该已经起了它——独立调试时可以
       手动 tsx src/backend/server.ts(或设 APP_URL 指向已部署实例)。`,
    );
  }
}

interface Pending {
  readonly cursor: SseFrameCursor<ClaudeFrame>;
  readonly stream: ClaudeSdkStream;
  readonly toolUseId: string;
}
// 会话续接走「服务端记历史」范式:请求带 ctx.session.id,init 帧回传的 session_id 用
// ctx.session.capture 写回(first-writer-wins,不会被之后的重复回传覆盖)。

function readStream(cursor: SseFrameCursor<ClaudeFrame>, ctx: AgentContext, stream: ClaudeSdkStream): Promise<Turn> {
  return driveFrameStream(cursor, stream, ctx, (frame, derived) => {
    ctx.session.capture(stream.sessionId);

    if (frame.type === "server_error") return { fail: (frame as TransportFrame).message };

    // HITL 停轮:gated 工具的 tool_use 到了(canUseTool 此刻把流卡住,不会再有后续帧)。
    const gated = derived.find((e) => e.type === "action.called" && e.name === GATED_TOOL_NAME);
    if (gated && gated.type === "action.called") {
      ctx.session.hold<Pending>({ cursor, stream, toolUseId: gated.callId });
      return { pause: { id: gated.callId, action: GATED_TOOL_NAME, options: [{ id: "approve" }, { id: "deny" }] } };
    }
  });
}

/**
 * approve 端点在极少数情况下会在 canUseTool 真正把 resolver 存进服务端 pendingApprovals 之前
 * 就被我们打到——tool_use 块本身是"模型已经决定调用"的证据,但 SDK 内部要再过几十毫秒才跑到
 * canUseTool 回调去注册 resolver。404 大概率是这个注册竞态,不是真的没有这次审批,短退避重试
 * 几次;其它状态码直接抛。
 */
async function postApprove(toolUseId: string, approved: boolean, signal: AbortSignal): Promise<void> {
  const deadline = Date.now() + 3_000;
  for (;;) {
    const res = await appFetch("/api/chat/approve", { toolUseId, approved }, signal);
    if (res.ok) return;
    if (res.status !== 404 || Date.now() >= deadline) {
      throw new Error(`POST /api/chat/approve 失败: ${res.status} ${await res.text()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

async function send(input: TurnInput, ctx: AgentContext): Promise<Turn> {
  const pending = ctx.session.take<Pending>();
  if (pending) {
    // 按 requestId(挂起的 toolUseId)从 input.responses 里对位取裁决,不从 text 猜;这里
    // 每次只挂一条审批,取第一条即可。
    const approved = input.responses?.[0]?.optionId === "approve";
    if (!approved) pending.stream.markRejected(pending.toolUseId);
    await postApprove(pending.toolUseId, approved, ctx.signal);
    return readStream(pending.cursor, ctx, pending.stream);
  }

  const res = await appFetch("/api/chat", { message: input.text, sessionId: ctx.session.id }, ctx.signal);
  if (!res.ok || !res.body) {
    throw new Error(`POST /api/chat 失败: ${res.status} ${await res.text().catch(() => "")}`);
  }
  return readStream(sseJsonFrames<ClaudeFrame>(res.body), ctx, fromClaudeSdkMessages());
}

export default defineAgent({
  name: "claude-agent-sdk",
  coverage: completeCoverage,
  send,
});
