import { defineExperiment } from "niceeval";
import { uiMessageStreamAgent } from "niceeval/adapter";
import { fixtureBaseUrl } from "../src/fixture/address.ts";

export default defineExperiment({
  description: "local-protocol disconnect: 半截 SSE 后硬断连接",
  agent: uiMessageStreamAgent({
    name: "local-protocol-disconnect",
    url: `${fixtureBaseUrl()}/modes/disconnect/api/chat`,
  }),
  model: "local-protocol-fixture",
  evals: ["disconnect"],
});
