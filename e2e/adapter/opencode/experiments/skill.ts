import { defineExperiment } from "niceeval";
import { openCodeAgent } from "niceeval/adapter";
import { sandbox } from "../sandbox.ts";

const agent = openCodeAgent({
  apiKey: process.env.BUB_API_KEY,
  baseUrl: process.env.BUB_API_BASE,
  skills: [
    { kind: "local", path: "skills/niceeval-opencode-status-report", name: "niceeval-opencode-status-report" },
    { kind: "local", path: "skills/niceeval-opencode-decoy", name: "niceeval-opencode-decoy" },
  ],
});

export default defineExperiment({
  description: "opencode:Skill 安装、原生发现、目标选择与 decoy 反选闭环",
  agent,
  model: "gpt-5.6-luna",
  sandbox,
  evals: ["skills/status-report"],
  attempts: 1,
});
