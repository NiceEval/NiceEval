import { createOpenAI } from "@ai-sdk/openai";
import { generateText, type ModelMessage } from "ai";
import { aiSdkAgent } from "niceeval/adapter";

const provider = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
});

export const runnerAgent = aiSdkAgent<ModelMessage>({
  name: "runner-live",
  generate: ({ messages, model, signal }) => generateText({
    model: provider.chat(model ?? "gpt-5.6-luna"),
    system: "You are a runner E2E probe. Reply with exactly: runner-live-ok",
    messages,
    abortSignal: signal,
  }),
});
