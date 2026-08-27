import { defineExperiment } from "niceeval";
import { dockerSandbox } from "niceeval/sandbox";
import { preContextErrorAgent } from "../agents/deterministic.ts";

// 只覆盖 deliberate-error/ 前缀下唯一的 eval；隔离容器让 before 的非零退出
// 完全确定且不依赖网络或远端 provider。
export default defineExperiment({
  description: "deliberate-error:Context 建立前执行错误,验证发布与 JUnit <error>",
  agent: preContextErrorAgent,
  sandbox: dockerSandbox({
    source: {
      type: "dockerfile",
      context: new URL("../fixtures/deliberate-error/", import.meta.url),
    },
    user: "node",
    resources: { cpus: 1, memoryBytes: 512 * 1024 ** 2, pidsLimit: 128 },
  }),
  evals: ["deliberate-error"],
});
