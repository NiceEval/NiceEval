import { defineExperiment } from "niceeval";
import { webAgent } from "../../adapter/adapter.ts";

// compare-models 组的一格:gpt-4o。
//
// 一文件一配置(单 model)。要跨模型对比就在本文件夹里再加一个文件(各钉一个 model),
// 别在一个实验里塞 model 数组。跑 `niceeval exp compare-models` 会把同组各 model 并排出报告。
//
// baseUrl 由实验在这里传给 adapter(adapter 自己不写死、不读 env)。
export default defineExperiment({
  description: "AI 助手:gpt-4o",
  agent: webAgent({ baseUrl: "https://example.com" }),
  model: "gpt-4o",
  runs: 3,   // 跑 3 次评估稳定性,earlyExit 默认关,给出完整分布
  budget: 5, // $5 上限
});
