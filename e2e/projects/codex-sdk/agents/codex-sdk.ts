// codex-sdk 的 adapter:无侵入对接一个**已经在跑**的应用(../src/backend/server.ts,原生
// `ThreadEvent` 流原样透传成 SSE,外加一个和 `ThreadErrorEvent` 同形状的 `{type:"error"}`
// 传输帧)。没有 HITL(Codex SDK 不支持),永不返回 "waiting"。
//
// 断言依据全部来自这条 ThreadEvent 流:官方转换器 `fromCodexThreadEvents` 翻消息文本、
// 工具项(command_execution / mcp_tool_call / file_change → action.*)、`turn.completed` 的
// usage 和终局错误;逐帧驱动是官方件 `driveFrameStream`(没有 HITL,onFrame 只用来处理
// 传输帧 + 抓 threadId)。
//
// 只接 send,不接 OTel——e2e 不测瀑布图(docs/engineering/e2e-ci/README.md 第 9 节);带 OTel 的完整
// 接入示例见 examples/zh/tier2/codex-sdk/。
import { defineAgent, sseJsonFrames, fromCodexThreadEvents, driveFrameStream } from "niceeval/adapter";
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
      `连不上 ${BASE_URL}/api/chat。被测应用在跑吗?先起它:cd e2e/apps/codex-sdk && pnpm start(或设 CODEX_SDK_URL 指向已部署实例)。`,
    );
  }
  if (!res.ok || !res.body) {
    throw new Error(`POST /api/chat 失败: ${res.status} ${await res.text().catch(() => "")}`);
  }

  const stream = fromCodexThreadEvents();
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
  send,
});
