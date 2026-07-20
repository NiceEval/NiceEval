import { defineExperiment } from "niceeval";
import agent from "../../agents/ai-sdk-v7.ts";

// compare-models 组的一格:deepseek-v4-flash。一文件一配置(单 model),model 经 ctx.model
// 走请求体传给应用,同一个 server 实例服务所有 model,不用重启进程。
export default defineExperiment({
  description: "deepseek-v4-flash: 对比模型",
  agent,
  model: "deepseek-v4-flash",
  runs: 2, // 跑满 2 次,才能比较 model 间的通过率
  budget: 2,
});
