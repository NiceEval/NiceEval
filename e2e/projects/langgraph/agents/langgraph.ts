// langgraph 的 adapter:无侵入对接 ../src/backend/server.py —— 自定义 JSON 帧 over SSE
// (server.py 不透传 LangGraph 原生 stream 事件,自己翻译成一套小协议,见其头注释)。
//
// 断言依据全部来自这条流,零 OTel 依赖:
//   · `tool-input` → action.called、`tool-output` → action.result(completed,
//     带 isError 时 failed)、`tool-output-denied` → action.result(rejected)——
//     协议帧里本来就有全量工具过程;
//   · `text-delta` 累积成完整回复,轮次结束补一条 message 事件;
//   · HITL:`tool-approval-request` → input.requested + waiting,停轮现场(还开着的流 +
//     挂起的 toolCallId)用 ctx.session.hold 存住,回答轮 ctx.session.take 取回接着读。
//
// 只接 send,不接 OTel——e2e 不测瀑布图(docs/engineering/e2e-ci/README.md 第 9 节);带 OTel 的完整
// 接入示例见 examples/zh/tier2/langgraph/。
import { defineAgent, sseJsonFrames } from "niceeval/adapter";
import type { AgentContext, SseFrameCursor } from "niceeval/adapter";
import type { JsonValue, StreamEvent, Turn, TurnInput } from "niceeval";

// 被测应用由你自己按它的方式启动(python server.py / 部署在哪都行),eval 不代管进程、
// 不另开端口。
const BASE_URL = process.env.LANGGRAPH_URL ?? "http://127.0.0.1:35000";

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
      `连不上 ${BASE_URL}${path}。被测应用在跑吗?先起它(见 README「跑起来」),或设 LANGGRAPH_URL 指向已部署实例。`,
    );
  }
}

type LanggraphFrame =
  | { type: "session"; sessionId: string }
  | { type: "text-delta"; delta: string }
  | { type: "tool-input"; toolCallId: string; name: string; input: unknown }
  | { type: "tool-output"; toolCallId: string; output: unknown; isError?: boolean }
  | { type: "tool-approval-request"; toolCallId: string }
  | { type: "tool-output-denied"; toolCallId: string }
  | { type: "error"; message: string }
  | { type: "finish" };

type SseCursor = SseFrameCursor<LanggraphFrame>;

// HITL 停轮现场:还开着的流 + 挂起的审批 toolCallId。approve/deny 的续读发生在下一次
// send()(一个全新的 drainStream 调用),局部变量活不过这次函数返回——存进 ctx.session.hold,
// 回答轮 ctx.session.take 取回(取到即清除,一次消费)。
interface PendingApproval {
  readonly cursor: SseCursor;
  readonly toolCallId: string;
}

async function drainStream(cursor: SseCursor, ctx: AgentContext): Promise<Turn> {
  const events: StreamEvent[] = [];
  let status: "completed" | "failed" = "completed";
  let messageText = "";
  // 本次 drain 里见过的 tool-input,按 callId 记名字——tool-approval-request 帧不带工具名,
  // input.requested 的 action 字段从这里查。
  const toolNames = new Map<string, string>();

  const finalize = async (): Promise<Turn> => {
    if (messageText) events.push({ type: "message", role: "assistant", text: messageText });
    return { status, events };
  };

  for (;;) {
    const frame = await cursor.next();
    if (frame === null) break;

    switch (frame.type) {
      case "session": {
        // 会话续接走「服务端记历史」范式:session 帧回传的 id 用 ctx.session.capture 写回。
        ctx.session.capture(frame.sessionId);
        break;
      }
      case "text-delta": {
        messageText += frame.delta;
        break;
      }
      case "tool-input": {
        toolNames.set(frame.toolCallId, frame.name);
        events.push({ type: "action.called", callId: frame.toolCallId, name: frame.name, input: frame.input as JsonValue });
        break;
      }
      case "tool-output": {
        events.push({
          type: "action.result",
          callId: frame.toolCallId,
          output: frame.output as JsonValue,
          status: frame.isError === true ? "failed" : "completed",
        });
        break;
      }
      case "tool-approval-request": {
        // 停轮:流不关,现场 hold 住;回答轮 take 回来接着读同一条流,不重新发起请求。
        // 中断前模型可能已经吐了一段前言(比如"好的,我来算一下"),一并收进这一轮。
        ctx.session.hold<PendingApproval>({ cursor, toolCallId: frame.toolCallId });
        if (messageText) events.push({ type: "message", role: "assistant", text: messageText });
        events.push({
          type: "input.requested",
          request: {
            id: frame.toolCallId,
            action: toolNames.get(frame.toolCallId) ?? "tool",
            options: [{ id: "approve" }, { id: "deny" }],
          },
        });
        return { status: "waiting", events };
      }
      case "tool-output-denied": {
        // 被拒绝的调用不执行:action.called 在 tool-input 帧(上一轮)已落,这里只补 rejected
        // 的 result——同一个 toolCallId,跨轮配对。
        events.push({ type: "action.result", callId: frame.toolCallId, status: "rejected" });
        break;
      }
      case "error": {
        status = "failed";
        events.push({ type: "error", message: frame.message });
        break;
      }
      case "finish": {
        return finalize();
      }
      default:
        break;
    }
  }

  return finalize();
}

async function send(input: TurnInput, ctx: AgentContext): Promise<Turn> {
  // 回答轮:取回停轮现场,把裁决交回应用,接着读同一条流。
  const pending = ctx.session.take<PendingApproval>();
  if (pending) {
    // 按 requestId(挂起的 toolCallId)从 input.responses 里对位取裁决,不从 text 猜;
    // 这里每次只挂一条审批,取第一条即可——多请求并停时按 requestId 对位。
    const approved = input.responses?.[0]?.optionId === "approve";
    const approveRes = await appFetch(
      "/api/chat/approve",
      { toolCallId: pending.toolCallId, approved },
      ctx.signal,
    );
    if (!approveRes.ok) {
      throw new Error(`POST /api/chat/approve 失败: ${approveRes.status} ${await approveRes.text()}`);
    }
    return drainStream(pending.cursor, ctx);
  }

  const res = await appFetch(
    "/api/chat",
    { message: input.text, sessionId: ctx.session.id },
    ctx.signal,
  );
  if (!res.ok || !res.body) {
    throw new Error(`POST /api/chat 失败: ${res.status} ${await res.text().catch(() => "")}`);
  }
  return drainStream(sseJsonFrames<LanggraphFrame>(res.body), ctx);
}

export default defineAgent({
  name: "langgraph",
  send,
});
