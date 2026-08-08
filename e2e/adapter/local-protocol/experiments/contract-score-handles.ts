import { defineExperiment } from "niceeval";
import { uiMessageStreamAgent } from "niceeval/adapter";
import { FIXTURE_BASE_URL } from "../src/fixture/address.ts";

// 共享断言契约 score-handles 节：fixture 的 /modes/conversation 只回文本 marker，
// 计分制句柄（points / gate / atLeast / soft / optional / t.score）读同一笔真实事件。
export default defineExperiment({
  description: "local-protocol contract: score-handles（计分制句柄）",
  agent: uiMessageStreamAgent({
    name: "local-protocol-contract-score-handles",
    url: `${FIXTURE_BASE_URL}/modes/conversation/api/chat`,
  }),
  model: "local-protocol-fixture",
  evals: ["assertion-contract/score-handles"],
});
