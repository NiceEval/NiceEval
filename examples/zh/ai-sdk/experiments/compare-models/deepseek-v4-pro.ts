import { defineExperiment } from "fasteval";
import { webAgent } from "../../adapter/adapter.ts";

// compare-models 组的一格:gpt-4o。
//
// 一文件一配置(单 model)。要跨模型对比就在本文件夹里再加一个文件(各钉一个 model),
// 别在一个实验里塞 model 数组。跑 `fasteval exp compare-models` 会把同组各 model 并排出报告。
//
// baseUrl 由实验在这里传给 adapter(adapter 自己不写死、不读 env)。
export default defineExperiment({
  description: "deepseek-v4-pro: 对比模型",
  agent: webAgent({ baseUrl: "http://127.0.0.1:5188" }),
  model: "deepseek-v4-pro",
  runs: 2,          // 最多跑 2 次
  earlyExit: true,  // 2 次里通过一次就停,省 token
  budget: 5,        // $5 上限
});
