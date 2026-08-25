import { defineExperiment } from "niceeval";
import { deterministicAgent } from "../agents/deterministic.ts";

const agent = deterministicAgent("cli-normal");

// 正常路径:两条正例(greet/、tool/ 两个 id 前缀),断言按 Eval 级折叠后整体退出 0。
// 同时是缓存三步验收的基线实验——test/cli.test.ts 对它先 --rerun all 建基线、再不带 --rerun all 复用、再 --rerun all 重跑。
export default defineExperiment({
  description: "normal:签入确定性 Agent,问候 + 工具调用两条正例",
  agent,
  model: "cli-deterministic-v1",
  evals: ["greet", "tool"],
  sandboxCache: { setup: "use" },
});
