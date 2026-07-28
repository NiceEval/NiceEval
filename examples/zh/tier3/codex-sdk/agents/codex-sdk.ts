// codex-sdk 的 adapter:无侵入对接一个**已经在跑**的应用(../src/backend/server.ts,原生
// `ThreadEvent` 流原样透传成 SSE,外加一个和 `ThreadErrorEvent` 同形状的 `{type:"error"}`
// 传输帧)。没有 HITL(Codex SDK 不支持),永不返回 "waiting"。
//
// 断言依据全部来自这条 ThreadEvent 流:官方转换器 `createCodexThreadEventStream` 翻消息文本、
// 工具项(command_execution / mcp_tool_call / file_change → action.*)、`turn.completed` 的
// usage 和终局错误;逐帧驱动是官方件 `driveFrameStream`(没有 HITL,onFrame 只用来处理
// 传输帧 + 抓 threadId)。
//
// 这是 Tier 3(侵入改造 + experiment params):比 ../../tier2/codex-sdk 多一层——应用侧把
// threadOptions 的 sandbox mode 提升为请求体可选字段(src/backend/{agent,server}.ts),
// 本文件把 experiment 的 `params.sandboxMode` 经 ctx.params 随请求体透传过去,
// feature A/B 见 experiments/compare-sandbox/。OTel 部分(spanMapper + telemetry)与 Tier 2 相同。import { defineAgent, mapCodexSpans, sseJsonFrames, createCodexThreadEventStream, driveFrameStream } from "niceeval/adapter";
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
        // Tier 3:experiment 的 params 经 ctx.params 透传给应用(见 experiments/compare-sandbox/)。
        sandboxMode: ctx.params.sandboxMode,
      }),
      signal: ctx.signal,
    });
  } catch (err) {
    if (ctx.signal.aborted) throw err;
    throw new Error(
      `连不上 ${BASE_URL}/api/chat。被测应用在跑吗?先起它:cd examples/zh/tier3/codex-sdk && pnpm start(或设 CODEX_SDK_URL 指向已部署实例)。`,
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
