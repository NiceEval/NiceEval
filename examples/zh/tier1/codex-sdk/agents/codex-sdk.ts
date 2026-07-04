// codex-sdk 的 adapter:无侵入对接一个**已经在跑**的应用(../src/backend/server.ts,原生
// `ThreadEvent` 流原样透传成 SSE,外加一个和 `ThreadErrorEvent` 同形状的 `{type:"error"}`
// 传输帧)。没有 HITL(Codex SDK 不支持),永不返回 "waiting"。
//
// 事件分工:
//   · 工具调用 + usage —— `events: otelEvents({ dialects: [otel.codex] })` 官方方言,从
//     codex CLI 原生 OTLP(config.toml [otel] 块)的 span 派生;瀑布图经官方 `mapCodexSpans`
//     归一。codex 的 span 没有工具 I/O,要做 I/O 断言时按 call_id 手写补(本示例的断言
//     直接读磁盘验证,不需要)。
//   · 消息文本 / 终局错误 —— 官方转换器 `fromCodexThreadEvents` 从 `ThreadEvent` 帧翻译,
//     逐帧驱动是官方件 `driveFrameStream`(没有 HITL,onFrame 只用来处理传输帧 + 抓 threadId)。
import { defineAgent, otelEvents, otel, mapCodexSpans, sseJsonFrames, fromCodexThreadEvents, driveFrameStream, serverSession } from "niceeval/adapter";
import type { AgentContext } from "niceeval/adapter";
import type { Turn, TurnInput } from "niceeval";
import type { ThreadEvent } from "@openai/codex-sdk";

// 被测应用由你自己按它的方式启动(pnpm start / 部署在哪都行),eval 不代管进程、不另开端口。
const BASE_URL = process.env.CODEX_SDK_URL ?? "http://127.0.0.1:5199";

type TransportFrame = { type: "error"; message: string };
type CodexFrame = ThreadEvent | TransportFrame;

// 会话续接走「服务端记历史」范式:请求带 session.id(ctx),thread.started 回传的 id 用 capture 写回。
const session = serverSession();

async function send(input: TurnInput, ctx: AgentContext): Promise<Turn> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: input.text,
        threadId: session.id(ctx),
      }),
      signal: ctx.signal,
    });
  } catch (err) {
    if (ctx.signal.aborted) throw err;
    throw new Error(
      `连不上 ${BASE_URL}/api/chat。被测应用在跑吗?先起它:cd examples/zh/tier1/codex-sdk && pnpm start(或设 CODEX_SDK_URL 指向已部署实例)。`,
    );
  }
  if (!res.ok || !res.body) {
    throw new Error(`POST /api/chat 失败: ${res.status} ${await res.text().catch(() => "")}`);
  }

  const stream = fromCodexThreadEvents();
  return driveFrameStream(sseJsonFrames<CodexFrame>(res.body), stream, ctx, (frame) => {
    // 应用自定义传输帧(query() 之外的失败,比如 spawn 失败),不属于 ThreadEvent。
    if (frame.type === "error") return { fail: (frame as TransportFrame).message };
    session.capture(ctx, stream.threadId);
  });
}

export default defineAgent({
  name: "codex-sdk",
  capabilities: {
    // 验证过:isNew 时不带 threadId 开新会话、thread.started 帧回传的 thread_id 写回
    // ctx.session.id、非 isNew 时带 id 经 codex.resumeThread 续接同一条历史
    // (SDK 落盘在 ~/.codex/sessions)。
    conversation: true,
    // 工具观测走 otel.codex 方言:每次真实执行都有带 tool_name + call_id 的 span
    // (实测见 src/o11y/otlp/dialects.ts 的 codex 方言注释),覆盖完整。
    toolObservability: true,
    tracing: true,
  },
  // 声明了 events 就走 run 级共享接收器;端口钉在 niceeval.config.ts 的 telemetry.port,
  // 起应用时 OTEL_EXPORTER_OTLP_ENDPOINT 指过来(codex 配置里自己拼 /v1/traces,给 base)。
  events: otelEvents({ dialects: [otel.codex] }),
  spanMapper: mapCodexSpans,
  send,
});
