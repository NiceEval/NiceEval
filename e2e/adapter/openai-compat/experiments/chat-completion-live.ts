import OpenAI from "openai";
import {
  chatCompletionEvidenceCoverage,
  defineAgent,
  turnFromChatCompletion,
} from "niceeval/adapter";
import { defineExperiment } from "niceeval";

const TOOL_NAME = "lookup_live_chat_fixture";

const agent = defineAgent({
  name: "openai-chat-completion-live-consumer",
  evidenceCoverage: chatCompletionEvidenceCoverage,
  async send() {
    let requestCount = 0;
    const countedFetch: typeof globalThis.fetch = async (input, init) => {
      requestCount += 1;
      return globalThis.fetch(input, init);
    };
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL,
      fetch: countedFetch,
      maxRetries: 0,
      timeout: 90_000,
    });
    const completion = await client.chat.completions.create({
      model: "gpt-5.6-luna",
      messages: [
        {
          role: "user",
          content: "Call the required function once with marker exactly chat-live-20260809.",
        },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: TOOL_NAME,
            description: "Record the exact compatibility marker",
            strict: true,
            parameters: {
              type: "object",
              properties: { marker: { type: "string" } },
              required: ["marker"],
              additionalProperties: false,
            },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: TOOL_NAME } },
      max_completion_tokens: 256,
    });
    if (requestCount !== 1) throw new Error(`OpenAI Chat live owner expected one request, observed ${requestCount}`);
    return turnFromChatCompletion(completion);
  },
});

export default defineExperiment({
  description: "One real OpenAI Chat Completions function-call response, raw into NiceEval",
  agent,
  evals: ["chat-completion-live"],
  attempts: 1,
});
