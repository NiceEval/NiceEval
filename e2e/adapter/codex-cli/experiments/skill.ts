import { defineExperiment } from "niceeval";
import { codexAgent } from "niceeval/adapter";
import { sandbox } from "../sandbox.ts";

const agent = codexAgent({
  apiKey: process.env.CODEX_API_KEY,
  baseUrl: process.env.CODEX_BASE_URL,
  skills: [
    { kind: "local", path: "skills/niceeval-status-report", name: "niceeval-status-report" },
    { kind: "local", path: "skills/niceeval-release-note", name: "niceeval-release-note" },
    { kind: "local", path: "skills/niceeval-decoy", name: "niceeval-decoy" },
  ],
});

export default defineExperiment({
  description: "codex-cli Skill 闭环:三个互斥 Skill 的目标读取、反选与产出约定",
  agent,
  model: "gpt-5.6-luna",
  sandbox,
  evals: ["status-report", "skill-release-note"],
  attempts: 1,
  budget: 3,
});
