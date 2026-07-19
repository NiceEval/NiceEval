import { defineExperiment } from "niceeval";
import agent from "../agents/codex-skills.ts";

export default defineExperiment({
  description: "codex-cli Skill 闭环:本地 Skill 装好后确实被读取并落进产出内容",
  agent,
  model: "gpt-5.4-mini",
  evals: ["skill"],
  runs: 2,
  earlyExit: true,
  budget: 3,
});
