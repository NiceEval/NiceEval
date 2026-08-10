import { defineExperiment } from "niceeval";
import { openAiResponsesFixtureAgent } from "../fixtures/openai-responses.ts";

export default defineExperiment({
  description: "Official OpenAI client Responses value through public converter",
  agent: openAiResponsesFixtureAgent,
  evals: ["openai-responses"],
  attempts: 1,
});
