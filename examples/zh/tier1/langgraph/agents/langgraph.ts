import { Schema } from "effect";
// langgraph 的 adapter:无侵入对接 ../src/backend/server.py —— 自定义 JSON 帧 over SSE
// (server.py 不透传 LangGraph 原生 stream 事件,自己翻译成一套小协议,见其头注释)。
//
// 断言依据全部来自这条流,零 OTel 依赖:
//   · `tool-input` → operation.started、`tool-output` → operation.finished(completed,
//     带 isError 时 failed)、`tool-output-denied` → operation.finished(rejected)——
//     协议帧里本来就有全量工具过程;
//   · `text-delta` 累积成完整回复,轮次结束补一条 message 事件;
//   · HITL:`tool-approval-request` → input.requested + waiting,停轮现场(还开着的流 +
//     挂起的 toolCallId)用 heldKey 存住,回答轮 take(heldKey) 取回接着读。
//
// 这是 Tier 1(只接 send):要 `niceeval view` 的调用瀑布图时升 Tier 2,见
// ../../tier2/langgraph/——config 加一行 telemetry、本文件加一段 span 收尾宽限,其它不变。
import { createSessionKey, defineAgent, openSseJsonFrames } from "niceeval/adapter";
import type { AgentContext, EvidenceCoverage, SseFrameCursor } from "niceeval/adapter";
import type { StreamEvent, Turn, TurnInput } from "niceeval";

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

const LanggraphFrameSchema = Schema.Union([
  Schema.Struct({ type: Schema.Literals(["session"]), sessionId: Schema.String }),
  Schema.Struct({ type: Schema.Literals(["text-delta"]), delta: Schema.String }),
  Schema.Struct({
    type: Schema.Literals(["tool-input"]),
    toolCallId: Schema.String,
    name: Schema.String,
    input: Schema.MutableJson,
  }),
  Schema.Struct({
    type: Schema.Literals(["tool-output"]),
    toolCallId: Schema.String,
    output: Schema.MutableJson,
    isError: Schema.optional(Schema.Boolean),
  }),
  Schema.Struct({ type: Schema.Literals(["tool-approval-request"]), toolCallId: Schema.String }),
  Schema.Struct({ type: Schema.Literals(["tool-output-denied"]), toolCallId: Schema.String }),
  Schema.Struct({ type: Schema.Literals(["error"]), message: Schema.String }),
  Schema.Struct({ type: Schema.Literals(["finish"]) }),
]);
type LanggraphFrame = Schema.Schema.Type<typeof LanggraphFrameSchema>;

type SseCursor = SseFrameCursor<LanggraphFrame>;

// HITL 停轮现场:还开着的流 + 挂起的审批 toolCallId。approve/deny 的续读发生在下一次
// send()(一个全新的 drainStream 调用),局部变量活不过这次函数返回——存进 heldKey,
// 回答轮 take(heldKey) 取回(取到即清除,一次消费)。
interface PendingApproval {
  readonly cursor: SseCursor;
  readonly toolCallId: string;
}
const heldKey = createSessionKey<PendingApproval>("langgraph/held-stream");

const evidenceCoverage = {
  events: { status: "complete" },
  actions: { status: "complete" },
  messages: { status: "complete" },
  usage: { status: "unavailable", reason: "LangGraph 自定义 SSE 协议不包含 token usage" },
  status: { status: "complete" },
  data: { status: "unavailable", reason: "adapter 不产生 Turn.data" },
} satisfies EvidenceCoverage;

