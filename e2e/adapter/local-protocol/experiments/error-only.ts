import { defineExperiment } from "niceeval";
import { uiMessageStreamAgent } from "niceeval/adapter";
import { fixtureBaseUrl } from "../src/fixture/address.ts";

export default defineExperiment({
  description: "local-protocol malformed stream: error frame 后正常发送 [DONE]，但没有 assistant 消息",
  agent: uiMessageStreamAgent({
    name: "local-protocol-error-only",
    url: `${fixtureBaseUrl()}/modes/error-only/api/chat`,
  }),
  model: "local-protocol-fixture",
  evals: ["error-only"],
});
