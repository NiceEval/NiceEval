// codex-sdk 的 adapter:无侵入对接一个**已经在跑**的应用(../src/backend/server.ts,原生
// `ThreadEvent` 流原样透传成 SSE,外加一个和 `ThreadErrorEvent` 同形状的 `{type:"error"}`
// 传输帧)。没有 HITL(Codex SDK 不支持),永不返回 "waiting"。
//
// 断言依据全部来自这条 ThreadEvent 流:官方转换器 `createCodexThreadEventStream` 翻消息文本、
// 工具项(command_execution / mcp_tool_call / file_change → action.*)、`turn.completed` 的
// usage 和终局错误;逐帧驱动是官方件 `driveFrameStream`(没有 HITL,onFrame 只用来处理
// 传输帧 + 抓 threadId)。
//
// 这是 Tier 2(send + OTel):比 ../../tier1/codex-sdk 只多一层 OTel delta——本文件加
// `spanMapper: mapCodexSpans`、config 加 `telemetry: { port }`。OTel 只管 `niceeval view`
// 的瀑布图:codex CLI 原生 OTLP(config.toml [otel] 块)把 span 发到钉住的接收端口,
// `mapCodexSpans` 归一语义——span 不喂断言,断言与 Tier 1 完全相同。
import { defineAgent, mapCodexSpans, sseJsonFrames, createCodexThreadEventStream, driveFrameStream } from "niceeval/adapter";
import type { AgentContext } from "niceeval/adapter";
import type { Turn, TurnInput } from "niceeval";
import type { ThreadEvent } from "@openai/codex-sdk";

// 被测应用由你自己按它的方式启动(pnpm start / 部署在哪都行),eval 不代管进程、不另开端口。
const BASE_URL = process.env.CODEX_SDK_URL ?? "http://127.0.0.1:31001";

type TransportFrame = { type: "error"; message: string };
type CodexFrame = ThreadEvent | TransportFrame;

async function send(input: TurnInput, ctx: AgentContext): Promise<Turn> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: input.text,
        threadId: ctx.session.id,
      }),
      signal: ctx.signal,
    });
  } catch (err) {
    if (ctx.signal.aborted) throw err;
    throw new Error(
      `连不上 ${BASE_URL}/api/chat。被测应用在跑吗?先起它:cd examples/zh/tier2/codex-sdk && pnpm start(或设 CODEX_SDK_URL 指向已部署实例)。`,
    );
  }
  if (!res.ok || !res.body) {
    throw new Error(`POST /api/chat 失败: ${res.status} ${await res.text().catch(() => "")}`);
  }

  const stream = createCodexThreadEventStream();
  return driveFrameStream(sseJsonFrames<CodexFrame>(res.body), stream, ctx, (frame) => {
    // 应用自定义传输帧(query() 之外的失败,比如 spawn 失败),不属于 ThreadEvent。
    if (frame.type === "error") return { fail: (frame as TransportFrame).message };
    // 会话续接走「服务端记历史」范式:thread.started 帧回传的 id 用 ctx.session.capture 写回,
    // 只在还没记过时落地(first-writer-wins)。
    ctx.session.capture(stream.threadId);
  });
}

export default defineAgent({
  name: "codex-sdk",
  // 瀑布图:config 配了 telemetry(固定端口)就走 run 级共享接收器,起应用时
  // OTEL_EXPORTER_OTLP_ENDPOINT 指过来(codex 配置里自己拼 /v1/traces,给 base)。
  spanMapper: mapCodexSpans,
  send,
});
