import { defineExperiment } from "niceeval";
import { uiMessageStreamAgent } from "niceeval/adapter";
import { fixtureBaseUrl } from "../src/fixture/address.ts";

export default defineExperiment({
  description: "local-protocol malformed stream: [DONE] 后仍发送 assistant 帧",
  agent: uiMessageStreamAgent({
    name: "local-protocol-done-then-late",
    url: `${fixtureBaseUrl()}/modes/done-then-late/api/chat`,
  }),
  model: "local-protocol-fixture",
  evals: ["done-then-late"],
});
