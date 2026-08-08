import { defineExperiment } from "niceeval";
import { uiMessageStreamAgent } from "niceeval/adapter";
import { FIXTURE_BASE_URL } from "../src/fixture/address.ts";

export default defineExperiment({
  description: "local-protocol disconnect: 半截 SSE 后硬断连接",
  agent: uiMessageStreamAgent({
    name: "local-protocol-disconnect",
    url: `${FIXTURE_BASE_URL}/modes/disconnect/api/chat`,
  }),
  model: "local-protocol-fixture",
  evals: ["disconnect"],
});
