// Chat Completions 形状的最小 Agent:直接对真实 OpenAI 兼容网关发 `/chat/completions`,
// 用官方 `fromChatCompletion` 零映射成 `Turn`。不经过任何应用层——这就是"连接用户前端
// 正在使用的接口"里最直的那条:我们自己就是前端。
//
// 证据完整性:Chat Completions 的协议契约不承诺"响应=完整过程"(应用可能在服务端跑完
// 工具循环只回最终答案),所以 `actions` 通道只声明 partial——支持 calledTool 等正断言,
// 不支持 notCalledTool 等负断言(仓库不为这条路径写负断言 Eval,见 evals/README 与
// docs/engineering/e2e-ci/adapters/openai-compat.md)。

import { defineAgent, fromChatCompletion } from "niceeval/adapter";
import type { ChatCompletionLike } from "niceeval/adapter";
import { requireEnv, getEnv } from "niceeval";
import { WEATHER_TOOL_CHAT_COMPLETIONS } from "./tool.ts";

const BASE_URL = getEnv("OPENAI_BASE_URL") ?? "https://api.openai.com/v1";

interface ChatMsg {
  role: "user" | "assistant" | "system" | "tool";
  content: string | null;
}

export default defineAgent({
  name: "openai-compat/chat-completions",
  coverage: {
    actions: {
      status: "partial",
      reason:
        "Chat Completions 响应不保证记录本轮全部决策——协议契约里没有\"output=完整过程\"的承诺," +
        "见 docs/feature/adapters/sdk/openai-compat/README.md",
    },
  },
  async send(input, ctx) {
    const apiKey = requireEnv("OPENAI_API_KEY");

    const history = ctx.session.history<ChatMsg>();
    const messages: ChatMsg[] = [...history.get(), { role: "user", content: input.text }];

    ctx.progress({ message: "等待 Chat Completions API" });
    const res = await fetch(`${BASE_URL.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: ctx.model ?? "deepseek-chat",
        messages,
        tools: [WEATHER_TOOL_CHAT_COMPLETIONS],
      }),
      signal: ctx.signal,
    });
    if (!res.ok) {
      throw new Error(`Chat Completions 请求失败:HTTP ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as ChatCompletionLike;
    const reply = body.choices[0]?.message;
    history.commit([...messages, { role: "assistant", content: reply?.content ?? null }]);

    return fromChatCompletion(body);
  },
});
