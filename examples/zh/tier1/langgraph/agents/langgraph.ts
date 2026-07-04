// langgraph 的 adapter:无侵入对接 ../src/backend/server.py —— 自定义 JSON 帧 over SSE
// (server.py 不透传 LangGraph 原生 stream 事件,自己翻译成一套小协议,见其头注释)。
//
// 事件来源:`events: otelEvents({ dialects: [otel.langsmith] })`——LangSmith OTel 导出的
// span 派生 action.called / action.result / usage。`tool-output` 帧不用翻译;`tool-input`
// 帧仍然补一条 action.called(见下方 deny 分支的说明,denied 的调用从来不会真的执行,没有
// span 可派生),和 span 派生的重复也没关系(otelEvents 按 callId 去重,见
// src/o11y/otlp/dialects.ts 的 mergeDerivedEvents)。
//
// 消息文本例外——这里没有照抄"span 全包"的理想状态,是实测出来的:langsmith 方言的 "llm"
// 分支只认得 gen_ai.completion 是纯字符串 / {content} / 消息数组三种形状,LangChain 的
// ChatOpenAI 包装器实际吐的是 `{generations:[[{text, message, ...}]]}`(生成候选数组套一层),
// 三种形状都不命中,text 解析成 undefined,message 事件直接丢空——工具调用和 usage 派生完全
// 正常(它们走的是 "tool" 分支,shape 对得上),只有 assistant 文本这条链路对不上 LangChain
// 这个生态的实际输出。核心的 langsmith dialect 不归这次 Tier 1 工单改,所以在 adapter 这层
// 补一条:累积 `text-delta` 帧(应用自己逐 token 吐的,协议里本来就有)拼成完整回复,在这一轮
// 结束时补一条 message 事件——按文档"send 的 events 与 span 派生结果按时间戳合并"设计,这不是
// hack,是两条事件来源分工:span 管工具 + usage,adapter 补 span 这个生态解析不出来的消息文本。
//
// HITL 是唯一 span 管不到的部分:`tool-approval-request` → input.requested + waiting;
// `tool-output-denied` → action.result(status:"rejected",span 里没有"人拒绝"这个语义,
// 这条要 adapter 自己补)。approve 端点字段是 toolCallId(不是 pi-sdk/claude-sdk 那个
// toolUseId)。
import { defineAgent, otelEvents, otel, serverSession, sseJsonFrames } from "niceeval/adapter";
import type { AgentContext, SseFrameCursor } from "niceeval/adapter";
import type { JsonValue, StreamEvent, Turn, TurnInput } from "niceeval";

// 被测应用由你自己按它的方式启动(python server.py / 部署在哪都行),eval 不代管进程、
// 不另开端口。LangSmith OTel 导出的环境变量在启动应用时给,见 README「跑起来」。
const BASE_URL = process.env.LANGGRAPH_URL ?? "http://127.0.0.1:5488";

