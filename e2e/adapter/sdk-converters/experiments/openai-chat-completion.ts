import { defineExperiment } from "niceeval";
import { openAiChatCompletionFixtureAgent } from "../fixtures/openai-chat-completion.ts";

export default defineExperiment({
  description: "Official OpenAI client ChatCompletion response through public converter",
  agent: openAiChatCompletionFixtureAgent,
  evals: ["openai-chat-completion"],
  attempts: 1,
});
