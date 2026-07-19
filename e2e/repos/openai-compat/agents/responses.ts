// Responses 形状的最小 Agent:对真实网关发 `/responses`,用官方 `fromResponses` 零映射成
// `Turn`。协议契约里 `output` 数组记录了模型这一轮决定做的全部事,所以 `actions`/`events`
// 通道声明 complete——负断言(notCalledTool)在这条路径上可信,见
// docs/engineering/e2e-ci/adapters/openai-compat.md。
//
// 取证路径(重要,写进仓库 README 与最终报告,不是实现细节):本仓库的真实网关在探测时对
// `/responses` 返回 401(鉴权中间件先拦截,没有走到路由层),所以"网关是否真的有 /responses
// 路由"在鉴权问题解决前无法确证。`callResponsesApi` 因此保留两条路径:
//   1. 首选真实 `/responses` 调用——鉴权恢复后如果网关真的路由这个端点,直接走这条,
//      在线上证明 Responses 形状确实长这样(零映射,无需下面的兜底)。
//   2. 仅当网关明确用 HTTP 404 声明"没有这条路由"(不是 401/5xx 等其它错误)时,才退化为
//      把一次真实 `/chat/completions` 响应翻译成 `ResponseLike` 形状——底层的 tool_calls/
//      content/usage 全部来自同一次真实模型调用,不是编出来的假响应;被翻译的只是"外层
//      形状"。这条路径只证明 `fromResponses` 的映射逻辑在真实数据上工作,不证明网关本身
//      吐出 Responses 线上形状——一旦触发,`send` 会记一条 diagnostic 说明白。
import { defineAgent, fromResponses } from "niceeval/adapter";
import type { ChatCompletionLike, ResponseLike, ResponseOutputItemLike } from "niceeval/adapter";
import { requireEnv, getEnv } from "niceeval";
import { WEATHER_TOOL_CHAT_COMPLETIONS, WEATHER_TOOL_RESPONSES } from "./tool.ts";

const BASE_URL = (getEnv("OPENAI_BASE_URL") ?? "https://api.openai.com/v1").replace(/\/$/, "");

/** 见文件头注释「取证路径」第 2 条:只在网关确证 404 时启用,底层数据仍来自真实模型调用。 */
function chatCompletionToResponseLike(cc: ChatCompletionLike): ResponseLike {
  const message = cc.choices[0]?.message;
  const output: ResponseOutputItemLike[] = [];
  for (const call of message?.tool_calls ?? []) {
    output.push({ type: "function_call", call_id: call.id, name: call.function.name, arguments: call.function.arguments });
  }
  if (message?.content) {
    output.push({ type: "message", content: [{ type: "output_text", text: message.content }] });
  }
  return {
    output,
    usage: cc.usage
      ? {
          input_tokens: cc.usage.prompt_tokens,
          output_tokens: cc.usage.completion_tokens,
          input_tokens_details: cc.usage.prompt_tokens_details,
        }
      : undefined,
  };
}

async function callResponsesApi(
  text: string,
  model: string,
  apiKey: string,
  signal: AbortSignal,
): Promise<{ body: ResponseLike; viaShim: boolean }> {
  const res = await fetch(`${BASE_URL}/responses`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, input: text, tools: [WEATHER_TOOL_RESPONSES] }),
    signal,
  });

  if (res.status === 404) {
    const ccRes = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages: [{ role: "user", content: text }], tools: [WEATHER_TOOL_CHAT_COMPLETIONS] }),
      signal,
    });
    if (!ccRes.ok) {
      throw new Error(`Responses 兜底路径的 Chat Completions 请求失败:HTTP ${ccRes.status} ${await ccRes.text()}`);
    }
    const cc = (await ccRes.json()) as ChatCompletionLike;
    return { body: chatCompletionToResponseLike(cc), viaShim: true };
  }

  if (!res.ok) {
    throw new Error(`Responses 请求失败:HTTP ${res.status} ${await res.text()}`);
  }
  return { body: (await res.json()) as ResponseLike, viaShim: false };
}

export default defineAgent({
  name: "openai-compat/responses",
  coverage: {
    actions: { status: "complete" },
    events: { status: "complete" },
  },
  async send(input, ctx) {
    const apiKey = requireEnv("OPENAI_API_KEY");
    const { body, viaShim } = await callResponsesApi(input.text, ctx.model ?? "deepseek-chat", apiKey, ctx.signal);
    if (viaShim) {
      ctx.diagnostic({
        code: "responses-endpoint-unavailable",
        level: "warning",
        dedupeKey: "responses-endpoint-unavailable",
        message:
          "网关对 /responses 返回 404,已退化为翻译真实 Chat Completions 响应到 ResponseLike 形状——" +
          "这证明的是 fromResponses 的映射逻辑,不证明网关本身吐出 Responses 线上形状,见 agents/responses.ts 文件头注释。",
      });
    }
    return fromResponses(body);
  },
});
