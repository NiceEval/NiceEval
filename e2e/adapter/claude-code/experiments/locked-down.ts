import { defineExperiment } from "niceeval";
import { claudeCodeAgent } from "niceeval/adapter";
import { claudeCodeLiveModel, claudeCodeProviderEnv } from "../provider.ts";
import { sandbox } from "../sandbox.ts";

const agent = claudeCodeAgent({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseUrl: process.env.ANTHROPIC_BASE_URL,
  env: {
    ...claudeCodeProviderEnv,
    // Surface provider failures before this short control reaches its deadline.
    API_TIMEOUT_MS: "60000",
    CLAUDE_CODE_MAX_RETRIES: "0",
  },
  settingsFile: "configs/claude-code/no-web.json",
});

// 独立实验:只挂了 settingsFile(permissions.deny)的 agent 才会真的没有 WebSearch/WebFetch。
export default defineExperiment({
  description: "locked-down:挂了 settingsFile 拒绝 WebSearch/WebFetch 的 claude-code agent",
  adapter: agent,
  model: claudeCodeLiveModel,
  flags: { expectedWebSearch: false },
  sandbox,
  attempts: 1,
  evals: (e) => e.id === "websearch-denied",
});
