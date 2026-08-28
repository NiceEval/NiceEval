import { Effect } from "effect";
import OpenAI from "openai";
import { defineExperiment } from "niceeval";
import { defineAgent, responsesEvidenceCoverage, turnFromResponses } from "niceeval/adapter";

const TOOL_NAME = "lookup_live_responses_fixture";

const agent = defineAgent({
  name: "openai-responses-live-consumer",
  evidenceCoverage: responsesEvidenceCoverage,
  send: () => Effect.tryPromise({
      try: async () => {
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
    const response = await client.responses.create({
      model: "gpt-5.6-luna",
      input: "Call the required function once with marker exactly responses-live-20260809.",
      tools: [
        {
          type: "function",
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
      ],
      tool_choice: { type: "function", name: TOOL_NAME },
      max_output_tokens: 256,
    });
    if (requestCount !== 1) throw new Error(`OpenAI Responses live owner expected one request, observed ${requestCount}`);
    return turnFromResponses(response);

      },
      catch: (cause) => cause,
    }),
});

export default defineExperiment({
  description: "One real OpenAI Responses function-call value, raw into NiceEval",
  agent,
  evals: ["responses-live"],
  attempts: 1,
});
