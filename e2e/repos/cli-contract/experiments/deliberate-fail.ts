import { defineExperiment } from "niceeval";
import agent from "../agents/deepseek-chat.ts";

// 只覆盖 deliberate-fail/ 前缀下唯一的 eval:确定性失败断言,验证 attempt verdict = failed、
// 进程非零退出、JUnit 折叠成 <failure>(不是 <error>)。
export default defineExperiment({
  description: "deliberate-fail:确定性失败断言,验证退出码折叠与 JUnit <failure>",
  agent,
  evals: ["deliberate-fail"],
});
