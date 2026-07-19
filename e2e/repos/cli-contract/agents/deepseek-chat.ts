// 真实 remote agent:直连 OPENAI_BASE_URL 指向的 DeepSeek OpenAI-Chat-Completions 兼容网关,
// 用官方 fromChatCompletion 做零映射;请求里带一个 get_weather 工具定义,换回真实 tool_calls
// 而不只是文本(见 docs/feature/adapters/sdk/openai-compat/README.md)。
//
// 本仓库(cli-contract)只断言 CLI 的机制事实(选择 / 退出码折叠 / 缓存复用),不断言模型输出
// 质量——但 Agent 本身必须是真实的,这是 E2E 矩阵"contract 仓库同样使用真实 Agent 与真实模型"
// 的边界(见 docs/engineering/e2e-ci/README.md §7)。

import { defineAgent, fromChatCompletion, type ChatCompletionLike } from "niceeval/adapter";

const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// 与仓库其它示例(examples/zh/*/src/backend/models.ts、pi-sdk 的 agent.ts)同一套模型名约定;
// OPENAI_BASE_URL/OPENAI_API_KEY 这对凭据对接的是同一个 s2a.jihuayu.site 网关。
const DEFAULT_MODEL = "deepseek-v4-flash";

const GET_WEATHER_TOOL = {
  type: "function" as const,
  function: {
    name: "get_weather",
    description: "Get the current weather for a given city.",
    parameters: {
      type: "object",
      properties: {
        city: { type: "string", description: "City name, e.g. Brooklyn" },
      },
      required: ["city"],
    },
  },
};

interface ChatMessage {
  role: "user" | "assistant";
  content: string | null;
  tool_calls?: unknown[];
}

export default defineAgent({
  name: "deepseek-chat",

  async send(input, ctx) {
    if (!OPENAI_BASE_URL || !OPENAI_API_KEY) {
      throw new Error(
        "OPENAI_BASE_URL / OPENAI_API_KEY 未设置——见 .env.example,本仓库需要真实 DeepSeek 兼容网关凭据。",
      );
    }

    // 客户端带全量历史(Chat Completions 是无状态接口):同一条会话线的下一轮自动带上历史,
    // 新会话线(t.newSession() 之后)get() 天然是空数组——见 docs-site/zh/tutorials/write-send.mdx 第二步。
    const history = ctx.session.history<ChatMessage>();
    const messages = [...history.get(), { role: "user" as const, content: input.text }];

    const res = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: ctx.model ?? DEFAULT_MODEL,
        messages,
        tools: [GET_WEATHER_TOOL],
      }),
      signal: ctx.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      // 抛错 → runner 记 agent.run 阶段的执行错误(attempt errored),不是评分失败。
      throw new Error(`chat/completions HTTP ${res.status}: ${body.slice(0, 500)}`);
    }

    const json = (await res.json()) as ChatCompletionLike;
    const reply = json.choices[0]?.message;
    history.commit([...messages, (reply as ChatMessage) ?? { role: "assistant", content: "" }]);

    return fromChatCompletion(json);
  },
});
