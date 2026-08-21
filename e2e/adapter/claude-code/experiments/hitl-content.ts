import { defineExperiment } from "niceeval";
import { claudeCodeAgent } from "niceeval/adapter";
import { claudeCodeProviderEnv } from "../provider.ts";
import { sandbox } from "../sandbox.ts";

export default defineExperiment({
  description: "hitl-content:Claude Code 只输出普通内容时，HITL Eval 必须判为 failed",
  agent: claudeCodeAgent({
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL,
    env: claudeCodeProviderEnv,
  }),
  model: "gpt-5.6-luna",
  sandbox,
  flags: { requestHitl: false },
  evals: ["hitl-options"],
  attempts: 1,
});
