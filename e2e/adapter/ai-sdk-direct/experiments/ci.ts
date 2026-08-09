import { createOpenAI } from "@ai-sdk/openai";
import { generateText, isStepCount, tool, type ModelMessage } from "ai";
import { defineExperiment } from "niceeval";
import { aiSdkAgent } from "niceeval/adapter";
import { z } from "zod";

const DEFAULT_MODEL = "gpt-5.6-luna";
const provider = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
});
const agent = aiSdkAgent<ModelMessage>({
  name: "ai-sdk-direct",
  generate: ({ messages, model, signal }) =>
    generateText({
      model: provider.chat(model ?? DEFAULT_MODEL),
      system: [
        "你是用于协议验收的助手。",
        "用户要求调用 remember_marker 时必须调用，参数逐字照抄；工具完成后简短确认。",
        "用户要求回忆哨兵时只按同一会话历史回答，不要猜测。",
      ].join("\n"),
      messages,
      tools: {
        remember_marker: tool({
          description: "原样保存一个验收哨兵；用户要求保存时必须调用。",
          inputSchema: z.object({ marker: z.string().min(1) }),
          execute: async ({ marker }) => ({ stored: marker }),
        }),
      },
      stopWhen: isStepCount(3),
      abortSignal: signal,
    }),
});

export default defineExperiment({
  description: "AI SDK 进程内官方 Direct Agent factory 的真实 provider 闭环",
  agent,
  model: DEFAULT_MODEL,
  evals: ["direct-agent"],
  attempts: 1,
});
