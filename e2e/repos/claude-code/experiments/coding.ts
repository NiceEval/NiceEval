import { defineExperiment } from "niceeval";
import agent from "../agents/claude-code.ts";

// 基线 agent:coding-task(文件/shell 工具轨)+ session-resume(原生 resume + usage)。
export default defineExperiment({
  description: "coding: baseline claude-code agent — coding-task tool trail + session resume/usage",
  agent,
  model: "deepseek-v4-flash",
  runs: 1,
  evals: (id) => id === "coding-task" || id === "session-resume",
});