async function appFetch(
  path: string,
  body: unknown,
  signal: AbortSignal,
  headers?: Readonly<Record<string, string>>,
): Promise<Response> {
  try {
    return await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
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
  | { type: "tool-output"; toolCallId: string; output: unknown }
  | { type: "tool-approval-request"; toolCallId: string }
  | { type: "tool-output-denied"; toolCallId: string }
  | { type: "error"; message: string }
  | { type: "finish" };

type SseCursor = SseFrameCursor<LanggraphFrame>;

// sessionId -> 还开着的流 + 卡住的 gated tool_call。key 用 ctx.session.id——session 帧总是
// 每轮第一个到(isNew 时才发),写回 ctx.session.id 之后这个 key 才稳定。gatedCall 存进这个
// Map 而不是留在 drainStream 的局部变量里,是因为 approve/deny 的续读发生在下一次 send() ->
// 一个全新的 drainStream 调用,局部变量活不过这次函数返回,只有 Map 能跨这两次调用带着走。
interface PendingApproval {
  readonly cursor: SseCursor;
  readonly gatedCall: { readonly toolCallId: string; readonly name: string; readonly input: unknown };
}
const pendingApprovals = new Map<string, PendingApproval>();
// 会话续接走「服务端记历史」范式:请求带 session.id(ctx),session 帧回传的 id 用 capture 写回。
const session = serverSession();

// LangSmith 的 OtelSpanProcessor 是标准 BatchSpanProcessor(读 OTEL_BSP_SCHEDULE_DELAY,
// tracing.env 已经调到 200ms),但它的调度定时器和"这一轮 HTTP 请求什么时候返回"是两条独立
// 时间线——最后一次模型调用(拿到工具结果后生成自然语言回复那次)的 span 经常在 SSE 流已经
// 发完 finish、连接已经关闭之后才真正被导出,niceeval 的本轮收集窗口这时已经关了,消息文本就
// 丢了(实测:图完全跑完、text-delta 帧完整,但 span 数量稳定卡在"只有第一次模型调用"那次)。
// 这不是频率问题,加大 schedule delay 也不解决——是"轮次边界"和"批处理导出边界"这两条时间线
// 天生对不齐。这里在轮次真正结束(拿到 finish 或流自然关闭)后主动等一小段时间,把 niceeval
// 的收集窗口人为拉宽,让最后一批 span 有时间落进来;等 2-3 个 schedule delay 周期足够。
const OTEL_FLUSH_GRACE_MS = 600;

// 只有一个 gated 工具,和 origin src/backend/agent.py 的 GATED_TOOLS 保持一致(帧本身不带
// 工具名,这里跟着写死同一个字符串)。
const GATED_TOOLS = new Set(["calculate"]);

interface GatedCall {
  readonly toolCallId: string;
  readonly name: string;
  readonly input: unknown;
}

/**
 * resumeGatedCall:approve/deny 续读时,上一次(turn1)drainStream 调用捕获的 gated 工具调用
 * 信息——deny 分支要用它补 action.called,但 turn1 那次调用早就返回了,局部变量活不过一次
 * send(),只能靠 pendingApprovals 这个 Map 存着带过来(见下方 send() 的续读分支)。
 */
async function drainStream(cursor: SseCursor, ctx: AgentContext, resumeGatedCall?: GatedCall): Promise<Turn> {
  const events: StreamEvent[] = [];
  let status: "completed" | "failed" = "completed";
  let messageText = "";
  // gated 工具的 tool-input 先缓着,不立刻 push——approve 分支执行成功后 langsmith 会给一个
  // 自洽的 "tool" 类型 span(call+result 用同一个 spanId,虽然不是真实 tool_call_id,但断言
  // 只看 name/input/status,不关心 callId 具体值),这时候再补一条用真实 toolCallId 的
  // action.called 反而会产生一条永远等不到配对 result 的幽灵记录(实测复现过,见
  // memory/langsmith-dialect-langchain-completion-shape-gap.md)。只有真的被拒绝时
  // (tool-output-denied 到达)才把缓存的这条连同 action.result 一起 push——被拒绝的调用
  // 从来不会真的执行,没有 "tool" 类型 span,只有这里手动补的这一对是唯一记录。
  let pendingGatedCall: GatedCall | undefined = resumeGatedCall;

  const finalize = async (): Promise<Turn> => {
    if (messageText) events.push({ type: "message", role: "assistant", text: messageText });
    await new Promise((resolve) => setTimeout(resolve, OTEL_FLUSH_GRACE_MS));
    return { status, events };
  };

  for (;;) {
    const frame = await cursor.next();
    if (frame === null) break;

    switch (frame.type) {
      case "session": {
        session.capture(ctx, frame.sessionId);
        break;
      }
      case "text-delta": {
        messageText += frame.delta;
        break;
      }
      case "tool-input": {
        if (GATED_TOOLS.has(frame.name)) {
          pendingGatedCall = { toolCallId: frame.toolCallId, name: frame.name, input: frame.input };
        }
        break;
      }
      case "tool-approval-request": {
        if (!ctx.session.id) throw new Error("tool-approval-request 帧到达时 ctx.session.id 还没写回");
        if (!pendingGatedCall || pendingGatedCall.toolCallId !== frame.toolCallId) {
          throw new Error(
            `tool-approval-request(${frame.toolCallId})没有对应的 tool-input 帧——协议顺序变了?`,
          );
        }
        pendingApprovals.set(ctx.session.id, { cursor, gatedCall: pendingGatedCall });
        // 中断前模型可能已经吐了一段前言(比如"好的,我来算一下"),这里一并收进这一轮的事件——
        // 不套 finalize() 的 flush grace:图还停在中断点,没有"这一轮的 otel 导出"这回事。
        if (messageText) events.push({ type: "message", role: "assistant", text: messageText });
        events.push({
          type: "input.requested",
          request: {
            id: frame.toolCallId,
            action: "calculate",
            options: [{ id: "approve" }, { id: "deny" }],
          },
        });
        return { status: "waiting", events };
      }
      case "tool-output-denied": {
        // 被拒绝的调用没有 "tool" 类型 span(从来没真的执行),这一对 called+result 只有
        // 这里手动补,是 toolCalls 里唯一的记录——两者用同一个真实 toolCallId,正常配对。
        if (pendingGatedCall && pendingGatedCall.toolCallId === frame.toolCallId) {
          events.push({
            type: "action.called",
            callId: pendingGatedCall.toolCallId,
            name: pendingGatedCall.name,
            input: pendingGatedCall.input as JsonValue,
          });
          pendingGatedCall = undefined;
        }
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
      // tool-input / tool-output:span 派生已覆盖,不用翻译(见文件头注释)。
      default:
        break;
    }
  }

  return finalize();
}

async function send(input: TurnInput, ctx: AgentContext): Promise<Turn> {
  const pending = ctx.session.id ? pendingApprovals.get(ctx.session.id) : undefined;
  if (pending) {
    pendingApprovals.delete(ctx.session.id!);
    const approved = input.text.trim().toLowerCase() === "approve";
    const approveRes = await appFetch(
      "/api/chat/approve",
      { toolCallId: pending.gatedCall.toolCallId, approved },
      ctx.signal,
    );
    if (!approveRes.ok) {
      throw new Error(`POST /api/chat/approve 失败: ${approveRes.status} ${await approveRes.text()}`);
    }
    return drainStream(pending.cursor, ctx, pending.gatedCall);
  }

  // traceparent 随请求带过去:本轮 span 挂到 niceeval 的 trace 下,并发归属才精确
  // ——不过 server.py 的 http.server 没接 OTel 服务端埋点,不会读这个头,实际上仍然会
  // 走时间窗口兜底、自动串行(见 docs/origin-integration.md「并发须知」),这里传只是
  // 面向未来:应用哪天接了 context 传播就免费生效。
  const res = await appFetch(
    "/api/chat",
    { message: input.text, sessionId: session.id(ctx) },
    ctx.signal,
    ctx.telemetry?.headers,
  );
  if (!res.ok || !res.body) {
    throw new Error(`POST /api/chat 失败: ${res.status} ${await res.text().catch(() => "")}`);
  }
  return drainStream(sseJsonFrames<LanggraphFrame>(res.body), ctx);
}

export default defineAgent({
  name: "langgraph",
  capabilities: {
    // 验证过:isNew 时不带 sessionId 开新会话、session 帧回传的 sessionId 写回
    // ctx.session.id、非 isNew 时带 id 续接同一条历史(LangGraph InMemorySaver,
    // 进程存活期间有效,见 origin agent.py 头注释)。
    conversation: true,
    // 验证过:langsmith 方言(src/o11y/otlp/dialects.ts)从 tool 类型 span 派生完整的
    // action.called/action.result 配对(callId/name/input/output/status 都有),
    // get_weather / calculate 每次调用都覆盖,无遗漏。
    toolObservability: true,
  },
  events: otelEvents({ dialects: [otel.langsmith] }),
  send,
});
