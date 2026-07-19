import { defineExperiment } from "niceeval";
import agent from "../agents/claude-code-skill.ts";

// 独立实验:只挂了本地 Skill fixture 的 agent 才可能触发 skill.loaded,基线 agent 没
// 装这个 fixture。
export default defineExperiment({
  description: "skill: claude-code agent with a mounted local Skill",
  agent,
  model: "deepseek-v4-flash",
  runs: 1,
  evals: (id) => id === "skill-used",
});
