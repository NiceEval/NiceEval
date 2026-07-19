import { defineExperiment } from "niceeval";
import agent from "../agents/deepseek-chat.ts";

// 只覆盖 deliberate-error/ 前缀下唯一的 eval:确定性执行错误,验证 attempt verdict = errored、
// 进程非零退出、JUnit 折叠成 <error>(不是 <failure>)——与 deliberate-fail 判然有别。
export default defineExperiment({
  description: "deliberate-error:确定性执行错误,验证退出码折叠与 JUnit <error>",
  agent,
  evals: ["deliberate-error"],
});
