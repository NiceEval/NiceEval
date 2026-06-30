import { defineExperiment, claudeCodeAgent } from "fasteval";

// 对照组:裸 Claude Code，没有任何 skill。
//
// 同一批 eval、同一个模型，唯一差异是没有 effect-ts skill。
// agent 需要从零猜 Effect-TS 的 API，通常会退回到 zod 或手写 try/catch。
//
// 把这组与 with-skill 对比，通过率差值即为 skill 的实际收益。
export default defineExperiment({
  description: "claude-code（无 skill，对照组）",
  agent: claudeCodeAgent(),   // 不传 skills
  model: "claude-sonnet-4-6", // 与 with-skill 用同一模型,差异才归因到 skill
  sandbox: "docker",
  runs: 3,
  earlyExit: false,
  budget: 10,
});
