import { defineExperiment } from "niceeval";
import { localSandbox } from "niceeval/sandbox";
import { preContextErrorAgent } from "../agents/deterministic.ts";

// 只覆盖 deliberate-error/ 前缀下唯一的 eval；local provider 让 prepare 的非零退出
// 完全确定且不依赖 Docker、网络或远端 provider。
export default defineExperiment({
  description: "deliberate-error:Context 建立前执行错误,验证发布与 JUnit <error>",
  agent: preContextErrorAgent,
  sandbox: localSandbox({ dir: process.cwd() }),
  evals: ["deliberate-error"],
});
