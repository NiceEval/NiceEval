import { defineExperiment } from "niceeval";
import { claudeCodeAgent } from "niceeval/adapter";
import { sandbox } from "../sandbox.ts";

const agent = claudeCodeAgent({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseUrl: process.env.ANTHROPIC_BASE_URL,
  plugins: [
    {
      marketplace: {
        name: "claude-plugins-official",
        source: "anthropics/claude-plugins-official",
      },
      name: "frontend-design",
    },
  ],
});

export default defineExperiment({
  description: "remote-plugin:从 Anthropic 官方远程 marketplace 安装带 Skill 的 Plugin，并实际加载",
  agent,
  model: "gpt-5.6-luna",
  sandbox,
  attempts: 1,
  evals: ["remote-plugin"],
});
