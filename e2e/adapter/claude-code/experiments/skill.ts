import { defineExperiment } from "niceeval";
import { claudeCodeAgent } from "niceeval/adapter";

const agent = claudeCodeAgent({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseUrl: process.env.ANTHROPIC_BASE_URL,
  skills: [{ kind: "local", path: "fixtures/skills/e2e-marker" }],
});

// 独立实验:只挂了本地 Skill fixture 的 agent 才可能触发 skill.loaded,基线 agent 没
// 装这个 fixture。
export default defineExperiment({
  description: "skill:挂载了本地 Skill 的 claude-code agent",
  agent,
  model: "deepseek-v4-flash",
  attempts: 1,
  evals: (e) => e.id === "skill-used",
});
