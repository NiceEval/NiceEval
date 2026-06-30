import { defineExperiment, claudeCodeAgent } from "fasteval";

// 实验组:安装了 effect-ts skill 的 Claude Code。
//
// claudeCodeAgent({ skills: ["effect-ts"] }) 在沙箱 setup 阶段执行
// `claude skills install effect-ts`，将 skill 的上下文注入到 claude 里。
// 这让 agent 在收到 prompt 时已经"知道" @effect/schema 和 Effect.tryPromise 等 API。
//
// 期望：effect-ts 编码任务的通过率显著高于 baseline 组。
export default defineExperiment({
  description: "claude-code + effect-ts skill",
  agent: claudeCodeAgent({
    // GitHub org/repo 格式：`npx skills add Effect-TS/skills` 会拉 repo、读 manifest、
    // 写 skills-lock.json，local name "effect-ts" 由 skill 自己的 manifest 声明。
    skills: ["Effect-TS/skills"],
  }),
  model: "claude-sonnet-4-6",
  sandbox: "docker",
  runs: 3,          // 每个 eval 跑 3 次,计通过率(pass^k)
  earlyExit: false, // 要完整分布,不在第一次通过后停
  budget: 10,       // 成本上限 $10
});
