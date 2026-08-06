import { defineExperiment } from "niceeval";
import { codexAgent } from "niceeval/adapter";

const agent = codexAgent({
  apiKey: process.env.CODEX_API_KEY,
  baseUrl: process.env.CODEX_BASE_URL,
});

export default defineExperiment({
  description: "codex-cli 工具轨闭环：coding 任务命令调用归一为规范 shell",
  agent,
  model: "gpt-5.4-mini",
  attempts: 2,
  earlyExit: true,
  budget: 3,
});