async function drainStream(cursor: SseCursor, ctx: AgentContext): Promise<Turn> {
  const events: StreamEvent[] = [];
  let paused = false;
  let bodyFailed = false;
  const close = () => {
    void cursor.return().catch(() => {});
  };
  ctx.signal.addEventListener("abort", close, { once: true });
  let status: "completed" | "failed" = "completed";
  let messageText = "";
  // 本次 drain 里见过的 tool-input,按 operationId 记名字——tool-approval-request 帧不带工具名,
  // input.requested 的 action 字段从这里查。
  const toolNames = new Map<string, string>();

  const finalize = async (): Promise<Turn> => {
    if (messageText) events.push({ type: "message", role: "assistant", text: messageText });
    return { status, events };
  };

  try {
    for (;;) {
      ctx.signal.throwIfAborted();
      const result = await cursor.next();
      ctx.signal.throwIfAborted();
      if (result.done) break;
      const frame = result.value;

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
          events.push({
            type: "operation.started",
            operationId: frame.toolCallId,
            operation: { kind: "tool", name: frame.name, input: frame.input },
          });
          break;
        }
        case "tool-output": {
          events.push({
            type: "operation.finished",
            operationId: frame.toolCallId,
            kind: "tool",
            output: frame.output,
            status: frame.isError === true ? "failed" : "completed",
          });
          break;
        }
        case "tool-approval-request": {
          // 停轮:流不关,现场 hold 住;回答轮 take 回来接着读同一条流,不重新发起请求。
          // 中断前模型可能已经吐了一段前言(比如"好的,我来算一下"),一并收进这一轮。
          ctx.session.set(heldKey, { cursor, toolCallId: frame.toolCallId });
          if (messageText) events.push({ type: "message", role: "assistant", text: messageText });
          events.push({
            type: "input.requested",
            request: {
              id: frame.toolCallId,
              action: toolNames.get(frame.toolCallId) ?? "tool",
              options: [{ id: "approve" }, { id: "deny" }],
            },
          });
          ctx.signal.throwIfAborted();
          paused = true;
          return { status: "waiting", events };
        }
        case "tool-output-denied": {
          // 被拒绝的调用不执行:operation.started 在 tool-input 帧(上一轮)已落,这里只补
          // rejected 的 operation.finished——同一个 operationId,跨轮配对。
          events.push({ type: "operation.finished", operationId: frame.toolCallId, kind: "tool", status: "rejected" });
          break;
        }
        case "error": {
          status = "failed";
          events.push({ type: "error", message: frame.message });
          break;
        }
        case "finish": {
          ctx.signal.throwIfAborted();
          return await finalize();
        }
        default:
          break;
      }
    }

    ctx.signal.throwIfAborted();
    return await finalize();
  } catch (error) {
    bodyFailed = true;
    throw error;
  } finally {
    ctx.signal.removeEventListener("abort", close);
    if (!paused) {
      try {
        await cursor.return();
        if (!bodyFailed) ctx.signal.throwIfAborted();
      } catch (error) {
        if (!bodyFailed) throw error;
        try {
          ctx.diagnostic({ code: "stream-cleanup-failed", level: "warning", message: "Stream cleanup failed." });
        } catch {
          // Keep the stream failure primary.
        }
      }
    }
  }
}

async function send(input: TurnInput, ctx: AgentContext): Promise<Turn> {
  // 回答轮:取回停轮现场,把裁决交回应用,接着读同一条流。
  const pending = ctx.session.take(heldKey);
  if (pending) {
    // 按 requestId(挂起的 toolCallId)从 input.responses 里对位取裁决,不从 text 猜;
    // 这里每次只挂一条审批,取第一条即可——多请求并停时按 requestId 对位。
    const approved = input.responses?.[0]?.optionId === "approve";
    try {
      const approveRes = await appFetch("/api/chat/approve", { toolCallId: pending.toolCallId, approved }, ctx.signal);
      if (!approveRes.ok) {
        throw new Error(`POST /api/chat/approve 失败: ${approveRes.status} ${await approveRes.text()}`);
      }
    } catch (error) {
      try {
        await pending.cursor.return();
      } catch {
        try {
          ctx.diagnostic({ code: "stream-cleanup-failed", level: "warning", message: "Stream cleanup failed." });
        } catch {
          // Keep the approval failure primary.
        }
      }
      throw error;
    }
    return drainStream(pending.cursor, ctx);
  }

  const cursor = await openSseJsonFrames(
    ctx,
    async (signal) => {
      const res = await appFetch("/api/chat", { message: input.text, sessionId: ctx.session.id }, signal);
      if (!res.ok || !res.body) {
        throw new Error(`POST /api/chat 失败: ${res.status} ${await res.text().catch(() => "")}`);
      }
      return res.body;
    },
    LanggraphFrameSchema,
  );
  return drainStream(cursor, ctx);
}

export default defineAgent({
  name: "langgraph",
  evidenceCoverage,
  send,
});
