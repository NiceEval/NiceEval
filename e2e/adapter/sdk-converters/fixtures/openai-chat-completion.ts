import { Effect } from "effect";
import OpenAI from "openai";
import { chatCompletionEvidenceCoverage, defineAgent, turnFromChatCompletion } from "niceeval/adapter";

function chatCompletionBody(): unknown {
  return {
    id: "chatcmpl-sdk-converter-fixture",
    object: "chat.completion",
    created: 1_786_233_600,
    model: "gpt-5.4-nano",
    choices: [
      {
        index: 0,
        finish_reason: "tool_calls",
        logprobs: null,
        message: {
          role: "assistant",
          content: "openai-chat-completion-message-marker",
          refusal: null,
          annotations: [],
          tool_calls: [
            {
              id: "openai-chat-function-call",
              type: "function",
              function: { name: "weather_lookup", arguments: '{"city":"Taipei"}' },
            },
            {
              id: "openai-chat-custom-call",
              type: "custom",
              custom: { name: "grammar_query", input: "SELECT fixture_marker" },
            },
          ],
        },
      },
    ],
    usage: {
      prompt_tokens: 13,
      completion_tokens: 7,
      total_tokens: 20,
      prompt_tokens_details: { cached_tokens: 3, audio_tokens: 0 },
      completion_tokens_details: { reasoning_tokens: 2, audio_tokens: 0, accepted_prediction_tokens: 0, rejected_prediction_tokens: 0 },
    },
  };
}

export const openAiChatCompletionFixtureAgent = defineAgent({
  name: "openai-chat-completion-deterministic-fixture",
  evidenceCoverage: chatCompletionEvidenceCoverage,
  send: () => Effect.tryPromise({
      try: async () => {
    let requestCount = 0;
    const fixtureFetch: typeof globalThis.fetch = async () => {
      requestCount += 1;
      return new Response(JSON.stringify(chatCompletionBody()), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const client = new OpenAI({
      apiKey: "deterministic-fixture-key",
      baseURL: "http://openai-chat-fixture.invalid/v1",
      fetch: fixtureFetch,
      maxRetries: 0,
      timeout: 5_000,
    });
    const completion = await client.chat.completions.create({
      model: "gpt-5.4-nano",
      messages: [{ role: "user", content: "use both deterministic fixture tools" }],
    });
    if (requestCount !== 1) throw new Error(`expected one OpenAI Chat request, observed ${requestCount}`);

    // Official openai@6.49.0 return value goes in unchanged. This assignment is
    // deliberately the compile-time compatibility receipt: no projection/cast.
    return turnFromChatCompletion(completion);

      },
      catch: (cause) => cause,
    }),
});
