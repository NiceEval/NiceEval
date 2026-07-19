import { defineExperiment } from "niceeval";
import agent from "../agents/deepseek-chat.ts";

// 正常路径:两条正例(greet/、tool/ 两个 id 前缀),断言按 Eval 级折叠后整体退出 0。
// 同时是缓存三步验收的基线实验——scripts/verify.ts 对它先 --force 再不带 --force 再 --force。
export default defineExperiment({
  description: "normal:真实 DeepSeek 网关,问候 + 工具调用两条正例",
  agent,
  model: "deepseek-v4-flash",
  evals: ["greet", "tool"],
});
