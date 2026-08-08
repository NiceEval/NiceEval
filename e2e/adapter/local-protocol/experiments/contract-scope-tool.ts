import { defineExperiment } from "niceeval";
import { uiMessageStreamAgent } from "niceeval/adapter";
import { FIXTURE_BASE_URL } from "../src/fixture/address.ts";

// 共享断言契约 scope-tool 节：fixture 的 /modes/scope-tool 恰好吐一次 shell 工具调用，
// input/output 都带 marker；turn / session / t 三种 scope 断言同一笔真实事件。
export default defineExperiment({
  description: "local-protocol contract: scope-tool（一次真实 shell 工具调用）",
  agent: uiMessageStreamAgent({
    name: "local-protocol-contract-scope-tool",
    url: `${FIXTURE_BASE_URL}/modes/scope-tool/api/chat`,
  }),
  model: "local-protocol-fixture",
  evals: ["assertion-contract/scope-tool"],
});
