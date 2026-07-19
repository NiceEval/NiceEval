// langgraph 仓库的 adapter:官方事件流转换器 fromLangGraphEvents() 接 ../src/backend/server.py
// 的自建 SSE transport(契约见 docs/feature/adapters/sdk/langgraph/README.md)。转换器只认协议
// 帧本身;会话("thread_id" 写回 ctx.session.id)和 HITL 恢复("input.responses" 翻译成
// Command(resume=...))都在这个 adapter 里完成,不进转换器。
//
// 唯一非 LangGraphEventLike 的帧是 `{type: "session", sessionId}`(会话 id 回传,首轮才发,
// 语义同其它 origin/* 示例)。
import { completeCoverage, defineAgent, fromLangGraphEvents, sseJsonFrames } from "niceeval/adapter";
import type { AgentContext, LangGraphEventLike, LangGraphStream, SseFrameCursor } from "niceeval/adapter";
import type { StreamEvent, Turn, TurnInput } from "niceeval";

const BASE_URL = process.env.LANGGRAPH_URL ?? "http://127.0.0.1:35100";

type ProtoFrame = LangGraphEventLike | { type: "session"; sessionId: string };
type ProtoCursor = SseFrameCursor<ProtoFrame>;

// HITL 停轮现场:还开着的流(与其 fromLangGraphEvents() 转换器状态,seq/命名空间/去重集合
// 必须跨暂停延续,见 src/backend/server.py 头注释)、这一轮待答的 interrupt id,以及被审批
// 工具调用的 callId(resume 时若非 accept,要在喂错误帧之前调用 stream.markRejected(callId),
// 见下方 send() 的 resume 分支)。
interface PendingApproval {
  readonly cursor: ProtoCursor;
  readonly stream: LangGraphStream;
  readonly requestId: string;
  readonly toolCallId: string | undefined;
}

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
      `连不上 ${BASE_URL}${path}。被测应用在跑吗?先起它(python src/backend/server.py),或设 LANGGRAPH_URL 指向已部署实例。`,
    );
  }
}

/** 找出仍未被 action.result 解决、且工具名匹配的最近一次 action.called——就是这次 interrupt 门下的那次调用。 */
function findPendingCallId(events: readonly StreamEvent[], actionName: string | undefined): string | undefined {
  if (!actionName) return undefined;
  const resolved = new Set(
    events.filter((e): e is Extract<StreamEvent, { type: "action.result" }> => e.type === "action.result").map((e) => e.callId),
  );
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type === "action.called" && e.name === actionName && !resolved.has(e.callId)) return e.callId;
  }
  return undefined;
}

async function drainStream(cursor: ProtoCursor, stream: LangGraphStream, ctx: AgentContext): Promise<Turn> {
  const events: StreamEvent[] = [];

  for (;;) {
    const frame = await cursor.next();
    if (frame === null) break;

    if ("type" in frame && frame.type === "session") {
      // 会话续接走「服务端记历史」范式:thread_id 回传后用 ctx.session.capture 写回。
      ctx.session.capture(frame.sessionId);
      continue;
    }

    const produced = stream.add(frame as LangGraphEventLike);
    events.push(...produced);

    // 只看这一帧新产出的事件里有没有 input.requested——不能拿 stream.status 判断,
    // 它是跨暂停延续的同一个转换器实例上的持久 getter,resume 后新帧不触碰 lifecycle
    // 时仍会读到上一次暂停时留下的 "waiting"(真机跑过才踩到,见
    // memory/langgraph-stream-status-stale-across-resume.md)。

    const justRequested = produced.find(
      (e): e is Extract<StreamEvent, { type: "input.requested" }> => e.type === "input.requested",
    );
    if (justRequested) {
      // 停轮:连接不关,现场 hold 住;回答轮 take 回来接着读同一条流(同一个 stream 实例,
      // seq/命名空间/去重状态跨暂停延续)。
      const requestId = justRequested.request.id;
      if (!requestId) {
        throw new Error("input.requested 事件缺少 request.id——LangGraph interrupt 必须带 id 才能定位恢复请求");
      }
      const toolCallId = findPendingCallId(events, justRequested.request.action);
      ctx.session.hold<PendingApproval>({ cursor, stream, requestId, toolCallId });
      return { status: "waiting", events };
    }
  }

  events.push(...stream.end());
  return { status: stream.status ?? "completed", events, usage: stream.usage };
}

async function send(input: TurnInput, ctx: AgentContext): Promise<Turn> {
  // 回答轮:取回停轮现场,把裁决交回应用,接着读同一条流。
  const pending = ctx.session.take<PendingApproval>();
  if (pending) {
    const response = input.responses?.find((r) => r.requestId === pending.requestId);
    if (!response) {
      throw new Error(`没有找到 requestId=${pending.requestId} 的回答——resume 轮必须针对同一条待处理请求作答`);
    }
    const decision = response.optionId ?? response.text ?? "";
    if (decision !== "accept" && pending.toolCallId) {
      // 拒绝分支:在喂到即将到来的 tools/error 帧之前登记,转换器才会落 status: "rejected"
      // 而不是 "failed"(见 LangGraphStream.markRejected 的文档注释)。
      pending.stream.markRejected(pending.toolCallId);
    }
    const res = await appFetch("/api/chat/resume", { requestId: pending.requestId, decision }, ctx.signal);
    if (!res.ok) {
      throw new Error(`POST /api/chat/resume 失败: ${res.status} ${await res.text()}`);
    }
    return drainStream(pending.cursor, pending.stream, ctx);
  }

  const res = await appFetch("/api/chat", { message: input.text, sessionId: ctx.session.id }, ctx.signal);
  if (!res.ok || !res.body) {
    throw new Error(`POST /api/chat 失败: ${res.status} ${await res.text().catch(() => "")}`);
  }
  return drainStream(sseJsonFrames<ProtoFrame>(res.body), fromLangGraphEvents(), ctx);
}

export default defineAgent({
  name: "langgraph",
  send,
  // 官方 fromLangGraphEvents() 转换器 + 自建 SSE transport 忠实转写 LangGraph 真实的
  // messages/tools/input/lifecycle 四通道,不是最终自然语言或半覆盖埋点——声明全通道 complete,
  // 负断言(notCalledTool)与上限断言(maxTokens)才会真的判定,而不是记 unavailable/errored
  // (见 docs/feature/adapters/architecture/evidence.md)。
  coverage: completeCoverage,
});
