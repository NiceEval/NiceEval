import { defineExperiment } from "niceeval";
import { codexAgent } from "niceeval/adapter";

const agent = codexAgent({
  apiKey: process.env.CODEX_API_KEY,
  baseUrl: process.env.CODEX_BASE_URL,
  skills: [{ kind: "local", path: "skills/niceeval-status-report", name: "niceeval-status-report" }],
});

export default defineExperiment({
  description: "codex-cli Skill 闭环:本地 Skill 装好后确实被读取并落进产出内容",
  agent,
  model: "gpt-5.4-mini",
  evals: ["skill"],
  attempts: 2,
  earlyExit: true,
  budget: 3,
});
