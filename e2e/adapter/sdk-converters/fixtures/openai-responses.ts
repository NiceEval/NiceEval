import { Effect } from "effect";
import OpenAI from "openai";
import { defineAgent, responsesEvidenceCoverage, turnFromResponses } from "niceeval/adapter";

function responseBody(): unknown {
  return {
    id: "resp_sdk_converter_fixture",
    object: "response",
    created_at: 1_786_233_600,
    completed_at: 1_786_233_601,
    status: "completed",
    incomplete_details: null,
    background: false,
    billing: { payer: "developer" },
    error: null,
    instructions: null,
    max_output_tokens: 64,
    max_tool_calls: 1,
    model: "gpt-5.4-nano",
    output: [
      {
        type: "message",
        id: "msg_openai_responses_fixture",
        status: "completed",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: "openai-responses-message-marker",
            annotations: [],
            logprobs: [],
          },
        ],
      },
      {
        type: "function_call",
        id: "fc_openai_responses_fixture",
        call_id: "openai-responses-function-call",
        name: "calendar_lookup",
        arguments: '{"date":"2026-08-09"}',
        status: "completed",
      },
    ],
    parallel_tool_calls: true,
    previous_response_id: null,
    prompt_cache_key: null,
    prompt_cache_retention: null,
    reasoning: { effort: null, summary: null },
    safety_identifier: null,
    service_tier: "default",
    store: false,
    temperature: 1,
    text: { format: { type: "text" }, verbosity: "medium" },
    tool_choice: "auto",
    tools: [],
    top_logprobs: 0,
    top_p: 1,
    truncation: "disabled",
    usage: {
      input_tokens: 17,
      input_tokens_details: { cached_tokens: 5 },
      output_tokens: 8,
      output_tokens_details: { reasoning_tokens: 3 },
      total_tokens: 25,
    },
    user: null,
    metadata: {},
  };
}

export const openAiResponsesFixtureAgent = defineAgent({
  name: "openai-responses-deterministic-fixture",
  evidenceCoverage: responsesEvidenceCoverage,
  send: () => Effect.tryPromise({
    try: async () => {
      let requestCount = 0;
      const fixtureFetch: typeof globalThis.fetch = async () => {
        requestCount += 1;
        return new Response(JSON.stringify(responseBody()), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      };
      const client = new OpenAI({
        apiKey: "deterministic-fixture-key",
        baseURL: "http://openai-responses-fixture.invalid/v1",
        fetch: fixtureFetch,
        maxRetries: 0,
        timeout: 5_000,
      });
      const response = await client.responses.create({
        model: "gpt-5.4-nano",
        input: "use the deterministic calendar fixture",
      });
      if (requestCount !== 1) throw new Error(`expected one OpenAI Responses request, observed ${requestCount}`);

      // Full official response, unchanged and without a compatibility cast.
      return turnFromResponses(response);
    },
    catch: (cause) => cause,
  }),
});
