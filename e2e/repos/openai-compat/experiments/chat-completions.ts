import { defineExperiment } from "niceeval";
import agent from "../agents/chat-completions.ts";

export default defineExperiment({
  description: "openai-compat: fromChatCompletion 零映射(真实 Chat Completions 网关)",
  agent,
  model: "deepseek-chat",
  evals: ["chat-completions/"],
  runs: 1,
});
