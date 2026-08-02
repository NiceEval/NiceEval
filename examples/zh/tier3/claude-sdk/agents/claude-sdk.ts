// claude-sdk 的 adapter:无侵入对接一个**已经在跑**的应用(../src/backend/server.ts,原生
// `SDKMessage` 流原样透传成 SSE,外加自定义 { type: "server_error" } 传输帧)。
//
// `SDKMessage` → 标准事件的映射是官方转换器 `createClaudeSdkEventStream`(`"niceeval/adapter"`
// 导出)的事;逐帧驱动也是官方件(`driveFrameStream`)。HITL 停轮现场用 Adapter 私有
// heldSlot 存取，会话 id 用
// `ctx.session.id` / `ctx.session.capture` 续接。这里
// 只剩传输粘合:端点在哪、审批打哪个端点、HITL 停轮怎么判。
// 无 OTel(CLI 原生遥测只有 metrics+logs,niceeval 不消费),事件全部来自转换器。
//
// 这是 Tier 3(侵入改造 + experiment params):比 ../../tier1/claude-sdk 多一层——应用侧把
// system prompt 提升为请求体可选字段(src/backend/{agent,server}.ts),本文件把 experiment
// 的 `params.systemPrompt` 经 ctx.params 随请求体透传,feature A/B 见 experiments/compare-prompts/。
//
// HITL 没有显式的"等审批"帧——`canUseTool` 把流卡在一个 Promise 上,客户端只能从
// "gated 工具的 tool_use 到了、之后没动静"推断。Tier 1 的确定性做法:被门控的工具就
// mcp__demo-tools__calculate 一个(应用 agent.ts 里的 GATED_TOOL_NAME,这里必须写死同一个
// 字符串),`driveFrameStream` 的 onFrame 钩子扫 derived 事件认出它就返回 `{ pause }`;
// 下一轮先打 /api/chat/approve 再继续读同一条流。
import { createSessionSlot, defineAgent, sseJsonFrames, createClaudeSdkEventStream, driveFrameStream } from "niceeval/adapter";
import type { AgentContext, ClaudeSdkStream, SseFrameCursor } from "niceeval/adapter";
import type { Turn, TurnInput } from "niceeval";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

// 必须和 ../src/backend/agent.ts 里的 GATED_TOOL_NAME 完全一致(MCP 命名空间下的真实工具名)。
const GATED_TOOL_NAME = "mcp__demo-tools__calculate";

// 被测应用由你自己按它的方式启动(pnpm start / 部署在哪都行),eval 不代管进程、不另开端口。
const BASE_URL = process.env.CLAUDE_SDK_URL ?? "http://127.0.0.1:32001";

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
      `连不上 ${BASE_URL}${path}。被测应用在跑吗?先起它:cd examples/zh/tier3/claude-sdk && pnpm start(或设 CLAUDE_SDK_URL 指向已部署实例)。`,
    );
  }
}

interface Pending {
  readonly cursor: SseFrameCursor<ClaudeFrame>;
  readonly stream: ClaudeSdkStream;
  readonly toolUseId: string;
}
const heldSlot = createSessionSlot<Pending>("claude-sdk/held-stream");
// 会话续接走「服务端记历史」范式:请求带 ctx.session.id,init 帧回传的 session_id 用
// ctx.session.capture 写回(first-writer-wins,不会被之后的重复回传覆盖)。

function readStream(cursor: SseFrameCursor<ClaudeFrame>, ctx: AgentContext, stream: ClaudeSdkStream): Promise<Turn> {
  return driveFrameStream(cursor, stream, ctx, (frame, derived) => {
    ctx.session.capture(stream.sessionId);

    if (frame.type === "server_error") return { fail: (frame as TransportFrame).message };

    // HITL 停轮:gated 工具的 tool_use 到了(canUseTool 此刻把流卡住,不会再有后续帧)。
    const gated = derived.find(
      (event) =>
        event.type === "operation.started" &&
        event.operation.kind === "tool" &&
        event.operation.name === GATED_TOOL_NAME,
    );
    if (gated?.type === "operation.started") {
      ctx.session.set(heldSlot, { cursor, stream, toolUseId: gated.operationId });
      return { pause: { id: gated.operationId, action: GATED_TOOL_NAME, options: [{ id: "approve" }, { id: "deny" }] } };
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
  const pending = ctx.session.take(heldSlot);
  if (pending) {
    // 按 requestId(挂起的 toolUseId)从 input.responses 里对位取裁决,不从 text 猜;
    // 这里每次只挂一条审批,取第一条即可——多请求并停时按 requestId 对位。
    const approved = input.responses?.[0]?.optionId === "approve";
    if (!approved) pending.stream.markRejected(pending.toolUseId);
    await postApprove(pending.toolUseId, approved, ctx.signal);
    return readStream(pending.cursor, ctx, pending.stream);
  }

  const res = await appFetch(
    "/api/chat",
    {
      message: input.text,
      sessionId: ctx.session.id,
      // Tier 3:experiment 的 params 经 ctx.params 透传给应用(见 experiments/compare-prompts/)。
      systemPrompt: ctx.params.systemPrompt,
    },
    ctx.signal,
  );
  if (!res.ok || !res.body) {
    throw new Error(`POST /api/chat 失败: ${res.status} ${await res.text().catch(() => "")}`);
  }
  return readStream(sseJsonFrames<ClaudeFrame>(res.body), ctx, createClaudeSdkEventStream());
}

export default defineAgent({
  name: "claude-sdk",
  send,
});
