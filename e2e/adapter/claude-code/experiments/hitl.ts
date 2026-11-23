import { defineExperiment } from "niceeval";
import { claudeCodeAgent } from "niceeval/adapter";
import { claudeCodeLiveModel, claudeCodeProviderEnv } from "../provider.ts";
import { sandbox } from "../sandbox.ts";

export default defineExperiment({
  description: "hitl:Claude Code 原生选项请求、结构化选择与会话恢复",
  adapter: claudeCodeAgent({
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseUrl: process.env.ANTHROPIC_BASE_URL,
    env: claudeCodeProviderEnv,
  }),
  model: claudeCodeLiveModel,
  sandbox,
  flags: { requestHitl: true },
  evals: ["hitl-options"],
  attempts: 1,
});
